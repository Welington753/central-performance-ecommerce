import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncAlreadyRunningError } from '../marketplace-orders/marketplace-orders-persistence.service';
import { SyncOrdersError } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { AmazonOrdersSyncError } from '../amazon-orders/amazon-orders-sync.service';
import {
  BackfillError,
  MarketplaceBackfillService,
} from './marketplace-backfill.service';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: '111',
    nickname: null,
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
    ...overrides,
  };
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
    mlSyncService?: Record<string, jest.Mock>;
    amazonSyncService?: Record<string, jest.Mock>;
  } = {},
) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    ...overrides.marketplaceAccountsService,
  };
  const persistence = {
    recoverStaleRunningRuns: jest.fn().mockResolvedValue(0),
    getAccountSyncCoverage: jest.fn().mockResolvedValue({
      intervals: [
        {
          from: new Date('2026-06-01T00:00:00.000Z'),
          to: new Date('2026-07-01T00:00:00.000Z'),
        },
      ],
      oldestFrom: new Date('2026-06-01T00:00:00.000Z'),
      oldestRunRecordsRead: 5,
    }),
    ...overrides.persistence,
  };
  const mlSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 3 }),
    ...overrides.mlSyncService,
  };
  const amazonSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 3 }),
    ...overrides.amazonSyncService,
  };

  const service = new MarketplaceBackfillService(
    marketplaceAccountsService as never,
    persistence as never,
    mlSyncService as never,
    amazonSyncService as never,
  );

  return {
    service,
    marketplaceAccountsService,
    persistence,
    mlSyncService,
    amazonSyncService,
  };
}

