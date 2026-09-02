import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncAlreadyRunningError } from '../marketplace-orders/marketplace-orders-persistence.service';
import { AmazonOrdersSyncService } from './amazon-orders-sync.service';

const AMAZON_ENV = {
  AMAZON_SP_API_APP_ID: 'amzn1.sp.solution.example',
  AMAZON_LWA_CLIENT_ID: 'amzn1.application-oa2-client.example',
  AMAZON_LWA_CLIENT_SECRET: 'lwa-secret-example',
  AMAZON_SP_API_ENDPOINT: 'https://sellingpartnerapi-na.amazon.com',
  AMAZON_SP_API_USER_AGENT: 'CentralPerformance/1.0',
  AMAZON_MARKETPLACE_IDS: 'A2Q3Y263D00KWC',
};

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-amazon-1',
    marketplace: Marketplace.AMAZON,
    externalSellerId: 'A1SELLERPARTNERID',
    nickname: null,
    status: MarketplaceAccountStatus.CONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: 'iv:tag:refresh',
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 1,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function successPage(orders: unknown[] = [], nextToken: string | null = null) {
  return {
    kind: 'success' as const,
    body: { orders, pagination: { nextToken } },
  };
}

function rawOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'ORDER-1',
    createdTime: '2026-08-01T10:00:00Z',
    lastUpdatedTime: '2026-08-01T10:05:00Z',
    salesChannel: { marketplaceId: 'A2Q3Y263D00KWC' },
    fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'AMAZON' },
    proceeds: { grandTotal: { amount: '199.90', currencyCode: 'BRL' } },
    orderItems: [
      {
        orderItemId: 'item-1',
        quantityOrdered: 1,
        product: {
          asin: 'B1',
          sellerSku: 'SKU-1',
          title: 'Produto',
          price: { unitPrice: { amount: '199.90', currencyCode: 'BRL' } },
        },
      },
    ],
    ...overrides,
  };
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    authService?: Record<string, jest.Mock>;
    spApiClient?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
    configValues?: Record<string, unknown>;
  } = {},
) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    ...overrides.marketplaceAccountsService,
  };
  const authService = {
    ensureValidAccessToken: jest.fn().mockResolvedValue('access-token-1'),
    ...overrides.authService,
  };
  const spApiClient = {
    searchOrders: jest.fn().mockResolvedValue(successPage()),
    ...overrides.spApiClient,
  };
  const persistence = {
    beginSyncRun: jest.fn().mockResolvedValue('run-1'),
    finalizeSyncRunSuccess: jest.fn().mockResolvedValue(undefined),
    finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
    markAccountSynced: jest.fn().mockResolvedValue(undefined),
    persistOrders: jest.fn().mockResolvedValue({
      ordersCreated: 0,
      ordersUpdated: 0,
      itemsPersisted: 0,
    }),
    ...overrides.persistence,
  };
  const configValues: Record<string, unknown> =
    overrides.configValues ?? AMAZON_ENV;
  const configService = {
    get: (key: string, fallback?: unknown) => configValues[key] ?? fallback,
  } as unknown as ConfigService;
  const sleep = jest.fn().mockResolvedValue(undefined);

  const service = new AmazonOrdersSyncService(
    marketplaceAccountsService as never,
    authService as never,
    spApiClient as never,
    persistence as never,
    configService,
    sleep,
  );

  return {
    service,
    marketplaceAccountsService,
    authService,
    spApiClient,
    persistence,
    sleep,
  };
}

