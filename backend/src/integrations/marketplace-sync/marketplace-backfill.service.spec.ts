import { Marketplace } from '../contracts/marketplace.enum';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncAlreadyRunningError } from '../marketplace-orders/marketplace-orders-persistence.service';
import { SyncOrdersError } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { AmazonOrdersSyncError } from '../amazon-orders/amazon-orders-sync.service';
import { BackfillJobActiveConflictError } from './backfill-jobs-persistence.service';
import {
  BackfillError,
  MarketplaceBackfillService,
} from './marketplace-backfill.service';

function backfillJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    marketplaceAccountId: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    status: 'QUEUED',
    chunksProcessed: 0,
    attemptCount: 0,
    requestedAt: new Date('2026-09-01T00:00:00.000Z'),
    startedAt: null,
    lastActivityAt: null,
    nextAttemptAt: new Date('2026-09-01T00:00:00.000Z'),
    completedAt: null,
    lastErrorCode: null,
    pauseRequested: false,
    leaseOwner: null,
    leaseExpiresAt: null,
    version: 0,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

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

function syncRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    marketplaceAccountId: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    type: SyncRunType.INITIAL,
    status: SyncRunStatus.SUCCESS,
    startedAt: new Date('2026-06-01T00:00:00.000Z'),
    finishedAt: new Date('2026-06-01T00:01:00.000Z'),
    dateFrom: new Date('2026-05-02T00:00:00.000Z'),
    dateTo: new Date('2026-06-01T00:00:00.000Z'),
    recordsRead: 5,
    recordsCreated: 5,
    recordsUpdated: 0,
    recordsFailed: 0,
    errorCode: null,
    pagesFetched: 1,
    itemsPersisted: 5,
    errorSummary: null,
    createdAt: new Date('2026-06-01T00:01:00.000Z'),
    ...overrides,
  };
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
    mlSyncService?: Record<string, jest.Mock>;
    amazonSyncService?: Record<string, jest.Mock>;
    syncRunsService?: Record<string, jest.Mock>;
    jobsPersistence?: Record<string, jest.Mock>;
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
    getAccountOrderDateRange: jest.fn().mockResolvedValue({
      first: new Date('2026-06-01T00:00:00.000Z'),
      last: new Date('2026-06-30T00:00:00.000Z'),
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
  const syncRunsService = {
    findAll: jest.fn().mockResolvedValue([syncRun()]),
    ...overrides.syncRunsService,
  };
  const jobsPersistence = {
    findLatestJob: jest.fn().mockResolvedValue(null),
    createJob: jest.fn(),
    requestPause: jest.fn().mockResolvedValue(null),
    resumeJob: jest.fn().mockResolvedValue(null),
    ...overrides.jobsPersistence,
  };

  const service = new MarketplaceBackfillService(
    marketplaceAccountsService as never,
    persistence as never,
    mlSyncService as never,
    amazonSyncService as never,
    syncRunsService as never,
    jobsPersistence as never,
  );

  return {
    service,
    marketplaceAccountsService,
    persistence,
    mlSyncService,
    amazonSyncService,
    syncRunsService,
    jobsPersistence,
  };
}

describe('MarketplaceBackfillService', () => {
  describe('getStatus', () => {
    it('reports NOT_STARTED for an account never synced', async () => {
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
      expect(status).toEqual({
        status: 'NOT_STARTED',
        oldestCoveredAt: null,
        firstOrderAt: null,
        lastOrderAt: null,
        synchronizedIntervals: [],
        lastProcessedChunk: null,
        lastRunErrorCode: null,
        job: null,
      });
    });

    it('reports IN_PROGRESS with firstOrderAt/lastOrderAt/intervals/last chunk when there is coverage and room before the safety floor', async () => {
      const { service } = buildService();
      const status = await service.getStatus('acc-1');
      expect(status.status).toBe('IN_PROGRESS');
      expect(status.oldestCoveredAt).toBe('2026-05-31');
      expect(status.firstOrderAt).toBe('2026-05-31');
      expect(status.lastOrderAt).toBe('2026-06-29');
      expect(status.synchronizedIntervals).toEqual([
        { from: '2026-05-31', to: '2026-06-30' },
      ]);
      expect(status.lastProcessedChunk).toEqual({
        from: '2026-05-01',
        to: '2026-05-31',
        ordersFetched: 5,
      });
    });

    it('never marks status as complete/safety-limit just because the oldest run had zero records (an empty chunk is not proof of the history start)', async () => {
      const { service } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: new Date('2026-06-01T00:00:00.000Z'),
            oldestRunRecordsRead: 0,
          }),
        },
      });
      const status = await service.getStatus('acc-1');
      expect(status.status).toBe('IN_PROGRESS');
    });

    it('reports SAFETY_LIMIT_REACHED once the next chunk window would cross the defensive floor, never claiming it proves the true start of history', async () => {
      const { service } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: new Date('2011-01-01T00:00:00.000Z'),
            oldestRunRecordsRead: 0,
          }),
          getAccountOrderDateRange: jest.fn().mockResolvedValue(null),
        },
      });
      const status = await service.getStatus('acc-1');
      expect(status.status).toBe('SAFETY_LIMIT_REACHED');
    });

    it('reports ERROR with the last run error code when the most recent run failed (transient failure, retryable)', async () => {
      const { service } = buildService({
        syncRunsService: {
          findAll: jest.fn().mockResolvedValue([
            syncRun({
              status: SyncRunStatus.FAILED,
              errorCode: 'STALE_RUN_RECOVERED',
            }),
          ]),
        },
      });
      const status = await service.getStatus('acc-1');
      expect(status.status).toBe('ERROR');
      expect(status.lastRunErrorCode).toBe('STALE_RUN_RECOVERED');
    });

    it('never omits synchronizedIntervals — always an array, empty or not, never undefined (regression: stale process serving the pre-Fase-4 contract)', async () => {
      const { service: neverSynced } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: null,
            oldestRunRecordsRead: null,
          }),
        },
      });
      expect(
        Array.isArray(
          (await neverSynced.getStatus('acc-1')).synchronizedIntervals,
        ),
      ).toBe(true);
      expect(
        (await neverSynced.getStatus('acc-1')).synchronizedIntervals,
      ).toEqual([]);

      const { service: withCoverage } = buildService();
      expect(
        Array.isArray(
          (await withCoverage.getStatus('acc-1')).synchronizedIntervals,
        ),
      ).toBe(true);
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

    it('never stops on a single empty chunk: hasMoreHistory stays true even when the chunk returned zero orders', async () => {
      const { service, mlSyncService } = buildService({
        mlSyncService: {
          syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
        },
      });
      const result = await service.runNextChunk('acc-1');
      expect(result.hasMoreHistory).toBe(true);
      expect(result.ordersFetched).toBe(0);
      expect(mlSyncService.syncOrders).toHaveBeenCalled();
    });

    it('keeps walking backwards across multiple consecutive empty chunks without ever stopping prematurely', async () => {
      const { service, persistence, mlSyncService } = buildService({
        mlSyncService: {
          syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
        },
      });

      let oldestFrom = new Date('2026-06-01T00:00:00.000Z');
      persistence.getAccountSyncCoverage.mockImplementation(() =>
        Promise.resolve({
          intervals: [],
          oldestFrom,
          oldestRunRecordsRead: 0,
        }),
      );

      const first = await service.runNextChunk('acc-1');
      expect(first.hasMoreHistory).toBe(true);
      oldestFrom = new Date(first.oldestCoveredAt + 'T00:00:00.000Z');

      const second = await service.runNextChunk('acc-1');
      expect(second.hasMoreHistory).toBe(true);
      expect(new Date(second.oldestCoveredAt).getTime()).toBeLessThan(
        oldestFrom.getTime(),
      );
      expect(mlSyncService.syncOrders).toHaveBeenCalledTimes(2);
    });

    it('returns hasMoreHistory=false without calling the provider once the next chunk would cross the defensive safety floor', async () => {
      const { service, mlSyncService } = buildService({
        persistence: {
          recoverStaleRunningRuns: jest.fn().mockResolvedValue(0),
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: new Date('2011-01-01T00:00:00.000Z'),
            oldestRunRecordsRead: 0,
          }),
        },
      });

      const result = await service.runNextChunk('acc-1');

      expect(result).toEqual({
        hasMoreHistory: false,
        oldestCoveredAt: '2010-12-31',
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

    it('reports hasMoreHistory=true and the fetched count when the chunk returned orders', async () => {
      const { service } = buildService({
        mlSyncService: {
          syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 12 }),
        },
      });
      const result = await service.runNextChunk('acc-1');
      expect(result.hasMoreHistory).toBe(true);
      expect(result.ordersFetched).toBe(12);
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

  describe('startBackfill', () => {
    it('creates a job when the account is connected and has an initial sync', async () => {
      const { service, jobsPersistence } = buildService();
      jobsPersistence.findLatestJob.mockResolvedValue(backfillJobRow());

      const status = await service.startBackfill('acc-1');

      expect(jobsPersistence.createJob).toHaveBeenCalledWith(
        'acc-1',
        Marketplace.MERCADO_LIVRE,
      );
      expect(status.job).toMatchObject({ id: 'job-1', status: 'QUEUED' });
    });

    it('is idempotent: an active-job conflict never throws — returns the existing job status', async () => {
      const { service, jobsPersistence } = buildService({
        jobsPersistence: {
          createJob: jest
            .fn()
            .mockRejectedValue(new BackfillJobActiveConflictError()),
        },
      });
      jobsPersistence.findLatestJob.mockResolvedValue(
        backfillJobRow({ status: 'RUNNING' }),
      );

      const status = await service.startBackfill('acc-1');
      expect(status.job).toMatchObject({ status: 'RUNNING' });
    });

    it('rejects a disconnected account with ACCOUNT_NOT_CONNECTED, never creating a job', async () => {
      const { service, jobsPersistence } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(
              account({ status: MarketplaceAccountStatus.DISCONNECTED }),
            ),
        },
      });
      await expect(service.startBackfill('acc-1')).rejects.toMatchObject({
        code: 'ACCOUNT_NOT_CONNECTED',
      });
      expect(jobsPersistence.createJob).not.toHaveBeenCalled();
    });

    it('rejects an account with no initial sync yet, never creating a job', async () => {
      const { service, jobsPersistence } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: null,
            oldestRunRecordsRead: null,
          }),
        },
      });
      await expect(service.startBackfill('acc-1')).rejects.toMatchObject({
        code: 'NO_INITIAL_SYNC_YET',
      });
      expect(jobsPersistence.createJob).not.toHaveBeenCalled();
    });
  });

  describe('pauseBackfill / resumeBackfill', () => {
    it('pauseBackfill delegates to jobsPersistence.requestPause and returns the fresh status', async () => {
      const { service, jobsPersistence } = buildService();
      jobsPersistence.requestPause.mockResolvedValue(
        backfillJobRow({ status: 'PAUSED' }),
      );
      jobsPersistence.findLatestJob.mockResolvedValue(
        backfillJobRow({ status: 'PAUSED' }),
      );

      const status = await service.pauseBackfill('acc-1');
      expect(jobsPersistence.requestPause).toHaveBeenCalledWith('acc-1');
      expect(status.job).toMatchObject({ status: 'PAUSED' });
    });

    it('resumeBackfill delegates to jobsPersistence.resumeJob and returns the fresh status', async () => {
      const { service, jobsPersistence } = buildService();
      jobsPersistence.resumeJob.mockResolvedValue(
        backfillJobRow({ status: 'QUEUED' }),
      );
      jobsPersistence.findLatestJob.mockResolvedValue(
        backfillJobRow({ status: 'QUEUED' }),
      );

      const status = await service.resumeBackfill('acc-1');
      expect(jobsPersistence.resumeJob).toHaveBeenCalledWith('acc-1');
      expect(status.job).toMatchObject({ status: 'QUEUED' });
    });
  });

  describe('getStatus — job', () => {
    it('exposes job: null when no backfill job was ever created for the account', async () => {
      const { service, jobsPersistence } = buildService();
      jobsPersistence.findLatestJob.mockResolvedValue(null);
      const status = await service.getStatus('acc-1');
      expect(status.job).toBeNull();
    });

    it('exposes the job summary alongside the existing coverage-derived fields', async () => {
      const { service, jobsPersistence } = buildService();
      jobsPersistence.findLatestJob.mockResolvedValue(
        backfillJobRow({
          status: 'RETRY_WAIT',
          chunksProcessed: 4,
          attemptCount: 2,
          lastErrorCode: 'PROVIDER_RATE_LIMITED',
        }),
      );
      const status = await service.getStatus('acc-1');
      expect(status.job).toMatchObject({
        status: 'RETRY_WAIT',
        chunksProcessed: 4,
        attemptCount: 2,
        lastErrorCode: 'PROVIDER_RATE_LIMITED',
      });
      // Campos antigos continuam intactos.
      expect(status.oldestCoveredAt).toBe('2026-05-31');
    });
  });
});
