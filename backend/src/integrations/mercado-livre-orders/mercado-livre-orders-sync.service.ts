import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
} from './mercado-livre-orders-http.client';
import { MercadoLivreShipmentClient } from './mercado-livre-shipment.client';
import { classifyLogisticType } from './mercado-livre-logistics.util';
import { LOGISTICS_UNKNOWN } from '../marketplace-orders/logistics-classification';
import {
  MarketplaceOrdersPersistenceService,
  SyncAlreadyRunningError,
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
}

// Protege contra um `paging.total` incorreto/absurdo devolvido pelo
// provedor — nunca um loop infinito de paginação.
const HARD_SAFETY_OFFSET_CAP = 20000;

// Limite defensivo (Fase 4, "Full") de consultas a `GET /shipments/{id}` por
// chamada de sincronização — nunca uma chamada HTTP extra por pedido sem
// limite. Acima do teto, os pedidos restantes ficam `UNKNOWN` (nunca perdem
// o pedido) e o contador sanitizado (`shipmentLookupsSkipped`) registra
// quantos foram pulados, sem nenhum identificador de envio/pedido.
const MAX_SHIPMENT_LOOKUPS_PER_SYNC = 200;

@Injectable()
export class MercadoLivreOrdersSyncService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly oauthService: MercadoLivreOAuthService,
    private readonly httpClient: MercadoLivreOrdersHttpClient,
    private readonly shipmentClient: MercadoLivreShipmentClient,
    private readonly persistence: MarketplaceOrdersPersistenceService,
  ) {}

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

      await this.classifyLogistics(accessToken, rawOrders, mappedOrders);

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
   * fazem UMA única consulta a `GET /shipments/{id}`. Respeita
   * `MAX_SHIPMENT_LOOKUPS_PER_SYNC`: além do teto, a classificação
   * permanece `UNKNOWN` sem nenhuma chamada adicional — o pedido continua
   * sendo persistido normalmente. Qualquer falha de rede/resposta também
   * vira `UNKNOWN` para aquele envio, nunca lança (nunca perde o pedido).
   */
  private async classifyLogistics(
    accessToken: string,
    rawOrders: RawMercadoLivreOrder[],
    mappedOrders: MappedOrderRecord[],
  ): Promise<void> {
    const classificationByShipmentId = new Map<
      string,
      { classification: string; logisticType: string | null }
    >();
    let lookupsUsed = 0;

    for (let i = 0; i < rawOrders.length; i += 1) {
      const shippingId = rawOrders[i].shippingId;
      if (!shippingId) continue;

      let resolved = classificationByShipmentId.get(shippingId);
      if (!resolved) {
        if (lookupsUsed >= MAX_SHIPMENT_LOOKUPS_PER_SYNC) continue;
        lookupsUsed += 1;
        const outcome = await this.shipmentClient.fetchShipment(
          accessToken,
          shippingId,
        );
        const logisticType =
          outcome.kind === 'success' ? outcome.logisticType : null;
        resolved = {
          classification: classifyLogisticType(logisticType),
          logisticType,
        };
        classificationByShipmentId.set(shippingId, resolved);
      }

      mappedOrders[i].logisticsClassification =
        resolved.classification as MappedOrderRecord['logisticsClassification'];
      mappedOrders[i].logisticsType = resolved.logisticType;
    }

    for (const order of mappedOrders) {
      order.logisticsClassification ??= LOGISTICS_UNKNOWN;
    }
  }

  private async fetchAllPages(input: {
    accessToken: string;
    sellerId: string;
    periodFrom: Date;
    periodTo: Date;
  }): Promise<{ rawOrders: RawMercadoLivreOrder[]; pagesFetched: number }> {
    const rawOrders: RawMercadoLivreOrder[] = [];
    let pagesFetched = 0;
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;

    while (offset < total && offset < HARD_SAFETY_OFFSET_CAP) {
      const outcome = await this.httpClient.fetchOrdersPage({
        accessToken: input.accessToken,
        sellerId: input.sellerId,
        dateCreatedFrom: input.periodFrom,
        dateCreatedTo: input.periodTo,
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
      rawOrders.push(...validation.orders);
      total = validation.paging.total;
      offset += ORDERS_PAGE_LIMIT;

      if (validation.orders.length === 0) break;
    }

    return { rawOrders, pagesFetched };
  }
}
