import { ConflictException, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncAlreadyRunningError } from '../marketplace-orders/marketplace-orders-persistence.service';
import { MercadoLivreOrdersSyncService } from './mercado-livre-orders-sync.service';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: '1548451374',
    nickname: 'EZIEHOME',
    status: MarketplaceAccountStatus.CONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
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

function rawOrder(id: string) {
  return {
    id,
    status: 'paid',
    currency_id: 'BRL',
    total_amount: 100,
    pack_id: null,
    date_created: '2026-08-15T10:00:00.000-04:00',
    date_closed: '2026-08-15T10:05:00.000-04:00',
    last_updated: '2026-08-15T10:05:00.000-04:00',
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

function pageBody(orders: unknown[], total: number, offset: number) {
  return { paging: { total, offset, limit: 50 }, results: orders };
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    oauthService?: Record<string, jest.Mock>;
    httpClient?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
  } = {},
) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    ...overrides.marketplaceAccountsService,
  };
  const oauthService = {
    ensureValidAccessToken: jest.fn().mockResolvedValue('access-token'),
    ...overrides.oauthService,
  };
  const httpClient = {
    fetchOrdersPage: jest
      .fn()
      .mockResolvedValue({ kind: 'success', body: pageBody([], 0, 0) }),
    ...overrides.httpClient,
  };
  const persistence = {
    beginSyncRun: jest.fn().mockResolvedValue('run-1'),
    finalizeSyncRunSuccess: jest.fn().mockResolvedValue(undefined),
    finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
    persistOrders: jest.fn().mockResolvedValue({
      ordersCreated: 0,
      ordersUpdated: 0,
      itemsPersisted: 0,
    }),
    markAccountSynced: jest.fn().mockResolvedValue(undefined),
    ...overrides.persistence,
  };

  const service = new MercadoLivreOrdersSyncService(
    marketplaceAccountsService as never,
    oauthService as never,
    httpClient as never,
    persistence as never,
  );

  return {
    service,
    marketplaceAccountsService,
    oauthService,
    httpClient,
    persistence,
  };
}

