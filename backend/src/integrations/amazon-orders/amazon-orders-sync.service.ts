import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import type { MappedOrderRecord } from '../marketplace-orders/mapped-order-record';
import {
  MarketplaceOrdersPersistenceService,
  SyncAlreadyRunningError,
} from '../marketplace-orders/marketplace-orders-persistence.service';
import {
  computeIncrementalSyncWindow,
  dateOnlyToUtcInstant,
  addDaysToDateOnly,
  parseDateOnlyStrict,
  saoPauloDateOnly,
  compareDateOnly,
  InvalidKpiPeriodError,
  type PeriodWindow,
} from '../marketplace-orders/period.util';
import type { SyncRunType } from '../../sync/sync-run.entity';
import { loadAmazonConfig } from '../amazon-sp-api/amazon-config';
import { AmazonAuthService } from '../amazon-sp-api/amazon-auth.service';
import {
  AmazonSpApiClient,
  type AmazonSearchOrdersOutcome,
} from '../amazon-sp-api/amazon-sp-api.client';
import { computeBackoffDelayMs } from './amazon-backoff.util';
import { loadAmazonMarketplaceIds } from './amazon-marketplace-ids.util';
import type { RawAmazonOrder } from './amazon-order-response';
import { validateOrdersSearchResponseBody } from './amazon-order-response';
import {
  AmazonOrderQuarantinedError,
  mapAmazonOrder,
} from './amazon-order.mapper';

export type AmazonOrdersSyncErrorCode =
  | 'ACCOUNT_NOT_CONNECTED'
  | 'AMAZON_NOT_CONFIGURED'
  | 'SYNC_ALREADY_RUNNING'
  | 'INVALID_PERIOD'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_REJECTED_REQUEST'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'INCOMPLETE_PROVIDER_DATA'
  | 'PAGINATION_LIMIT_EXCEEDED'
  | 'SYNC_FAILED';

const FAILURE_SUMMARIES: Record<AmazonOrdersSyncErrorCode, string> = {
  ACCOUNT_NOT_CONNECTED: 'Conta não está conectada à Amazon.',
  AMAZON_NOT_CONFIGURED: 'Integração Amazon não configurada.',
  SYNC_ALREADY_RUNNING: 'Já existe uma sincronização em andamento.',
  INVALID_PERIOD: 'Período informado é inválido.',
  PROVIDER_UNAVAILABLE: 'Provedor indisponível ao consultar pedidos.',
  PROVIDER_RATE_LIMITED: 'Provedor limitou a taxa de requisições.',
  PROVIDER_REJECTED_REQUEST: 'Provedor rejeitou a requisição.',
  INVALID_PROVIDER_RESPONSE: 'Resposta do provedor em formato inesperado.',
  // Checkpoint 4-B-R1 ("Correção 1") — só a CONTAGEM agregada de pedidos
  // descartados é aceita aqui; nunca ID de pedido, SKU, título ou payload.
  INCOMPLETE_PROVIDER_DATA:
    'Parte dos pedidos recebidos não pôde ser processada com segurança.',
  PAGINATION_LIMIT_EXCEEDED:
    'Limite de segurança de paginação atingido antes do fim real dos dados.',
  SYNC_FAILED: 'Falha inesperada durante a sincronização.',
};

export class AmazonOrdersSyncError extends Error {
  constructor(public readonly code: AmazonOrdersSyncErrorCode) {
    super(code);
  }
}

export interface AmazonOrdersSyncSummary {
  syncRunId: string;
  status: 'SUCCESS';
  dateFrom: string;
  dateTo: string;
  pagesFetched: number;
  ordersFetched: number;
  ordersUpserted: number;
  itemsUpserted: number;
}

export interface AmazonOrdersSyncInput {
  from?: string;
  to?: string;
}

/**
 * Função de espera injetável (Checkpoint 4-B, "timers e delays devem ser
 * injetáveis/testáveis") — produção usa `setTimeout` real; testes injetam
 * uma resolução instantânea, nunca esperando tempo real.
 */
