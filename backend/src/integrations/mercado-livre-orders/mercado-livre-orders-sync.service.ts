import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { MercadoLivreOAuthService } from '../mercado-livre-oauth/mercado-livre-oauth.service';
import {
  InvalidOrderDateError,
  mapMercadoLivreOrder,
  type MappedOrderRecord,
} from './mercado-livre-order.mapper';
import type { RawMercadoLivreOrder } from './mercado-livre-order-response';
import { validateOrdersSearchResponseBody } from './mercado-livre-order-response';
import {
  ORDERS_PAGE_LIMIT,
  MercadoLivreOrdersHttpClient,
  type OrdersSearchDateFilter,
} from './mercado-livre-orders-http.client';
import { MercadoLivreShipmentLookupService } from './mercado-livre-shipment-lookup.service';
import type { FetchShipmentOutcome } from './mercado-livre-shipment.client';
import { classifyLogisticType } from './mercado-livre-logistics.util';
import {
  LOGISTICS_UNKNOWN,
  type LogisticsClassification,
} from '../marketplace-orders/logistics-classification';
import {
  createLogisticsDiagnostics,
  hasPendingReclassification,
  type LogisticsClassificationDiagnostics,
} from '../marketplace-orders/logistics-classification-diagnostics';
import {
  MarketplaceOrdersPersistenceService,
  SyncAlreadyRunningError,
  type OrderBuyerLink,
  type OrderBuyersFetchResult,
} from '../marketplace-orders/marketplace-orders-persistence.service';
import {
  computeIncrementalSyncWindow,
  type PeriodWindow,
} from '../marketplace-orders/period.util';
import { SyncRunType } from '../../sync/sync-run.entity';

export type SyncOrdersErrorCode =
  | 'ACCOUNT_NOT_CONNECTED'
  | 'SYNC_ALREADY_RUNNING'
  | 'TOKEN_EXPIRED'
  | 'ACCOUNT_BUSY'
  | 'TOKEN_REFRESH_PENDING'
  | 'ML_APP_CONFIGURATION_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'SYNC_FAILED';

const FAILURE_SUMMARIES: Record<SyncOrdersErrorCode, string> = {
  ACCOUNT_NOT_CONNECTED: 'Conta não está conectada ao Mercado Livre.',
  SYNC_ALREADY_RUNNING: 'Já existe uma sincronização em andamento.',
  TOKEN_EXPIRED:
    'O Mercado Livre rejeitou o token da conta. Reconexão necessária.',
  ACCOUNT_BUSY: 'Já existe uma operação de token em andamento para esta conta.',
  // Correção de resiliência OAuth: falha RECUPERÁVEL (temporária ou
  // ambígua) de renovação — a conta continua CONNECTED, esta sincronização
  // só foi adiada, uma nova tentativa automática já está agendada.
  TOKEN_REFRESH_PENDING:
    'Renovação de token temporariamente indisponível. Nova tentativa automática agendada.',
  ML_APP_CONFIGURATION_ERROR:
    'Credenciais da aplicação Mercado Livre inválidas. Reconectar esta conta não resolve.',
  PROVIDER_UNAVAILABLE: 'Provedor indisponível ao consultar pedidos.',
  PROVIDER_RATE_LIMITED: 'Provedor limitou a taxa de requisições.',
  INVALID_PROVIDER_RESPONSE: 'Resposta do provedor em formato inesperado.',
  SYNC_FAILED: 'Falha inesperada durante a sincronização.',
};

// Vocabulário fechado de `ConflictException` lançado por
// `MercadoLivreOAuthService.ensureValidAccessToken` (ver esse arquivo).
// `ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN`/`REFRESH_RESULT_NOT_COMMITTED`/
// `CREDENTIAL_DECRYPTION_FAILED` são condições de borda/corrida internas
// sem ação distinta possível pelo usuário, então caem no fallback genérico.
const OAUTH_CONFLICT_TO_SYNC_ERROR_CODE: Partial<
  Record<string, SyncOrdersErrorCode>