describe('MercadoLivreOrdersSyncService.syncOrders', () => {
  it.each([Marketplace.AMAZON, Marketplace.SHOPEE])(
    'rejects with NotFoundException when the account marketplace is %s',
    async (marketplace) => {
      const { service } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest.fn().mockResolvedValue(account({ marketplace })),
        },
      });
      await expect(service.syncOrders('acc-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('propagates NotFoundException when the account does not exist', async () => {
    const { service } = buildService({
      marketplaceAccountsService: {
        findByIdOrFail: jest
          .fn()
          .mockRejectedValue(new NotFoundException('não encontrada')),
      },
    });
    await expect(service.syncOrders('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    MarketplaceAccountStatus.DISCONNECTED,
    MarketplaceAccountStatus.TOKEN_EXPIRED,
    MarketplaceAccountStatus.ERROR,
  ])('rejects with ACCOUNT_NOT_CONNECTED when status is %s', async (status) => {
    const { service, persistence } = buildService({
      marketplaceAccountsService: {
        findByIdOrFail: jest.fn().mockResolvedValue(account({ status })),
      },
    });

    await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_CONNECTED',
    });
    // Nunca chega a criar um sync_run para uma conta desconectada.
    expect(persistence.beginSyncRun).not.toHaveBeenCalled();
  });

  it('rejects with SYNC_ALREADY_RUNNING and never calls the provider when a run is already active', async () => {
    const { service, oauthService, httpClient } = buildService({
      persistence: {
        beginSyncRun: jest
          .fn()
          .mockRejectedValue(new SyncAlreadyRunningError()),
      },
    });

    await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
      code: 'SYNC_ALREADY_RUNNING',
    });
    expect(oauthService.ensureValidAccessToken).not.toHaveBeenCalled();
    expect(httpClient.fetchOrdersPage).not.toHaveBeenCalled();
  });

  it('paginates through multiple pages until paging.total is reached', async () => {
    const fetchOrdersPage = jest
      .fn()
      .mockResolvedValueOnce({
        kind: 'success',
        body: pageBody([rawOrder('1'), rawOrder('2')], 60, 0),
      })
      .mockResolvedValueOnce({
        kind: 'success',
        body: pageBody([rawOrder('3')], 60, 50),
      });

    const { service, persistence } = buildService({
      httpClient: { fetchOrdersPage },
      persistence: {
        beginSyncRun: jest.fn().mockResolvedValue('run-1'),
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 3,
          ordersUpdated: 0,
          itemsPersisted: 3,
        }),
      },
    });

    const summary = await service.syncOrders('acc-1');

    expect(fetchOrdersPage).toHaveBeenCalledTimes(2);
    const calls = fetchOrdersPage.mock.calls as unknown as Array<
      [{ offset: number }]
    >;
    expect(calls[0][0]).toMatchObject({ offset: 0 });
    expect(calls[1][0]).toMatchObject({ offset: 50 });
    expect(summary.pagesFetched).toBe(2);
    expect(summary.ordersFetched).toBe(3);
    expect(summary.ordersCreated).toBe(3);
    expect(summary.itemsPersisted).toBe(3);
    expect(persistence.persistOrders).toHaveBeenCalledTimes(1);
  });

  it('stops paginating when a page returns no results, even if paging.total implies more', async () => {
    const fetchOrdersPage = jest.fn().mockResolvedValue({
      kind: 'success',
      body: pageBody([], 500, 0),
    });
    const { service } = buildService({ httpClient: { fetchOrdersPage } });

    const summary = await service.syncOrders('acc-1');
    expect(fetchOrdersPage).toHaveBeenCalledTimes(1);
    expect(summary.ordersFetched).toBe(0);
  });

  it.each([
    ['unauthorized', 'PROVIDER_UNAVAILABLE'],
    ['provider_unavailable', 'PROVIDER_UNAVAILABLE'],
    ['rate_limited', 'PROVIDER_RATE_LIMITED'],
    ['invalid_response', 'INVALID_PROVIDER_RESPONSE'],
  ])(
    'maps http outcome "%s" to SyncOrdersError "%s" and finalizes the run as FAILED',
    async (kind, expectedCode) => {
      const { service, persistence } = buildService({
        httpClient: { fetchOrdersPage: jest.fn().mockResolvedValue({ kind }) },
      });

      await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
        code: expectedCode,
      });
      expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
        'run-1',
        expectedCode,
        expect.any(String),
        expect.any(Date),
      );
      expect(persistence.persistOrders).not.toHaveBeenCalled();
    },
  );

  it('treats a structurally invalid 200 body as INVALID_PROVIDER_RESPONSE', async () => {
    const { service, persistence } = buildService({
      httpClient: {
        fetchOrdersPage: jest
          .fn()
          .mockResolvedValue({ kind: 'success', body: { not: 'valid' } }),
      },
    });

    await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
    expect(persistence.persistOrders).not.toHaveBeenCalled();
  });

  it('maps any unexpected error to SYNC_FAILED and finalizes the run as FAILED', async () => {
    const { service, persistence } = buildService({
      oauthService: {
        ensureValidAccessToken: jest.fn().mockRejectedValue(new Error('boom')),
      },
    });

    await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
      code: 'SYNC_FAILED',
    });
    expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
      'run-1',
      'SYNC_FAILED',
      expect.any(String),
      expect.any(Date),
    );
  });

  it.each([
    ['REFRESH_TOKEN_REJECTED', 'TOKEN_EXPIRED'],
    ['ACCOUNT_BUSY', 'ACCOUNT_BUSY'],
  ])(
    'maps ConflictException("%s") from ensureValidAccessToken to SyncOrdersError "%s" instead of masking it as SYNC_FAILED',
    async (conflictMessage, expectedCode) => {
      const { service, persistence } = buildService({
        oauthService: {
          ensureValidAccessToken: jest
            .fn()
            .mockRejectedValue(new ConflictException(conflictMessage)),
        },
      });

      await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
        code: expectedCode,
      });
      expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
        'run-1',
        expectedCode,
        expect.any(String),
        expect.any(Date),
      );
    },
  );

  it('maps an unrecognized ConflictException from ensureValidAccessToken to the generic SYNC_FAILED fallback', async () => {
    const { service, persistence } = buildService({
      oauthService: {
        ensureValidAccessToken: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('CREDENTIAL_DECRYPTION_FAILED'),
          ),
      },
    });

    await expect(service.syncOrders('acc-1')).rejects.toMatchObject({
      code: 'SYNC_FAILED',
    });
    expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
      'run-1',
      'SYNC_FAILED',
      expect.any(String),
      expect.any(Date),
    );
  });

  it('never leaks the raw provider body or the access token into the returned summary', async () => {
    const fetchOrdersPage = jest.fn().mockResolvedValue({
      kind: 'success',
      body: pageBody([rawOrder('1')], 1, 0),
    });
    const { service } = buildService({
      httpClient: { fetchOrdersPage },
      persistence: {
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 1,
          ordersUpdated: 0,
          itemsPersisted: 1,
        }),
      },
    });

    const summary = await service.syncOrders('acc-1');
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('access-token');
    expect(Object.keys(summary).sort()).toEqual(
      [
        'status',
        'startedAt',
        'finishedAt',
        'pagesFetched',
        'ordersFetched',
        'ordersCreated',
        'ordersUpdated',
        'itemsPersisted',
        'periodFrom',
        'periodTo',
      ].sort(),
    );
  });

  it('marks the account as synced only after a successful persistence', async () => {
    const { service, persistence } = buildService();
    await service.syncOrders('acc-1');
    expect(persistence.markAccountSynced).toHaveBeenCalledWith(
      'acc-1',
      expect.any(Date),
    );
  });
});
