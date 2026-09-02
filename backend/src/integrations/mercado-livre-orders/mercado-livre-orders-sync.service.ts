import { Injectable, NotFoundException } from '@nestjs/common';
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
import {
  MercadoLivreOrdersPersistenceService,
  SyncAlreadyRunningError,
} from './mercado-livre-orders-persistence.service';
import { computeInitialSyncWindow } from './period.util';

export type SyncOrdersErrorCode =
  | 'ACCOUNT_NOT_CONNECTED'
  | 'SYNC_ALREADY_RUNNING'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_RATE_LIMITED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'SYNC_FAILED';

const FAILURE_SUMMARIES: Record<SyncOrdersErrorCode, string> = {
  ACCOUNT_NOT_CONNECTED: 'Conta não está conectada ao Mercado Livre.',
  SYNC_ALREADY_RUNNING: 'Já existe uma sincronização em andamento.',
  PROVIDER_UNAVAILABLE: 'Provedor indisponível ao consultar pedidos.',
  PROVIDER_RATE_LIMITED: 'Provedor limitou a taxa de requisições.',
  INVALID_PROVIDER_RESPONSE: 'Resposta do provedor em formato inesperado.',
  SYNC_FAILED: 'Falha inesperada durante a sincronização.',
};

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

@Injectable()
export class MercadoLivreOrdersSyncService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly oauthService: MercadoLivreOAuthService,
    private readonly httpClient: MercadoLivreOrdersHttpClient,
    private readonly persistence: MercadoLivreOrdersPersistenceService,
  ) {}

  async syncOrders(accountId: string): Promise<SyncOrdersSummary> {
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
      computeInitialSyncWindow(startedAt);

    let syncRunId: string;
    try {
      syncRunId = await this.persistence.beginSyncRun({
        marketplaceAccountId: accountId,
        periodFrom,
        periodTo,
        startedAt,
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
      const code =
        error instanceof SyncOrdersError ? error.code : 'SYNC_FAILED';
      await this.persistence.finalizeSyncRunFailure(
        syncRunId,
        code,
        FAILURE_SUMMARIES[code],
        new Date(),
      );
      throw error instanceof SyncOrdersError
        ? error
        : new SyncOrdersError('SYNC_FAILED');
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
