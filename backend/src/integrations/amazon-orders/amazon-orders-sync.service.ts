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
  computeInitialSyncWindow,
  dateOnlyToUtcInstant,
  addDaysToDateOnly,
  parseDateOnlyStrict,
  InvalidKpiPeriodError,
  type PeriodWindow,
} from '../marketplace-orders/period.util';
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

const HARD_SAFETY_PAGE_CAP = 200;
const HARD_SAFETY_ORDER_CAP = 20000;
const MAX_TRANSIENT_RETRIES_PER_PAGE = 3;
const MAX_TOKEN_RENEWAL_ATTEMPTS = 1;

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
  ) {}

  async syncOrders(
    accountId: string,
    input: AmazonOrdersSyncInput = {},
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

    const window = this.resolveWindow(input, new Date());

    const startedAt = new Date();
    let syncRunId: string;
    try {
      syncRunId = await this.persistence.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.AMAZON,
        periodFrom: window.from,
        periodTo: window.to,
        startedAt,
      });
    } catch (error) {
      if (error instanceof SyncAlreadyRunningError) {
        throw new AmazonOrdersSyncError('SYNC_ALREADY_RUNNING');
      }
      throw error;
    }

    try {
      let accessToken =
        await this.authService.ensureValidAccessToken(accountId);

      const { rawOrders, pagesFetched } = await this.fetchAllPages({
        accountId,
        window,
        endpoint: configResult.config.spApiEndpoint,
        userAgent: configResult.config.userAgent,
        marketplaceIds,
        getAccessToken: () => accessToken,
        renewAccessToken: async () => {
          accessToken =
            await this.authService.ensureValidAccessToken(accountId);
          return accessToken;
        },
      });

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

      if (quarantined > 0) {
        this.logger.warn('amazon_sync_quarantined_orders_summary', {
          accountId,
          quarantined,
        });
      }

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
      await this.persistence.finalizeSyncRunFailure(
        syncRunId,
        code,
        FAILURE_SUMMARIES[code],
        new Date(),
      );
      throw error instanceof AmazonOrdersSyncError
        ? error
        : new AmazonOrdersSyncError('SYNC_FAILED');
    }
  }

  private resolveWindow(
    input: AmazonOrdersSyncInput,
    referenceNow: Date,
  ): PeriodWindow {
    const hasFrom = input.from !== undefined && input.from !== '';
    const hasTo = input.to !== undefined && input.to !== '';

    if (!hasFrom && !hasTo) {
      return computeInitialSyncWindow(referenceNow);
    }
    if (hasFrom !== hasTo) {
      throw new AmazonOrdersSyncError('INVALID_PERIOD');
    }

    try {
      const from = parseDateOnlyStrict(input.from as string);
      const to = parseDateOnlyStrict(input.to as string);
      const fromInstant = dateOnlyToUtcInstant(from);
      const toInstant = dateOnlyToUtcInstant(addDaysToDateOnly(to, 1));
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

  private async fetchAllPages(input: {
    accountId: string;
    window: PeriodWindow;
    endpoint: string;
    userAgent: string;
    marketplaceIds: string[];
    getAccessToken: () => string;
    renewAccessToken: () => Promise<string>;
  }): Promise<{ rawOrders: RawAmazonOrder[]; pagesFetched: number }> {
    const rawOrders: RawAmazonOrder[] = [];
    let pagesFetched = 0;
    let paginationToken: string | undefined;
    let tokenRenewals = 0;

    while (pagesFetched < HARD_SAFETY_PAGE_CAP) {
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
          await input.renewAccessToken();
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

      if (rawOrders.length >= HARD_SAFETY_ORDER_CAP) break;
      if (validation.pagination.nextToken === null) break;
      paginationToken = validation.pagination.nextToken;
    }

    return { rawOrders, pagesFetched };
  }
}