> = {
  REFRESH_TOKEN_REJECTED: 'TOKEN_EXPIRED',
  ACCOUNT_BUSY: 'ACCOUNT_BUSY',
  REFRESH_TEMPORARY_FAILURE: 'TOKEN_REFRESH_PENDING',
  REFRESH_OUTCOME_UNKNOWN: 'TOKEN_REFRESH_PENDING',
  ML_APP_CONFIGURATION_ERROR: 'ML_APP_CONFIGURATION_ERROR',
};

function resolveSyncErrorCode(error: unknown): SyncOrdersErrorCode {
  if (error instanceof SyncOrdersError) return error.code;
  if (error instanceof ConflictException) {
    return OAUTH_CONFLICT_TO_SYNC_ERROR_CODE[error.message] ?? 'SYNC_FAILED';
  }
  return 'SYNC_FAILED';
}

/**
 * Vocabulário fechado de erro (design "Sincronização") — a mensagem da
 * exceção É o código; nunca inclui corpo de resposta, URL com query string,
 * token ou headers.
 */
export class SyncOrdersError extends Error {
  constructor(public readonly code: SyncOrdersErrorCode) {
    super(code);
  }
}

export interface SyncOrdersSummary {
  status: 'SUCCESS';
  startedAt: string;
  finishedAt: string;
  pagesFetched: number;
  ordersFetched: number;
  ordersCreated: number;
  ordersUpdated: number;
  itemsPersisted: number;
  periodFrom: string;
  periodTo: string;
  /**
   * Diagnóstico sanitizado da classificação logística desta execução
   * (correção da auditoria Full). Também é gravado em
   * `sync_runs.logistics_diagnostics` — aqui ele existe para que o chamador
   * (backfill, auto-sync, controller) saiba, sem consultar o banco, se a
   * execução deixou pendência logística.
   */
  logisticsDiagnostics: LogisticsClassificationDiagnostics;
  /**
   * `true` quando esta execução deixou pedidos `UNKNOWN` (teto de consultas
   * atingido, 429 persistente, timeout ou `logistic_type` não reconhecido).
   * O backfill de PEDIDOS continua avançando normalmente — os pedidos foram
   * importados —, e `status` continua `SUCCESS` (revisão crítica: isto NUNCA
   * altera `SyncRunStatus`, em especial nunca usa `PARTIAL`, que já tem
   * outro significado — ver comentário de `HARD_SAFETY_OFFSET_CAP`/
   * `DEFAULT_MAX_SHIPMENT_LOOKUPS_PER_SYNC` acima). Este campo é só
   * informativo no corpo da resposta de `POST .../sync-orders`; a garantia
   * real de que o pedido continua elegível à reclassificação é a escrita
   * CONDICIONAL do serviço dedicado, não este booleano.
   */
  hasPendingLogisticsReclassification: boolean;
}

// Protege contra um `paging.total` incorreto/absurdo devolvido pelo
// provedor — nunca um loop infinito de paginação.
const HARD_SAFETY_OFFSET_CAP = 20000;

