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

// Instante de referência fixo (Checkpoint 4-B-R1, "Correção 7") — todo teste
// que não sobrescreve `clock` usa este relógio, bem depois de qualquer data
// usada nos fixtures abaixo (2026-08-01 em diante), então o cutoff de 2
// minutos nunca recorta silenciosamente uma janela que os testes antigos já
// validavam byte a byte.
const FIXED_NOW = new Date('2026-08-20T15:00:00.000Z');

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
        // Contrato oficial `orders_2026-01-01` (Checkpoint 4-B-R1): o
        // faturamento realizado do item vem do breakdown `type=ITEM`, nunca
        // do preço de catálogo.
        proceeds: {
          breakdowns: [
            {
              type: 'ITEM',
              subtotal: { amount: '199.90', currencyCode: 'BRL' },
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function manyRawOrders(count: number) {
  return Array.from({ length: count }, (_, index) =>
    rawOrder({ orderId: `ORDER-${index}` }),
  );
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    authService?: Record<string, jest.Mock>;
    spApiClient?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
    configValues?: Record<string, unknown>;
    clock?: () => Date;
  } = {},
) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    ...overrides.marketplaceAccountsService,
  };
  const authService = {
    ensureValidAccessToken: jest.fn().mockResolvedValue('access-token-1'),
    refreshAccessTokenAfterUnauthorized: jest
      .fn()
      .mockResolvedValue('access-token-2'),
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
    finalizeSyncRunIncomplete: jest.fn().mockResolvedValue(undefined),
    markAccountSynced: jest.fn().mockResolvedValue(undefined),
    persistOrders: jest.fn().mockResolvedValue({
      ordersCreated: 0,
      ordersUpdated: 0,
      itemsPersisted: 0,
    }),
    getAccountSyncCoverage: jest.fn().mockResolvedValue({
      intervals: [],
      oldestFrom: null,
      oldestRunRecordsRead: null,
    }),
    ...overrides.persistence,
  };
  const configValues: Record<string, unknown> =
    overrides.configValues ?? AMAZON_ENV;
  const configService = {
    get: (key: string, fallback?: unknown) => configValues[key] ?? fallback,
  } as unknown as ConfigService;
  const sleep = jest.fn().mockResolvedValue(undefined);
  const clock = overrides.clock ?? (() => FIXED_NOW);

  const service = new AmazonOrdersSyncService(
    marketplaceAccountsService as never,
    authService as never,
    spApiClient as never,
    persistence as never,
    configService,
    sleep,
    clock,
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

  it('defaults to the initial 60-day sync window when no period is given, ending at least 2 minutes before now (Amazon cutoff)', async () => {
    const result = await buildService().service.syncOrders('acc-amazon-1');

    const from = new Date(result.dateFrom).getTime();
    const to = new Date(result.dateTo).getTime();
    const expectedTo = FIXED_NOW.getTime() - 2 * 60 * 1000;
    expect(to).toBe(expectedTo);
    // A janela de 60 dias é calculada a partir de `now` (não do cutoff
    // clampado) — só o FIM é recortado pelos 2 minutos, então a duração real
    // é 60 dias menos esses 2 minutos, nunca exatamente 60 dias.
    expect(FIXED_NOW.getTime() - from).toBeCloseTo(
      60 * 24 * 60 * 60 * 1000,
      -3,
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

  it('a single 401 forces exactly one call to refreshAccessTokenAfterUnauthorized (never a second ensureValidAccessToken) and one retry, then succeeds', async () => {
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
    expect(authService.ensureValidAccessToken).toHaveBeenCalledTimes(1);
    expect(
      authService.refreshAccessTokenAfterUnauthorized,
    ).toHaveBeenCalledTimes(1);
    expect(
      authService.refreshAccessTokenAfterUnauthorized,
    ).toHaveBeenCalledWith('acc-amazon-1', 'access-token-1');
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2);
    const secondCall = spApiClient.searchOrders.mock.calls[1] as [
      Record<string, unknown>,
    ];
    expect(secondCall[0].accessToken).toBe('access-token-2');
  });

  it('a second consecutive 401 (after the one allowed renewal) fails the sync — never loops forever, never renews twice', async () => {
    const { service, authService, spApiClient } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue({ kind: 'unauthorized' }),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(2); // 1 inicial + 1 após a única renovação
    expect(
      authService.refreshAccessTokenAfterUnauthorized,
    ).toHaveBeenCalledTimes(1);
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
    expect(persistence.finalizeSyncRunIncomplete).not.toHaveBeenCalled();
  });

  it('two concurrent syncs on the same account: the second gets SYNC_ALREADY_RUNNING', async () => {
    const { service, persistence } = buildService({
      persistence: {
        beginSyncRun: jest
          .fn()
          .mockRejectedValue(new SyncAlreadyRunningError()),
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
});

describe('AmazonOrdersSyncService — quarantine never allows SUCCESS (Correção 1)', () => {
  it('a quarantined order never lets the run end as SUCCESS: valid orders are still persisted, the run ends FAILED (INCOMPLETE_PROVIDER_DATA) with records_failed set, and the account is never marked synced', async () => {
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
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 1,
          ordersUpdated: 0,
          itemsPersisted: 1,
        }),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'INCOMPLETE_PROVIDER_DATA',
    });

    expect(persistence.persistOrders).toHaveBeenCalledTimes(1);
    const persistedOrders = (
      persistence.persistOrders.mock.calls[0] as unknown[]
    )[0] as Array<{ externalOrderId: string }>;
    expect(persistedOrders).toHaveLength(1);
    expect(persistedOrders[0].externalOrderId).toBe('GOOD');

    expect(persistence.finalizeSyncRunSuccess).not.toHaveBeenCalled();
    // Nunca finalização duplicada do mesmo run.
    expect(persistence.finalizeSyncRunFailure).not.toHaveBeenCalled();
    expect(persistence.finalizeSyncRunIncomplete).toHaveBeenCalledTimes(1);
    expect(persistence.finalizeSyncRunIncomplete).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        ordersFetched: 2,
        ordersCreated: 1,
        ordersUpdated: 0,
        recordsFailed: 1,
        pagesFetched: 1,
        itemsPersisted: 1,
      }),
      'INCOMPLETE_PROVIDER_DATA',
      expect.any(String),
      expect.any(Date),
    );
    expect(persistence.markAccountSynced).not.toHaveBeenCalled();
  });

  it('the controller-facing error never carries individual order/SKU/payload details — only the closed code', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue(
            successPage(
              [rawOrder({ orderId: 'SHOULD_NEVER_LEAK', proceeds: {} })],
              null,
            ),
          ),
      },
    });

    let caught: unknown;
    try {
      await service.syncOrders('acc-amazon-1');
    } catch (error) {
      caught = error;
    }
    expect(JSON.stringify(caught)).not.toContain('SHOULD_NEVER_LEAK');
    expect(JSON.stringify(caught)).toContain('INCOMPLETE_PROVIDER_DATA');
  });
});