describe('MarketplaceBackfillService', () => {
  describe('getStatus', () => {
    it('reports the oldest covered date and historyComplete = false when the oldest run still had orders', async () => {
      const { service } = buildService();
      const status = await service.getStatus('acc-1');
      expect(status).toEqual({
        oldestCoveredAt: '2026-05-31',
        historyComplete: false,
      });
    });

    it('reports historyComplete = true when the oldest run returned zero orders', async () => {
      const { service } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: new Date('2026-01-01T00:00:00.000Z'),
            oldestRunRecordsRead: 0,
          }),
        },
      });
      const status = await service.getStatus('acc-1');
      expect(status.historyComplete).toBe(true);
    });

    it('reports oldestCoveredAt = null for an account never synced', async () => {
      const { service } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: null,
            oldestRunRecordsRead: null,
          }),
        },
      });
      const status = await service.getStatus('acc-1');
      expect(status).toEqual({ oldestCoveredAt: null, historyComplete: false });
    });
  });

  describe('runNextChunk', () => {
    it('recovers stale RUNNING runs before doing anything else', async () => {
      const { service, persistence } = buildService();
      await service.runNextChunk('acc-1');
      expect(persistence.recoverStaleRunningRuns).toHaveBeenCalled();
    });

    it('rejects a disconnected account with ACCOUNT_NOT_CONNECTED', async () => {
      const { service } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(
              account({ status: MarketplaceAccountStatus.DISCONNECTED }),
            ),
        },
      });
      await expect(service.runNextChunk('acc-1')).rejects.toMatchObject({
        code: 'ACCOUNT_NOT_CONNECTED',
      });
    });

    it('rejects an account with no initial sync yet with NO_INITIAL_SYNC_YET', async () => {
      const { service } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: null,
            oldestRunRecordsRead: null,
          }),
        },
      });
      await expect(service.runNextChunk('acc-1')).rejects.toMatchObject({
        code: 'NO_INITIAL_SYNC_YET',
      });
    });

    it('is idempotent: returns hasMoreHistory=false without calling the provider once history is already proven complete', async () => {
      const { service, mlSyncService } = buildService({
        persistence: {
          recoverStaleRunningRuns: jest.fn().mockResolvedValue(0),
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: new Date('2026-01-01T00:00:00.000Z'),
            oldestRunRecordsRead: 0,
          }),
        },
      });

      const result = await service.runNextChunk('acc-1');

      expect(result).toEqual({
        hasMoreHistory: false,
        oldestCoveredAt: '2025-12-31',
        ordersFetched: 0,
      });
      expect(mlSyncService.syncOrders).not.toHaveBeenCalled();
    });

    it('dispatches a Mercado Livre account to MercadoLivreOrdersSyncService with a contiguous, older windowOverride and type INITIAL', async () => {
      const { service, mlSyncService } = buildService();

      await service.runNextChunk('acc-1');

      expect(mlSyncService.syncOrders).toHaveBeenCalledWith('acc-1', {
        windowOverride: {
          from: new Date('2026-05-02T00:00:00.000Z'),
          to: new Date('2026-06-01T00:00:00.000Z'),
        },
        type: 'INITIAL',
      });
    });

    it('dispatches an Amazon account to AmazonOrdersSyncService with a windowOverride and type INITIAL', async () => {
      const { service, amazonSyncService } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(account({ marketplace: Marketplace.AMAZON })),
        },
      });

      await service.runNextChunk('acc-1');

      expect(amazonSyncService.syncOrders).toHaveBeenCalledWith(
        'acc-1',
        {},
        {
          windowOverride: {
            from: new Date('2026-05-02T00:00:00.000Z'),
            to: new Date('2026-06-01T00:00:00.000Z'),
          },
          type: 'INITIAL',
        },
      );
    });

    it('reports hasMoreHistory=true when the chunk returned orders', async () => {
      const { service } = buildService({
        mlSyncService: {
          syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 12 }),
        },
      });
      const result = await service.runNextChunk('acc-1');
      expect(result.hasMoreHistory).toBe(true);
      expect(result.ordersFetched).toBe(12);
    });

    it('reports hasMoreHistory=false when the chunk itself came back with zero orders (edge of history found)', async () => {
      const { service } = buildService({
        mlSyncService: {
          syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
        },
      });
      const result = await service.runNextChunk('acc-1');
      expect(result.hasMoreHistory).toBe(false);
    });

    it('maps SyncAlreadyRunningError to BACKFILL_ALREADY_RUNNING', async () => {
      const { service } = buildService({
        mlSyncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(new SyncAlreadyRunningError()),
        },
      });
      await expect(service.runNextChunk('acc-1')).rejects.toMatchObject({
        code: 'BACKFILL_ALREADY_RUNNING',
      });
    });

    it('maps ML SyncOrdersError("SYNC_ALREADY_RUNNING") to BACKFILL_ALREADY_RUNNING', async () => {
      const { service } = buildService({
        mlSyncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(new SyncOrdersError('SYNC_ALREADY_RUNNING')),
        },
      });
      await expect(service.runNextChunk('acc-1')).rejects.toBeInstanceOf(
        BackfillError,
      );
      await expect(service.runNextChunk('acc-1')).rejects.toMatchObject({
        code: 'BACKFILL_ALREADY_RUNNING',
      });
    });

    it('maps AmazonOrdersSyncError("AMAZON_NOT_CONFIGURED") to AMAZON_NOT_CONFIGURED', async () => {
      const { service } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(account({ marketplace: Marketplace.AMAZON })),
        },
        amazonSyncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(
              new AmazonOrdersSyncError('AMAZON_NOT_CONFIGURED'),
            ),
        },
      });
      await expect(service.runNextChunk('acc-1')).rejects.toMatchObject({
        code: 'AMAZON_NOT_CONFIGURED',
      });
    });

    it('falls back to SYNC_FAILED for an unrecognized error', async () => {
      const { service } = buildService({
        mlSyncService: {
          syncOrders: jest.fn().mockRejectedValue(new Error('boom')),
        },
      });
      await expect(service.runNextChunk('acc-1')).rejects.toMatchObject({
        code: 'SYNC_FAILED',
      });
    });
  });
});