describe('AmazonOrdersSyncService.syncOrders', () => {
  it('rejects a Mercado Livre account', async () => {
    const { service, marketplaceAccountsService } = buildService();
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({ marketplace: Marketplace.MERCADO_LIVRE }),
    );

    await expect(service.syncOrders('acc-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a disconnected account with ACCOUNT_NOT_CONNECTED', async () => {
    const { service, marketplaceAccountsService } = buildService();
    marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({ status: MarketplaceAccountStatus.DISCONNECTED }),
    );

    await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_CONNECTED',
    });
  });

  it('returns AMAZON_NOT_CONFIGURED when an Amazon env var is missing', async () => {
    const { service, spApiClient } = buildService({ configValues: {} });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'AMAZON_NOT_CONFIGURED',
    });
    expect(spApiClient.searchOrders).not.toHaveBeenCalled();
  });

  it('returns AMAZON_NOT_CONFIGURED when AMAZON_MARKETPLACE_IDS is missing, even with the other five vars present', async () => {
    const { AMAZON_MARKETPLACE_IDS: _omit, ...withoutMarketplaceIds } =
      AMAZON_ENV;
    const { service } = buildService({ configValues: withoutMarketplaceIds });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'AMAZON_NOT_CONFIGURED',
    });
  });

  it('defaults to the initial 60-day sync window when no period is given', async () => {
    const { service, persistence } = buildService();
    const before = Date.now();

    const result = await service.syncOrders('acc-amazon-1');

    const from = new Date(result.dateFrom).getTime();
    const to = new Date(result.dateTo).getTime();
    expect(to - from).toBeCloseTo(60 * 24 * 60 * 60 * 1000, -3);
    expect(to).toBeGreaterThanOrEqual(before);
    expect(persistence.beginSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ marketplace: Marketplace.AMAZON }),
    );
  });

  it('accepts an explicit, validated from/to period', async () => {
    const { service } = buildService();
    const result = await service.syncOrders('acc-amazon-1', {
      from: '2026-08-01',
      to: '2026-08-05',
    });
    expect(result.dateFrom).toBe('2026-08-01T03:00:00.000Z');
    expect(result.dateTo).toBe('2026-08-06T03:00:00.000Z');
  });

  it('rejects an explicit period with only one of from/to', async () => {
    const { service } = buildService();
    await expect(
      service.syncOrders('acc-amazon-1', { from: '2026-08-01' }),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('rejects an invalid date format', async () => {
    const { service } = buildService();
    await expect(
      service.syncOrders('acc-amazon-1', {
        from: '01/08/2026',
        to: '2026-08-05',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('rejects from > to', async () => {
    const { service } = buildService();
    await expect(
      service.syncOrders('acc-amazon-1', {
        from: '2026-08-10',
        to: '2026-08-01',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('paginates across multiple pages, preserving the original filters (marketplaceIds/date window) on every page', async () => {
    const { service, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValueOnce(
            successPage([rawOrder({ orderId: 'A' })], 'token-2'),
          )
          .mockResolvedValueOnce(
            successPage([rawOrder({ orderId: 'B' })], null),
          ),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');

    expect(result.pagesFetched).toBe(2);
    expect(result.ordersFetched).toBe(2);
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = spApiClient.searchOrders.mock
      .calls as Array<[Record<string, unknown>]>;
    expect(firstCall[0].paginationToken).toBeUndefined();
    expect(secondCall[0].paginationToken).toBe('token-2');
    expect(secondCall[0].marketplaceIds).toEqual(firstCall[0].marketplaceIds);
    expect(secondCall[0].createdAfter).toBe(firstCall[0].createdAfter);
    expect(secondCall[0].createdBefore).toBe(firstCall[0].createdBefore);
  });

  it('stops pagination once nextToken is null and persists everything fetched', async () => {
    const { service, persistence } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue(successPage([rawOrder()], null)),
      },
      persistence: {
        beginSyncRun: jest.fn().mockResolvedValue('run-1'),
        finalizeSyncRunSuccess: jest.fn().mockResolvedValue(undefined),
        finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
        markAccountSynced: jest.fn().mockResolvedValue(undefined),
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 1,
          ordersUpdated: 0,
          itemsPersisted: 1,
        }),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');
    expect(result.pagesFetched).toBe(1);
    expect(result.ordersUpserted).toBe(1);
    expect(persistence.persistOrders).toHaveBeenCalledTimes(1);
  });

  it('a single 401 forces exactly one token renewal and one retry, then succeeds', async () => {
    const { service, authService, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValueOnce({ kind: 'unauthorized' })
          .mockResolvedValueOnce(successPage([], null)),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');

    expect(result.status).toBe('SUCCESS');
    expect(authService.ensureValidAccessToken).toHaveBeenCalledTimes(2); // inicial + renovação forçada
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
  });

  it('a second consecutive 401 (after the one allowed renewal) fails the sync — never loops forever', async () => {
    const { service, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({ kind: 'unauthorized' }),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2); // 1 inicial + 1 após a única renovação
  });

  it('429 respects Retry-After and retries with a limited number of attempts, using the injected sleep (never real time)', async () => {
    const { service, sleep, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValueOnce({ kind: 'rate_limited', retryAfterMs: 1234 })
          .mockResolvedValueOnce(successPage([], null)),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');
    expect(result.status).toBe('SUCCESS');
    expect(sleep).toHaveBeenCalledWith(1234);
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
  });

  it('429 without a valid Retry-After falls back to exponential backoff with jitter via the injected sleep', async () => {
    const { service, sleep } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValueOnce({ kind: 'rate_limited', retryAfterMs: null })
          .mockResolvedValueOnce(successPage([], null)),
      },
    });

    await service.syncOrders('acc-amazon-1');
    expect(sleep).toHaveBeenCalledTimes(1);
    const sleepCalls = sleep.mock.calls as unknown[][];
    expect(sleepCalls[0][0]).toBeGreaterThan(0);
  });

  it('persistent 429/5xx eventually stops retrying (limited attempts) — never an infinite loop', async () => {
    const { service, spApiClient, sleep } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue({ kind: 'provider_unavailable' }),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    // Chamadas limitadas: 1 inicial + MAX_TRANSIENT_RETRIES_PER_PAGE (3) = 4.
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('a 400 contract error is never retried — fails immediately', async () => {
    const { service, spApiClient, sleep } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({ kind: 'client_error' }),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED_REQUEST',
    });
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a quarantined order is skipped without failing the whole sync — the rest is still persisted', async () => {
    const { service, persistence } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue(
          successPage(
            [
              rawOrder({ orderId: 'BAD', proceeds: {} }), // sem grandTotal, pago -> quarentena
              rawOrder({ orderId: 'GOOD' }),
            ],
            null,
          ),
        ),
      },
      persistence: {
        beginSyncRun: jest.fn().mockResolvedValue('run-1'),
        finalizeSyncRunSuccess: jest.fn().mockResolvedValue(undefined),
        finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
        markAccountSynced: jest.fn().mockResolvedValue(undefined),
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 1,
          ordersUpdated: 0,
          itemsPersisted: 1,
        }),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');
    expect(result.status).toBe('SUCCESS');
    expect(result.ordersFetched).toBe(2); // ambos chegaram da API
    expect(result.ordersUpserted).toBe(1); // só o bom foi persistido
    const persistOrdersCalls = persistence.persistOrders.mock
      .calls as unknown[][];
    const persistedOrders = persistOrdersCalls[0][0] as Array<{
      externalOrderId: string;
    }>;
    expect(persistedOrders).toHaveLength(1);
    expect(persistedOrders[0].externalOrderId).toBe('GOOD');
  });

  it('a failure partway through pagination persists NOTHING and marks the sync_run as failed', async () => {
    const { service, persistence } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValueOnce(
            successPage([rawOrder({ orderId: 'A' })], 'token-2'),
          )
          .mockResolvedValue({ kind: 'client_error' }),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED_REQUEST',
    });
    expect(persistence.persistOrders).not.toHaveBeenCalled();
    expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
      'run-1',
      'PROVIDER_REJECTED_REQUEST',
      expect.any(String),
      expect.any(Date),
    );
    expect(persistence.finalizeSyncRunSuccess).not.toHaveBeenCalled();
  });

  it('two concurrent syncs on the same account: the second gets SYNC_ALREADY_RUNNING', async () => {
    const { service, persistence } = buildService({
      persistence: {
        beginSyncRun: jest
          .fn()
          .mockRejectedValue(new SyncAlreadyRunningError()),
        finalizeSyncRunSuccess: jest.fn(),
        finalizeSyncRunFailure: jest.fn(),
        markAccountSynced: jest.fn(),
        persistOrders: jest.fn(),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'SYNC_ALREADY_RUNNING',
    });
    expect(persistence.finalizeSyncRunFailure).not.toHaveBeenCalled();
  });

  it('an invalid provider response fails the sync with INVALID_PROVIDER_RESPONSE', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({
          kind: 'success',
          body: { not: 'the right shape' },
        }),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
  });

  it('stops paginating at the hard safety page cap — never an infinite loop even with an endless nextToken', async () => {
    const { service, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(successPage([], 'always-more')),
          ),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');
    expect(result.status).toBe('SUCCESS');
    expect(spApiClient.searchOrders.mock.calls.length).toBeLessThanOrEqual(200);
  }, 15000);
});

describe('AmazonOrdersSyncService — accepted allowlist on the returned summary', () => {
  it('never returns individual order ids, SKUs, titles, tokens or raw bodies — only aggregate counters', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue(
            successPage([rawOrder({ orderId: 'SHOULD_NEVER_LEAK' })], null),
          ),
      },
      persistence: {
        beginSyncRun: jest.fn().mockResolvedValue('run-1'),
        finalizeSyncRunSuccess: jest.fn().mockResolvedValue(undefined),
        finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
        markAccountSynced: jest.fn().mockResolvedValue(undefined),
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 1,
          ordersUpdated: 0,
          itemsPersisted: 1,
        }),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');
    expect(Object.keys(result).sort()).toEqual(
      [
        'syncRunId',
        'status',
        'dateFrom',
        'dateTo',
        'pagesFetched',
        'ordersFetched',
        'ordersUpserted',
        'itemsUpserted',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('SHOULD_NEVER_LEAK');
    expect(JSON.stringify(result)).not.toContain('access-token');
  });
});