describe('AmazonOrdersSyncService — safety caps never produce SUCCESS on a truncated batch (Correção 2)', () => {
  it('a nextToken still pending at the hard safety PAGE cap fails safely: never SUCCESS, nothing persisted, account never marked synced', async () => {
    const { service, spApiClient, persistence } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(successPage([], 'always-more')),
          ),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PAGINATION_LIMIT_EXCEEDED',
    });
    expect(spApiClient.searchOrders).toHaveBeenCalledTimes(200);
    expect(persistence.persistOrders).not.toHaveBeenCalled();
    expect(persistence.markAccountSynced).not.toHaveBeenCalled();
    expect(persistence.finalizeSyncRunSuccess).not.toHaveBeenCalled();
    expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
      'run-1',
      'PAGINATION_LIMIT_EXCEEDED',
      expect.any(String),
      expect.any(Date),
    );
  }, 15000);

  it('exactly reaching the page cap on the LAST page (no pending nextToken) still succeeds — hitting a limit is not automatically a truncation', async () => {
    let call = 0;
    const searchOrders = jest.fn().mockImplementation(() => {
      call += 1;
      const nextToken = call < 200 ? `token-${call}` : null;
      return Promise.resolve(successPage([], nextToken));
    });
    const { service } = buildService({ spApiClient: { searchOrders } });

    const result = await service.syncOrders('acc-amazon-1');
    expect(result.status).toBe('SUCCESS');
    expect(result.pagesFetched).toBe(200);
    expect(searchOrders).toHaveBeenCalledTimes(200);
  }, 15000);

  it('a nextToken still pending at the hard safety ORDER cap fails safely: never SUCCESS, nothing persisted', async () => {
    const { service, persistence } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue(
            successPage(manyRawOrders(20000), 'more-after-cap'),
          ),
      },
    });

    await expect(service.syncOrders('acc-amazon-1')).rejects.toMatchObject({
      code: 'PAGINATION_LIMIT_EXCEEDED',
    });
    expect(persistence.persistOrders).not.toHaveBeenCalled();
    expect(persistence.markAccountSynced).not.toHaveBeenCalled();
  }, 20000);

  it('exactly reaching the order cap with NO pending nextToken still succeeds', async () => {
    const { service } = buildService({
      spApiClient: {
        searchOrders: jest
          .fn()
          .mockResolvedValue(successPage(manyRawOrders(20000), null)),
      },
      persistence: {
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 20000,
          ordersUpdated: 0,
          itemsPersisted: 20000,
        }),
      },
    });

    const result = await service.syncOrders('acc-amazon-1');
    expect(result.status).toBe('SUCCESS');
    expect(result.ordersFetched).toBe(20000);
  }, 20000);
});