export const AMAZON_ORDERS_SLEEP = Symbol('AMAZON_ORDERS_SLEEP');
export type SleepFn = (ms: number) => Promise<void>;

/**
 * Relógio injetável (Checkpoint 4-B-R1, "Correção 7") — produção usa
 * `() => new Date()`; testes injetam um instante fixo, nunca dependendo do
 * relógio real da máquina para validar o cutoff de dois minutos.
 */
export const AMAZON_ORDERS_CLOCK = Symbol('AMAZON_ORDERS_CLOCK');
export type ClockFn = () => Date;

const HARD_SAFETY_PAGE_CAP = 200;
const HARD_SAFETY_ORDER_CAP = 20000;
const MAX_TRANSIENT_RETRIES_PER_PAGE = 3;
const MAX_TOKEN_RENEWAL_ATTEMPTS = 1;

// A Amazon exige que `createdBefore`/`lastUpdatedBefore`, quando enviados,
// estejam pelo menos 2 minutos atrás do instante da requisição (Checkpoint
// 4-B-R1, "Correção 7") — cutoff sempre calculado a partir do relógio
// injetado, nunca de `new Date()` direto.
const MIN_SEARCH_BEFORE_BUFFER_MS = 2 * 60 * 1000;

// Limite de sanidade para um período customizado — protege contra um
// intervalo absurdamente longo antes de qualquer chamada de rede.
const MAX_SYNC_RANGE_DAYS = 366;
const MAX_SYNC_RANGE_MS = MAX_SYNC_RANGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Sincronização de pedidos Amazon (Orders API `v2026-01-01`) — espelha a
 * forma já usada pelo serviço de sincronização de pedidos do Mercado Livre,
 * mas com paginação por token (`paginationToken`, não offset), retentativa
 * limitada com backoff+jitter
 * para 429/5xx/falha transitória, e uma única renovação forçada de access
 * token em 401/403. Persiste através do MESMO
 * `MarketplaceOrdersPersistenceService` genérico usado pelo Mercado Livre —
 * nunca uma cópia.
 */