/**
 * Limite defensivo (Fase 4, "Full") de consultas a `GET /shipments/{id}` por
 * chamada de sincronização — nunca uma chamada HTTP extra por pedido sem
 * limite. O teto PROTEGE tempo de execução e cota da API e por isso foi
 * mantido; a correção da auditoria Full não o removeu nem o inflou.
 *
 * O que mudou: acima do teto, os pedidos restantes continuam `UNKNOWN`
 * (nunca se perde o pedido), mas agora isso é CONTADO e gravado em
 * `sync_runs.logistics_diagnostics` (`lookupsSkippedByCap` /
 * `ordersLeftUnclassified`) e sinalizado no resultado da sincronização
 * (`hasPendingLogisticsReclassification`).
 *
 * O que isto NÃO faz (revisão crítica, para não superestimar a garantia):
 * `SyncOrdersSummary.status` continua `SUCCESS` mesmo com pendência
 * logística — os PEDIDOS foram importados com sucesso; só a classificação
 * `Full` de parte deles ficou pendente, um problema ortogonal. Nenhum
 * `SyncRunStatus` diferente é usado (em especial NUNCA `PARTIAL`: esse
 * status já tem semântica própria e incompatível — cobertura de JANELA DE
 * DATA para a prova de exaustão do backfill, ver
 * `marketplace-analytics.service.ts` — reaproveitá-lo aqui corromperia
 * aquela lógica). A garantia real de "nunca perder a pendência" é a escrita
 * CONDICIONAL do serviço de reclassificação
 * (`WHERE logistics_classification = 'UNKNOWN'`), não um status de
 * execução. `logisticsDiagnostics` fica gravado e consultável via
 * `GET /sync-runs` (mapeado em `SyncRun.logisticsDiagnostics`) para quem
 * quiser auditar; nenhum job automático hoje lê esse campo para agir.
 *
 * Configurável por ambiente (`ML_MAX_SHIPMENT_LOOKUPS_PER_SYNC`) para que o
 * operador possa ajustar o custo por execução sem alterar código — sempre
 * limitado a um teto absoluto.
 */
const DEFAULT_MAX_SHIPMENT_LOOKUPS_PER_SYNC = 200;
const HARD_MAX_SHIPMENT_LOOKUPS_PER_SYNC = 2000;

/**
 * Traduz o vocabulário FECHADO de resultados de `GET /shipments/{id}` em
 * contadores. `success` não incrementa nenhuma falha — a distinção entre
 * "resolvido" e "`logistic_type` não reconhecido" é feita pelo chamador, a
 * partir da classificação canônica.
 */
function countShipmentOutcome(
  diagnostics: LogisticsClassificationDiagnostics,
  kind: FetchShipmentOutcome['kind'],
): void {
  switch (kind) {
    case 'rate_limited':
      diagnostics.failuresRateLimited += 1;
      return;
    case 'provider_unavailable':
      diagnostics.failuresProviderUnavailable += 1;
      return;
    case 'not_found':
      diagnostics.failuresNotFound += 1;
      return;
    case 'unauthorized':
      diagnostics.failuresUnauthorized += 1;
      return;
    case 'invalid_response':
      diagnostics.failuresInvalidResponse += 1;
      return;
    case 'success':
      return;
  }
}

