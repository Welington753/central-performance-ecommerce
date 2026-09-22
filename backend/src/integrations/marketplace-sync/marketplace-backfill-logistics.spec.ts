import type { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import type { MappedOrderRecord } from '../marketplace-orders/mapped-order-record';
import { MercadoLivreOrdersSyncService } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { MercadoLivreShipmentLookupService } from '../mercado-livre-orders/mercado-livre-shipment-lookup.service';
import { MarketplaceBackfillService } from './marketplace-backfill.service';

/**
 * Lacuna apontada pela auditoria Full: o único teste do backfill mockava o
 * serviço de sincronização inteiro, então NADA provava que um chunk
 * histórico realmente consulta o envio e classifica o pedido. Aqui o
 * `MarketplaceBackfillService` e o `MercadoLivreOrdersSyncService` são os
 * REAIS — só a fronteira HTTP e a persistência são mockadas.
 */

const ACCOUNT_ID = 'acc-1';

function account(): MarketplaceAccount {
  return {
    id: ACCOUNT_ID,
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: '111',
    nickname: 'Meli 1',
    status: MarketplaceAccountStatus.CONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 1,
    refreshFailureCount: 0,
    refreshRetryAt: null,
    lastRefreshAttemptAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function rawOrder(id: string, shippingId: string | null) {
  return {
    id,
    status: 'paid',
    currency_id: 'BRL',
    total_amount: 100,
    pack_id: null,
    date_created: '2025-03-10T10:00:00.000-04:00',
    date_closed: '2025-03-10T10:05:00.000-04:00',
    last_updated: '2025-03-10T10:05:00.000-04:00',
    shipping: shippingId ? { id: shippingId } : undefined,
    order_items: [
      {
        item: {
          id: 'MLB1',
          title: 'Produto',
          variation_id: null,
          seller_sku: 'SKU-1',
        },
        quantity: 1,
        unit_price: 100,
        currency_id: 'BRL',
      },
    ],
  };
}

function buildBackfill(input: {
  orders: unknown[];
  fetchShipment: jest.Mock;
  configValues?: Record<string, unknown>;
}) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
  };
  const persistOrders = jest.fn().mockResolvedValue({
    ordersCreated: input.orders.length,
    ordersUpdated: 0,
    itemsPersisted: input.orders.length,
  });
  const finalizeSyncRunSuccess = jest.fn().mockResolvedValue(undefined);
  const persistence = {
    beginSyncRun: jest.fn().mockResolvedValue('run-1'),
    finalizeSyncRunSuccess,
    finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
    persistOrders,
    markAccountSynced: jest.fn().mockResolvedValue(undefined),
    recoverStaleRunningRuns: jest.fn().mockResolvedValue(0),
    // Cobertura já existente: o backfill sempre retrocede a partir daqui.
    getAccountSyncCoverage: jest.fn().mockResolvedValue({
      intervals: [
        {
          from: new Date('2025-04-01T00:00:00.000Z'),
          to: new Date('2025-05-01T00:00:00.000Z'),
        },
      ],
      oldestFrom: new Date('2025-04-01T00:00:00.000Z'),
      oldestRunRecordsRead: 5,
    }),
  };
  const httpClient = {
    fetchOrdersPage: jest.fn().mockResolvedValue({
      kind: 'success',
      body: {
        paging: { total: input.orders.length, offset: 0, limit: 50 },
        results: input.orders,
      },
    }),
  };
  const oauthService = {
    ensureValidAccessToken: jest.fn().mockResolvedValue('access-token'),
  };

  const configValues: Record<string, unknown> = { ...input.configValues };
  const configService = {
    get: (key: string, fallback?: unknown) => configValues[key] ?? fallback,
  } as unknown as ConfigService;

  const shipmentLookup = new MercadoLivreShipmentLookupService(
    { fetchShipment: input.fetchShipment } as never,
    configService,
    () => Promise.resolve(),
  );

  const mlSyncService = new MercadoLivreOrdersSyncService(
    marketplaceAccountsService as never,
    oauthService as never,
    httpClient as never,
    shipmentLookup,
    persistence as never,
    configService,
  );

  const backfill = new MarketplaceBackfillService(
    marketplaceAccountsService as never,
    persistence as never,
    mlSyncService,
    {} as never,
    {} as never,
    {} as never,
    { findLatestJob: jest.fn().mockResolvedValue(null) } as never,
    configService,
  );

  return { backfill, persistOrders, finalizeSyncRunSuccess, persistence };
}

function persistedOrders(persistOrders: jest.Mock): MappedOrderRecord[] {
  return (persistOrders.mock.calls[0] as [MappedOrderRecord[]])[0];
}

describe('backfill histórico — classificação logística (correção da auditoria Full)', () => {
  it('classifies a Full order during a historical backfill chunk', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
    const { backfill, persistOrders } = buildBackfill({
      orders: [rawOrder('1', 'ship-1')],
      fetchShipment,
    });

    await backfill.runNextChunk(ACCOUNT_ID);

    expect(fetchShipment).toHaveBeenCalledTimes(1);
    const orders = persistedOrders(persistOrders);
    expect(orders[0].logisticsClassification).toBe('MARKETPLACE_FULFILLED');
    expect(orders[0].logisticsType).toBe('fulfillment');
    // Identificador do envio persistido: é o que torna a reclassificação
    // posterior possível sem refazer o backfill.
    expect(orders[0].externalShipmentId).toBe('ship-1');
  });

  it('classifies a non-Full order during a historical backfill chunk — Flex is never Full', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'self_service' });
    const { backfill, persistOrders } = buildBackfill({
      orders: [rawOrder('1', 'ship-1')],
      fetchShipment,
    });

    await backfill.runNextChunk(ACCOUNT_ID);

    const orders = persistedOrders(persistOrders);
    expect(orders[0].logisticsClassification).toBe('SELLER_FULFILLED');
    expect(orders[0].logisticsType).toBe('self_service');
  });

  it('leaves the excess beyond the lookup cap pending AND observable — never silently "processed"', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
    const orders = Array.from({ length: 5 }, (_, index) =>
      rawOrder(String(index), `ship-${index}`),
    );
    const { backfill, persistOrders, finalizeSyncRunSuccess } = buildBackfill({
      orders,
      fetchShipment,
      configValues: { ML_MAX_SHIPMENT_LOOKUPS_PER_SYNC: 3 },
    });

    await backfill.runNextChunk(ACCOUNT_ID);

    expect(fetchShipment).toHaveBeenCalledTimes(3);

    const persisted = persistedOrders(persistOrders);
    expect(persisted[2].logisticsClassification).toBe('MARKETPLACE_FULFILLED');
    // Excedente: nunca perdido, nunca inferido como "sem Full".
    expect(persisted[3].logisticsClassification).toBe('UNKNOWN');
    expect(persisted[4].logisticsClassification).toBe('UNKNOWN');
    // ...e nunca sem identificador: continuam elegíveis à reclassificação.
    expect(persisted[3].externalShipmentId).toBe('ship-3');

    // Observabilidade: a pendência é gravada no `sync_run` desta execução.
    const [, , , diagnostics] = finalizeSyncRunSuccess.mock.calls[0] as [
      string,
      unknown,
      Date,
      Record<string, number>,
    ];
    expect(diagnostics).toEqual(
      expect.objectContaining({
        distinctShipments: 5,
        lookupsPerformed: 3,
        lookupsSkippedByCap: 2,
        classificationsResolved: 3,
        ordersLeftUnclassified: 2,
      }),
    );
  });

  it('reports the pending reclassification on the sync summary instead of claiming completeness', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
    const orders = Array.from({ length: 2 }, (_, index) =>
      rawOrder(String(index), `ship-${index}`),
    );
    const { backfill, finalizeSyncRunSuccess } = buildBackfill({
      orders,
      fetchShipment,
      configValues: { ML_MAX_SHIPMENT_LOOKUPS_PER_SYNC: 1 },
    });

    // O backfill de PEDIDOS avança normalmente (os pedidos foram importados)…
    const result = await backfill.runNextChunk(ACCOUNT_ID);
    expect(result.hasMoreHistory).toBe(true);
    expect(result.ordersFetched).toBe(2);

    // …mas a pendência logística fica registrada, nunca escondida.
    const [, , , diagnostics] = finalizeSyncRunSuccess.mock.calls[0] as [
      string,
      unknown,
      Date,
      Record<string, number>,
    ];
    expect(diagnostics.lookupsSkippedByCap).toBe(1);
    expect(diagnostics.ordersLeftUnclassified).toBe(1);
  });
});