describe('AmazonOrdersSyncService — the 2-minute Amazon cutoff (Correção 7)', () => {
  it('a custom period that includes today is clamped to now - 2min, and that is what gets persisted as sync_runs.date_to', async () => {
    const { service, persistence } = buildService({
      spApiClient: {
        searchOrders: jest.fn().mockResolvedValue(successPage([], null)),
      },
    });

    const result = await service.syncOrders('acc-amazon-1', {
      from: '2026-08-18',
      to: '2026-08-20', // hoje, relativo a FIXED_NOW
    });

    const expectedCutoff = new Date(
      FIXED_NOW.getTime() - 2 * 60 * 1000,
    ).toISOString();
    expect(result.dateTo).toBe(expectedCutoff);
    expect(persistence.beginSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ periodTo: new Date(expectedCutoff) }),
    );
  });

  it('rejects a period whose "to" is a future calendar day (América/São_Paulo) before any network call', async () => {
    const { service, spApiClient } = buildService();

    await expect(
      service.syncOrders('acc-amazon-1', {
        from: '2026-08-18',
        to: '2026-08-21', // depois de FIXED_NOW (2026-08-20)
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    expect(spApiClient.searchOrders).not.toHaveBeenCalled();
  });

  it('rejects an excessively long custom range before any network call', async () => {
    const { service, spApiClient } = buildService();

    await expect(
      service.syncOrders('acc-amazon-1', {
        from: '2020-01-01',
        to: '2026-08-20',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    expect(spApiClient.searchOrders).not.toHaveBeenCalled();
  });
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

  describe('incremental window (Fase 4, "Histórico completo")', () => {
    it('uses the full 60-day initial window on the very first sync (no prior coverage)', async () => {
      let captured: { periodFrom: Date; periodTo: Date } | undefined;
      const { service } = buildService({
        persistence: {
          beginSyncRun: jest.fn((input: typeof captured) => {
            captured = input;
            return Promise.resolve('run-1');
          }),
        },
      });

      await service.syncOrders('acc-amazon-1');

      const spanDays = Math.round(
        (captured!.periodTo.getTime() - captured!.periodFrom.getTime()) /
          (24 * 60 * 60 * 1000),
      );
      expect(spanDays).toBe(60);
    });

    it('continues from the last covered edge on a recurring sync — never the full 60 days again', async () => {
      let captured: { periodFrom: Date } | undefined;
      const { service } = buildService({
        persistence: {
          beginSyncRun: jest.fn((input: typeof captured) => {
            captured = input;
            return Promise.resolve('run-1');
          }),
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [
              {
                from: new Date('2026-06-01T00:00:00.000Z'),
                to: new Date('2026-08-19T00:00:00.000Z'),
              },
            ],
            oldestFrom: new Date('2026-06-01T00:00:00.000Z'),
            oldestRunRecordsRead: 10,
          }),
        },
      });

      await service.syncOrders('acc-amazon-1');

      expect(captured!.periodFrom.toISOString()).toBe(
        '2026-08-18T00:00:00.000Z',
      );
    });
  });
});