@Injectable()
export class MercadoLivreOrdersSyncService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly oauthService: MercadoLivreOAuthService,
    private readonly httpClient: MercadoLivreOrdersHttpClient,
    private readonly shipmentLookup: MercadoLivreShipmentLookupService,
    private readonly persistence: MarketplaceOrdersPersistenceService,
    private readonly configService: ConfigService,
  ) {}

  private get maxShipmentLookupsPerSync(): number {
    const configured = this.configService.get<number>(
      'ML_MAX_SHIPMENT_LOOKUPS_PER_SYNC',
      DEFAULT_MAX_SHIPMENT_LOOKUPS_PER_SYNC,
    );
    if (!Number.isFinite(configured) || configured < 1) {
      return DEFAULT_MAX_SHIPMENT_LOOKUPS_PER_SYNC;
    }
    return Math.min(Math.floor(configured), HARD_MAX_SHIPMENT_LOOKUPS_PER_SYNC);
  }

  /**
   * `windowOverride`/`type` (Fase 4, "Histórico completo") existem só para o
   * backfill histórico (`MarketplaceBackfillService`) reaproveitar esta MESMA
   * implementação — nenhum caminho de negócio novo, nenhuma cópia de
   * `fetchAllPages`/persistência. Sem `windowOverride` (botão manual
   * "Sincronizar agora" e o ciclo automático), a janela é sempre INCREMENTAL:
   * continua de onde a última sincronização bem-sucedida parou (com 1 dia de
   * sobreposição de segurança), nunca os últimos 60 dias inteiros de novo —
   * a única exceção é a primeiríssima sincronização desta conta, que ainda
   * usa os 60 dias iniciais (via `computeIncrementalSyncWindow` sem
   * cobertura prévia).
   */
  async syncOrders(
    accountId: string,
    options: { windowOverride?: PeriodWindow; type?: SyncRunType } = {},
  ): Promise<SyncOrdersSummary> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);

    if (account.marketplace !== Marketplace.MERCADO_LIVRE) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }
    if (
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.externalSellerId
    ) {
      throw new SyncOrdersError('ACCOUNT_NOT_CONNECTED');
    }
    const sellerId = account.externalSellerId;

    const startedAt = new Date();
    const { from: periodFrom, to: periodTo } =
      options.windowOverride ??
      computeIncrementalSyncWindow(
        (await this.persistence.getAccountSyncCoverage(accountId)).intervals,
        startedAt,
      );
    // Correção B1 (auditoria): `windowOverride` presente SEMPRE significa
    // backfill/histórico (único chamador é `MarketplaceBackfillService`,
    // sempre por `CREATED` — nunca teria como "recapturar" uma atualização
    // tardia de um pedido ainda não conhecido). Sem `windowOverride` (botão
    // manual "Sincronizar agora" e o ciclo automático), a busca passa a ser
    // por ÚLTIMA ATUALIZAÇÃO (`LAST_UPDATED`) — um pedido criado meses atrás
    // mas cancelado/parcialmente reembolsado dentro da janela incremental
    // agora é recapturado e atualizado, em vez de ficar congelado com o
    // status antigo para sempre.
    const dateFilter: OrdersSearchDateFilter = options.windowOverride
      ? 'CREATED'
      : 'LAST_UPDATED';

    let syncRunId: string;
    try {
      syncRunId = await this.persistence.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom,
        periodTo,
        startedAt,
        type: options.type,
      });
    } catch (error) {
      if (error instanceof SyncAlreadyRunningError) {
        throw new SyncOrdersError('SYNC_ALREADY_RUNNING');
      }
      throw error;
    }

    try {
      const accessToken =
        await this.oauthService.ensureValidAccessToken(accountId);

      const { rawOrders, pagesFetched } = await this.fetchAllPages({
        accessToken,
        sellerId,
        dateFilter,
        periodFrom,
        periodTo,
      });

      let mappedOrders: MappedOrderRecord[];
      try {
        mappedOrders = rawOrders.map((raw) =>
          mapMercadoLivreOrder(accountId, raw),
        );
      } catch (error) {
        if (error instanceof InvalidOrderDateError) {
          throw new SyncOrdersError('INVALID_PROVIDER_RESPONSE');
        }
        throw error;
      }

      const logisticsDiagnostics = await this.classifyLogistics(
        accessToken,
        rawOrders,
        mappedOrders,
      );

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
        logisticsDiagnostics,
      );
      await this.persistence.markAccountSynced(accountId, finishedAt);

      return {
        status: 'SUCCESS',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        pagesFetched,
        ordersFetched: rawOrders.length,
        ordersCreated: persistResult.ordersCreated,
        ordersUpdated: persistResult.ordersUpdated,
        itemsPersisted: persistResult.itemsPersisted,
        periodFrom: periodFrom.toISOString(),
        periodTo: periodTo.toISOString(),
        logisticsDiagnostics,
        hasPendingLogisticsReclassification:
          hasPendingReclassification(logisticsDiagnostics),
      };
    } catch (error) {
      const code = resolveSyncErrorCode(error);
      await this.persistence.finalizeSyncRunFailure(
        syncRunId,
        code,
        FAILURE_SUMMARIES[code],
        new Date(),
      );
      throw error instanceof SyncOrdersError
        ? error
        : new SyncOrdersError(code);
    }
  }

  /**
   * Resolve `logisticsClassification`/`logisticsType` (Fase 4, "Full") em
   * `mappedOrders`, na MESMA ordem/índice de `rawOrders` (garantido por
   * `Array.prototype.map` em `mapMercadoLivreOrder`, chamado logo acima).
   * Deduplica por `shippingId` — pedidos do mesmo envio (ex.: mesmo `packId`)
   * fazem UMA única consulta a `GET /shipments/{id}`. Respeita o teto de
   * consultas: além dele, a classificação permanece `UNKNOWN` sem nenhuma
   * chamada adicional — o pedido continua sendo persistido normalmente.
   * Qualquer falha de rede/resposta também vira `UNKNOWN` para aquele envio,
   * nunca lança (nunca perde o pedido) e NUNCA vira `SELLER_FULFILLED`.
   *
   * Devolve o diagnóstico sanitizado da etapa (correção da auditoria Full):
   * contagens por causa, para que o volume deixado `UNKNOWN` deixe de ser
   * invisível. Nenhum identificador de envio/pedido entra no diagnóstico.
   */
  private async classifyLogistics(
    accessToken: string,
    rawOrders: RawMercadoLivreOrder[],
    mappedOrders: MappedOrderRecord[],
  ): Promise<LogisticsClassificationDiagnostics> {
    const diagnostics = createLogisticsDiagnostics();
    const maxLookups = this.maxShipmentLookupsPerSync;
    const classificationByShipmentId = new Map<
      string,
      { classification: LogisticsClassification; logisticType: string | null }
    >();
    const shipmentsSkippedByCap = new Set<string>();
    let lookupsUsed = 0;

    for (let i = 0; i < rawOrders.length; i += 1) {
      const shippingId = rawOrders[i].shippingId;
      if (!shippingId) continue;

      let resolved = classificationByShipmentId.get(shippingId);
      if (!resolved) {
        if (lookupsUsed >= maxLookups) {
          // Pendência explícita: este envio NUNCA foi consultado. Contado
          // uma única vez por envio distinto, sem nenhum identificador.
          shipmentsSkippedByCap.add(shippingId);
          continue;
        }
        lookupsUsed += 1;
        diagnostics.lookupsPerformed += 1;

        const { outcome, attempts } = await this.shipmentLookup.lookup(
          accessToken,
          shippingId,
        );
        diagnostics.httpAttempts += attempts;
        countShipmentOutcome(diagnostics, outcome.kind);

        const logisticType =
          outcome.kind === 'success' ? outcome.logisticType : null;
        const classification = classifyLogisticType(logisticType);
        if (classification === LOGISTICS_UNKNOWN) {
          diagnostics.classificationsUnknown += 1;
        } else {
          diagnostics.classificationsResolved += 1;
        }

        resolved = { classification, logisticType };
        classificationByShipmentId.set(shippingId, resolved);
      }

      mappedOrders[i].logisticsClassification = resolved.classification;
      mappedOrders[i].logisticsType = resolved.logisticType;
    }

    for (const order of mappedOrders) {
      order.logisticsClassification ??= LOGISTICS_UNKNOWN;
      if (order.logisticsClassification === LOGISTICS_UNKNOWN) {
        diagnostics.ordersLeftUnclassified += 1;
      }
    }

    diagnostics.distinctShipments =
      classificationByShipmentId.size + shipmentsSkippedByCap.size;
    diagnostics.lookupsSkippedByCap = shipmentsSkippedByCap.size;

    return diagnostics;
  }

  /**
   * Enriquecimento histórico de compradores (função "Clientes"): SÓ lista os
   * pedidos criados na janela (mesma paginação em lote de `fetchAllPages`,
   * por `date_created`) e devolve o comprador de cada um. Nunca consulta
   * `/shipments`, nunca reclassifica Full, nunca persiste pedido, nunca grava
   * `sync_runs` nem `last_successful_sync_at` — a sincronização normal e a
   * cobertura dela ficam exatamente como estão. `complete: false` (nada
   * coletado) quando a janela passa do teto de paginação: o chamador divide
   * a janela, nunca pula pedidos.
   */
  async fetchOrderBuyers(
    accountId: string,
    window: PeriodWindow,
  ): Promise<OrderBuyersFetchResult> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);
    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE ||
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.externalSellerId
    ) {
      throw new SyncOrdersError('ACCOUNT_NOT_CONNECTED');
    }
    try {
      const accessToken =
        await this.oauthService.ensureValidAccessToken(accountId);
      const { rawOrders, capped } = await this.fetchAllPages({
        accessToken,
        sellerId: account.externalSellerId,
        dateFilter: 'CREATED',
        periodFrom: window.from,
        periodTo: window.to,
        stopWhenOverCap: true,
      });
      if (capped) return { links: [], ordersFetched: 0, complete: false };
      const links: OrderBuyerLink[] = [];
      for (const raw of rawOrders) {
        const mapped = mapMercadoLivreOrder(accountId, raw);
        if (mapped.buyer) {
          links.push({
            externalOrderId: mapped.externalOrderId,
            buyer: mapped.buyer,
            observedAt: mapped.marketplaceLastUpdated ?? mapped.dateCreated,
          });
        }
      }
      return { links, ordersFetched: rawOrders.length, complete: true };
    } catch (error) {
      if (error instanceof InvalidOrderDateError) {
        throw new SyncOrdersError('INVALID_PROVIDER_RESPONSE');
      }
      throw error instanceof SyncOrdersError
        ? error
        : new SyncOrdersError(resolveSyncErrorCode(error));
    }
  }

  /**
   * `capped: true` = o laço parou no teto de offset com pedidos ainda não
   * enumerados. A sincronização normal ignora o campo (comportamento de
   * sempre); `stopWhenOverCap` (só o enriquecimento) desiste já na primeira
   * página quando `paging.total` passa do teto, sem baixar páginas inúteis.
   */
  private async fetchAllPages(input: {
    accessToken: string;
    sellerId: string;
    dateFilter: OrdersSearchDateFilter;
    periodFrom: Date;
    periodTo: Date;
    stopWhenOverCap?: boolean;
  }): Promise<{
    rawOrders: RawMercadoLivreOrder[];
    pagesFetched: number;
    capped: boolean;
  }> {
    const rawOrders: RawMercadoLivreOrder[] = [];
    let pagesFetched = 0;
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    // `periodFrom`/`periodTo` (e `input.dateFilter`) são os MESMOS em toda
    // iteração deste laço — a janela é capturada uma única vez pelo chamador
    // e nunca recalculada por página, garantindo um `to` fechado durante
    // toda a execução (nunca avança enquanto a paginação está em andamento).
    while (offset < total && offset < HARD_SAFETY_OFFSET_CAP) {
      const outcome = await this.httpClient.fetchOrdersPage({
        accessToken: input.accessToken,
        sellerId: input.sellerId,
        dateFilter: input.dateFilter,
        dateFrom: input.periodFrom,
        dateTo: input.periodTo,
        offset,
        limit: ORDERS_PAGE_LIMIT,
      });

      if (outcome.kind === 'rate_limited') {
        throw new SyncOrdersError('PROVIDER_RATE_LIMITED');
      }
      if (
        outcome.kind === 'unauthorized' ||
        outcome.kind === 'provider_unavailable'
      ) {
        throw new SyncOrdersError('PROVIDER_UNAVAILABLE');
      }
      if (outcome.kind === 'invalid_response') {
        throw new SyncOrdersError('INVALID_PROVIDER_RESPONSE');
      }

      const validation = validateOrdersSearchResponseBody(outcome.body);
      if (!validation.valid) {
        throw new SyncOrdersError('INVALID_PROVIDER_RESPONSE');
      }

      pagesFetched += 1;
      total = validation.paging.total;
      if (input.stopWhenOverCap && total > HARD_SAFETY_OFFSET_CAP) {
        return { rawOrders: [], pagesFetched, capped: true };
      }
      rawOrders.push(...validation.orders);
      offset += ORDERS_PAGE_LIMIT;

      if (validation.orders.length === 0) {
        return { rawOrders, pagesFetched, capped: false };
      }
    }

    return { rawOrders, pagesFetched, capped: offset < total };
  }
}