@Injectable()
export class AmazonOrdersSyncService {
  private readonly logger = new Logger(AmazonOrdersSyncService.name);

  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly authService: AmazonAuthService,
    private readonly spApiClient: AmazonSpApiClient,
    private readonly persistence: MarketplaceOrdersPersistenceService,
    private readonly configService: ConfigService,
    @Inject(AMAZON_ORDERS_SLEEP) private readonly sleep: SleepFn,
    @Inject(AMAZON_ORDERS_CLOCK) private readonly clock: ClockFn,
  ) {}

  async syncOrders(
    accountId: string,
    input: AmazonOrdersSyncInput = {},
    options: { type?: SyncRunType } = {},
  ): Promise<AmazonOrdersSyncSummary> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);

    if (account.marketplace !== Marketplace.AMAZON) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }
    if (
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.externalSellerId
    ) {
      throw new AmazonOrdersSyncError('ACCOUNT_NOT_CONNECTED');
    }

    const configResult = loadAmazonConfig(this.configService);
    if (!configResult.configured) {
      throw new AmazonOrdersSyncError('AMAZON_NOT_CONFIGURED');
    }
    const marketplaceIds = loadAmazonMarketplaceIds(this.configService);
    if (marketplaceIds === null) {
      throw new AmazonOrdersSyncError('AMAZON_NOT_CONFIGURED');
    }

    const now = this.clock();
    const window = await this.resolveWindow(accountId, input, now);

    const startedAt = new Date();
    let syncRunId: string;
    try {
      syncRunId = await this.persistence.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.AMAZON,
        periodFrom: window.from,
        periodTo: window.to,
        startedAt,
        type: options.type,
      });
    } catch (error) {
      if (error instanceof SyncAlreadyRunningError) {
        throw new AmazonOrdersSyncError('SYNC_ALREADY_RUNNING');
      }
      throw error;
    }

    // Guarda contra finalização duplicada do mesmo run no bloco `catch`
    // (Checkpoint 4-B-R1, "Correção 1") — o caminho de quarentena finaliza o
    // run como FAILED com contadores completos ANTES de lançar o erro para o
    // controller; sem esta flag, o `catch` abaixo tentaria finalizar de novo.
    let finalized = false;

    try {
      let accessToken =
        await this.authService.ensureValidAccessToken(accountId);

      const { rawOrders, pagesFetched, truncated } = await this.fetchAllPages({
        accountId,
        window,
        endpoint: configResult.config.spApiEndpoint,
        userAgent: configResult.config.userAgent,
        marketplaceIds,
        getAccessToken: () => accessToken,
        renewAccessToken: async (rejectedAccessToken: string) => {
          accessToken =
            await this.authService.refreshAccessTokenAfterUnauthorized(
              accountId,
              rejectedAccessToken,
            );
          return accessToken;
        },
      });

      if (truncated) {
        // Checkpoint 4-B-R1, "Correção 2" — o cap de segurança interrompeu a
        // paginação enquanto ainda havia `nextToken`: o lote é
        // estruturalmente incompleto, nunca persistido, nunca vira
        // cobertura. O `catch` abaixo finaliza o run como FAILED normalmente
        // (sem contadores — nada foi persistido).
        throw new AmazonOrdersSyncError('PAGINATION_LIMIT_EXCEEDED');
      }

      let quarantined = 0;
      const mappedOrders: MappedOrderRecord[] = [];
      for (const raw of rawOrders) {
        try {
          mappedOrders.push(mapAmazonOrder(accountId, raw, marketplaceIds));
        } catch (error) {
          if (error instanceof AmazonOrderQuarantinedError) {
            quarantined += 1;
            this.logger.warn('amazon_order_quarantined', {
              reason: error.reason,
            });
            continue;
          }
          throw error;
        }
      }

      const persistResult = await this.persistence.persistOrders(mappedOrders);
      const finishedAt = new Date();

      if (quarantined > 0) {
        // Checkpoint 4-B-R1, "Correção 1" — os pedidos VÁLIDOS já foram
        // persistidos acima (cobertura parcial real, não descartada), mas o
        // run nunca pode terminar como SUCCESS quando parte dos dados do
        // provedor foi descartada: termina FAILED, com contadores completos,
        // sem marcar a conta como sincronizada e sem entrar em nenhuma
        // cobertura do dashboard (que só considera runs `SUCCESS`).
        finalized = true;
        await this.persistence.finalizeSyncRunIncomplete(
          syncRunId,
          {
            ordersFetched: rawOrders.length,
            ordersCreated: persistResult.ordersCreated,
            ordersUpdated: persistResult.ordersUpdated,
            recordsFailed: quarantined,
            pagesFetched,
            itemsPersisted: persistResult.itemsPersisted,
          },
          'INCOMPLETE_PROVIDER_DATA',
          FAILURE_SUMMARIES.INCOMPLETE_PROVIDER_DATA,
          finishedAt,
        );
        this.logger.warn('amazon_sync_quarantined_orders_summary', {
          accountId,
          quarantined,
        });
        throw new AmazonOrdersSyncError('INCOMPLETE_PROVIDER_DATA');
      }

      finalized = true;
      await this.persistence.finalizeSyncRunSuccess(
        syncRunId,
        {
          ordersFetched: rawOrders.length,
          ordersCreated: persistResult.ordersCreated,
          ordersUpdated: persistResult.ordersUpdated,
          pagesFetched,
          itemsPersisted: persistResult.itemsPersisted,
        },
        finishedAt,
      );
      await this.persistence.markAccountSynced(accountId, finishedAt);

      return {
        syncRunId,
        status: 'SUCCESS',
        dateFrom: window.from.toISOString(),
        dateTo: window.to.toISOString(),
        pagesFetched,
        ordersFetched: rawOrders.length,
        ordersUpserted:
          persistResult.ordersCreated + persistResult.ordersUpdated,
        itemsUpserted: persistResult.itemsPersisted,
      };
    } catch (error) {
      const code =
        error instanceof AmazonOrdersSyncError ? error.code : 'SYNC_FAILED';
      if (!finalized) {
        await this.persistence.finalizeSyncRunFailure(
          syncRunId,
          code,
          FAILURE_SUMMARIES[code],
          new Date(),
        );
      }
      throw error instanceof AmazonOrdersSyncError
        ? error
        : new AmazonOrdersSyncError('SYNC_FAILED');
    }
  }

  /**
   * Resolve a janela [from, to) efetivamente consultada — nunca `new
   * Date()` direto, sempre `now` (relógio injetado). `to` nunca ultrapassa
   * `now - 2min` (Checkpoint 4-B-R1, "Correção 7": a Amazon exige que
   * `createdBefore` esteja pelo menos dois minutos no passado); um período
   * customizado que inclua hoje é silenciosamente limitado a esse cutoff —
   * é ISSO que vai para `sync_runs.date_to`, nunca o fim solicitado.
   *
   * Sem `from`/`to` explícitos (botão "Sincronizar agora"/ciclo automático,
   * Fase 4 "Histórico completo"): a janela é sempre INCREMENTAL a partir da
   * cobertura já sincronizada com sucesso — nunca os 60 dias inteiros de
   * novo a cada execução. Só a primeiríssima sincronização desta conta (sem
   * nenhum run SUCCESS ainda) usa a janela inicial de 60 dias.
   */
  private async resolveWindow(
    accountId: string,
    input: AmazonOrdersSyncInput,
    now: Date,
  ): Promise<PeriodWindow> {
    const hasFrom = input.from !== undefined && input.from !== '';
    const hasTo = input.to !== undefined && input.to !== '';
    const cutoff = new Date(now.getTime() - MIN_SEARCH_BEFORE_BUFFER_MS);

    if (!hasFrom && !hasTo) {
      const coverage = await this.persistence.getAccountSyncCoverage(accountId);
      const incremental = computeIncrementalSyncWindow(coverage.intervals, now);
      const to =
        incremental.to.getTime() > cutoff.getTime() ? cutoff : incremental.to;
      return { from: incremental.from, to };
    }
    if (hasFrom !== hasTo) {
      throw new AmazonOrdersSyncError('INVALID_PERIOD');
    }

    try {
      const from = parseDateOnlyStrict(input.from as string);
      const to = parseDateOnlyStrict(input.to as string);

      // Rejeita período futuro (dia-calendário `to` posterior a hoje em
      // América/São_Paulo) ANTES de qualquer chamada de rede — distinto do
      // cutoff de 2 minutos abaixo, que só recorta o FIM de um período que
      // já inclui hoje.
      if (compareDateOnly(to, saoPauloDateOnly(now)) > 0) {
        throw new AmazonOrdersSyncError('INVALID_PERIOD');
      }

      const fromInstant = dateOnlyToUtcInstant(from);
      const requestedToInstant = dateOnlyToUtcInstant(addDaysToDateOnly(to, 1));

      if (
        requestedToInstant.getTime() - fromInstant.getTime() >
        MAX_SYNC_RANGE_MS
      ) {
        throw new AmazonOrdersSyncError('INVALID_PERIOD');
      }

      const toInstant =
        requestedToInstant.getTime() > cutoff.getTime()
          ? cutoff
          : requestedToInstant;

      if (fromInstant.getTime() >= toInstant.getTime()) {
        throw new AmazonOrdersSyncError('INVALID_PERIOD');
      }
      return { from: fromInstant, to: toInstant };
    } catch (error) {
      if (error instanceof InvalidKpiPeriodError) {
        throw new AmazonOrdersSyncError('INVALID_PERIOD');
      }
      throw error;
    }
  }

  /**
   * Busca todas as páginas dentro dos caps de segurança. `truncated: true`
   * (Checkpoint 4-B-R1, "Correção 2") sinaliza que um cap foi atingido
   * enquanto AINDA havia `nextToken` pendente — paginação estruturalmente
   * incompleta, nunca traduzida em sucesso pelo chamador. Quando a última
   * página não tem `nextToken`, o run pode terminar com sucesso mesmo que a
   * quantidade esteja exatamente no limite.
   */
  private async fetchAllPages(input: {
    accountId: string;
    window: PeriodWindow;
    endpoint: string;
    userAgent: string;
    marketplaceIds: string[];
    getAccessToken: () => string;
    renewAccessToken: (rejectedAccessToken: string) => Promise<string>;
  }): Promise<{
    rawOrders: RawAmazonOrder[];
    pagesFetched: number;
    truncated: boolean;
  }> {
    const rawOrders: RawAmazonOrder[] = [];
    let pagesFetched = 0;
    let paginationToken: string | undefined;
    let tokenRenewals = 0;

    for (;;) {
      let transientAttempts = 0;
      let outcome: AmazonSearchOrdersOutcome;

      for (;;) {
        outcome = await this.spApiClient.searchOrders({
          accessToken: input.getAccessToken(),
          endpoint: input.endpoint,
          userAgent: input.userAgent,
          marketplaceIds: input.marketplaceIds,
          createdAfter: input.window.from.toISOString(),
          createdBefore: input.window.to.toISOString(),
          paginationToken,
        });

        if (outcome.kind === 'success') break;

        if (outcome.kind === 'unauthorized') {
          if (tokenRenewals >= MAX_TOKEN_RENEWAL_ATTEMPTS) {
            throw new AmazonOrdersSyncError('PROVIDER_UNAVAILABLE');
          }
          tokenRenewals += 1;
          await input.renewAccessToken(input.getAccessToken());
          continue;
        }

        if (
          outcome.kind === 'client_error' ||
          outcome.kind === 'endpoint_not_allowed'
        ) {
          throw new AmazonOrdersSyncError('PROVIDER_REJECTED_REQUEST');
        }

        if (outcome.kind === 'invalid_response') {
          throw new AmazonOrdersSyncError('INVALID_PROVIDER_RESPONSE');
        }

        // rate_limited ou provider_unavailable: falha transitória.
        transientAttempts += 1;
        if (transientAttempts > MAX_TRANSIENT_RETRIES_PER_PAGE) {
          throw new AmazonOrdersSyncError(
            outcome.kind === 'rate_limited'
              ? 'PROVIDER_RATE_LIMITED'
              : 'PROVIDER_UNAVAILABLE',
          );
        }
        const delayMs =
          outcome.kind === 'rate_limited' && outcome.retryAfterMs !== null
            ? outcome.retryAfterMs
            : computeBackoffDelayMs(transientAttempts);
        await this.sleep(delayMs);
      }

      const validation = validateOrdersSearchResponseBody(outcome.body);
      if (!validation.valid) {
        throw new AmazonOrdersSyncError('INVALID_PROVIDER_RESPONSE');
      }

      pagesFetched += 1;
      rawOrders.push(...validation.orders);
      const nextToken = validation.pagination.nextToken;

      if (rawOrders.length >= HARD_SAFETY_ORDER_CAP) {
        return { rawOrders, pagesFetched, truncated: nextToken !== null };
      }
      if (nextToken === null) {
        return { rawOrders, pagesFetched, truncated: false };
      }
      if (pagesFetched >= HARD_SAFETY_PAGE_CAP) {
        return { rawOrders, pagesFetched, truncated: true };
      }
      paginationToken = nextToken;
    }
  }
}
