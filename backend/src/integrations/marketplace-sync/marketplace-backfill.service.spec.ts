import { Marketplace } from '../contracts/marketplace.enum';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncAlreadyRunningError } from '../marketplace-orders/marketplace-orders-persistence.service';
import { SyncOrdersError } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { AmazonOrdersSyncError } from '../amazon-orders/amazon-orders-sync.service';
import { ShopeeOrdersSyncError } from '../shopee-orders/shopee-orders-sync-error';
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
    shopeeSyncService?: Record<string, jest.Mock>;
    syncRunsService?: Record<string, jest.Mock>;
    jobsPersistence?: Record<string, jest.Mock>;
    env?: Record<string, string>;
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
    attachBuyersToOrders: jest.fn().mockResolvedValue(0),
    ...overrides.persistence,
  };
  const mlSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 3 }),
    fetchOrderBuyers: jest
      .fn()
      .mockResolvedValue({ links: [], ordersFetched: 0, complete: true }),
    ...overrides.mlSyncService,
  };
  const amazonSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 3 }),
    ...overrides.amazonSyncService,
  };
  const shopeeSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 3 }),
    fetchOrderBuyers: jest
      .fn()
      .mockResolvedValue({ links: [], ordersFetched: 0, complete: true }),
    ...overrides.shopeeSyncService,
  };
  const syncRunsService = {
    findAll: jest.fn().mockResolvedValue([syncRun()]),
    ...overrides.syncRunsService,
  };
  const jobsPersistence = {
    findLatestJob: jest.fn().mockResolvedValue(null),
    findActiveJob: jest.fn().mockResolvedValue(null),
    createJob: jest.fn(),
    requestPause: jest.fn().mockResolvedValue(null),
    resumeJob: jest.fn().mockResolvedValue(null),
    ...overrides.jobsPersistence,
  };
  const env: Record<string, string> = {
    NODE_ENV: 'production',
    ...overrides.env,
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in env ? env[key] : fallback,
    ),
  };

  const service = new MarketplaceBackfillService(
    marketplaceAccountsService as never,
    persistence as never,
    mlSyncService as never,
    amazonSyncService as never,
    shopeeSyncService as never,
    syncRunsService as never,
    jobsPersistence as never,
    configService as never,
  );

  return {
    service,
    marketplaceAccountsService,
    persistence,
    mlSyncService,
    amazonSyncService,
    shopeeSyncService,
    syncRunsService,
    jobsPersistence,
    configService,
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
        workerEnabled: true,
      });
    });

    it('exposes workerEnabled=true when BACKFILL_WORKER_ENABLED is unset (default) in a non-test environment', async () => {
      const { service } = buildService();
      const status = await service.getStatus('acc-1');
      expect(status.workerEnabled).toBe(true);
    });

    it('exposes workerEnabled=false when BACKFILL_WORKER_ENABLED=false — same interpretation the worker uses to skip creating its timer', async () => {
      const { service } = buildService({
        env: { BACKFILL_WORKER_ENABLED: 'false' },
      });
      const status = await service.getStatus('acc-1');
      expect(status.workerEnabled).toBe(false);
    });

    it('exposes workerEnabled=false when NODE_ENV=test even if BACKFILL_WORKER_ENABLED says true — matches the worker, which never starts under NODE_ENV=test', async () => {
      const { service } = buildService({
        env: { NODE_ENV: 'test', BACKFILL_WORKER_ENABLED: 'true' },
      });
      const status = await service.getStatus('acc-1');
      expect(status.workerEnabled).toBe(false);
    });

    it('exposes workerEnabled even when the account has no coverage yet (NOT_STARTED)', async () => {
      const { service } = buildService({
        persistence: {
          getAccountSyncCoverage: jest.fn().mockResolvedValue({
            intervals: [],
            oldestFrom: null,
            oldestRunRecordsRead: null,
          }),
        },
        env: { BACKFILL_WORKER_ENABLED: 'false' },
      });
      const status = await service.getStatus('acc-1');
      expect(status.status).toBe('NOT_STARTED');
      expect(status.workerEnabled).toBe(false);
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

    it('dispatches a Shopee account to ShopeeOrdersSyncService with a windowOverride, type INITIAL and timeRangeField=create_time', async () => {
      const { service, shopeeSyncService } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(account({ marketplace: Marketplace.SHOPEE })),
        },
      });

      await service.runNextChunk('acc-1');

      expect(shopeeSyncService.syncOrders).toHaveBeenCalledWith('acc-1', {
        windowOverride: {
          from: new Date('2026-05-02T00:00:00.000Z'),
          to: new Date('2026-06-01T00:00:00.000Z'),
        },
        type: 'INITIAL',
        timeRangeField: 'create_time',
      });
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

    it.each([
      ['SYNC_ALREADY_RUNNING', 'BACKFILL_ALREADY_RUNNING'],
      ['NOT_CONNECTED', 'ACCOUNT_NOT_CONNECTED'],
      ['CONNECTION_BUSY', 'ACCOUNT_BUSY'],
      ['NOT_CONFIGURED', 'SHOPEE_NOT_CONFIGURED'],
      ['TEMPORARILY_UNAVAILABLE', 'SYNC_FAILED'],
      ['DATA_UNAVAILABLE', 'SYNC_FAILED'],
      ['SYNC_FAILED', 'SYNC_FAILED'],
    ])(
      'maps ShopeeOrdersSyncError("%s") to %s',
      async (shopeeCode, backfillCode) => {
        const { service } = buildService({
          marketplaceAccountsService: {
            findByIdOrFail: jest
              .fn()
              .mockResolvedValue(account({ marketplace: Marketplace.SHOPEE })),
          },
          shopeeSyncService: {
            syncOrders: jest
              .fn()
              .mockRejectedValue(
                new ShopeeOrdersSyncError(
                  shopeeCode as ConstructorParameters<
                    typeof ShopeeOrdersSyncError
                  >[0],
                ),
              ),
          },
        });
        await expect(service.runNextChunk('acc-1')).rejects.toMatchObject({
          code: backfillCode,
        });
      },
    );

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

    it('creates a job for a connected Shopee account', async () => {
      const { service, jobsPersistence } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(account({ marketplace: Marketplace.SHOPEE })),
        },
      });
      jobsPersistence.findLatestJob.mockResolvedValue(
        backfillJobRow({ marketplace: Marketplace.SHOPEE }),
      );

      const status = await service.startBackfill('acc-1');

      expect(jobsPersistence.createJob).toHaveBeenCalledWith(
        'acc-1',
        Marketplace.SHOPEE,
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

    it('"completar histórico de todas as lojas" com 2 contas ML já com job ativo e 1 Shopee sem job: reconhece as ML existentes (nunca duplica) e cria só o job Shopee que falta', async () => {
      // Espelha exatamente o botão global do frontend: uma chamada de
      // `startBackfill` POR CONTA, sequencial ou em paralelo — o backend
      // nunca recebe um "start all" em lote, então a idempotência PRECISA
      // valer chamada a chamada (regressão de produção: 2 jobs ML já
      // QUEUED + 1 conta Shopee nova).
      const accountsById: Record<string, MarketplaceAccount> = {
        'ml-1': account({
          id: 'ml-1',
          marketplace: Marketplace.MERCADO_LIVRE,
        }),
        'ml-2': account({
          id: 'ml-2',
          marketplace: Marketplace.MERCADO_LIVRE,
        }),
        'shopee-1': account({
          id: 'shopee-1',
          marketplace: Marketplace.SHOPEE,
        }),
      };
      const jobsById: Record<string, ReturnType<typeof backfillJobRow>> = {
        'ml-1': backfillJobRow({
          id: 'job-ml-1',
          marketplaceAccountId: 'ml-1',
          marketplace: Marketplace.MERCADO_LIVRE,
          status: 'QUEUED',
        }),
        'ml-2': backfillJobRow({
          id: 'job-ml-2',
          marketplaceAccountId: 'ml-2',
          marketplace: Marketplace.MERCADO_LIVRE,
          status: 'RUNNING',
        }),
        'shopee-1': backfillJobRow({
          id: 'job-shopee-1',
          marketplaceAccountId: 'shopee-1',
          marketplace: Marketplace.SHOPEE,
          status: 'QUEUED',
        }),
      };

      const { service, jobsPersistence } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockImplementation((id: string) =>
              Promise.resolve(accountsById[id]),
            ),
        },
        jobsPersistence: {
          // As duas contas ML já têm job ativo — a mesma violação do índice
          // único parcial que ocorre de verdade contra o Postgres
          // (`UQ_marketplace_backfill_jobs_active_per_account`, provada em
          // `backfill-jobs-persistence.service.integration.spec.ts`).
          // Shopee não tem job ainda: `createJob` sucede normalmente.
          createJob: jest
            .fn()
            .mockImplementation((accountId: string) =>
              accountId === 'shopee-1'
                ? Promise.resolve(jobsById['shopee-1'])
                : Promise.reject(new BackfillJobActiveConflictError()),
            ),
          findLatestJob: jest
            .fn()
            .mockImplementation((accountId: string) =>
              Promise.resolve(jobsById[accountId]),
            ),
        },
      });

      const results = await Promise.all(
        ['ml-1', 'ml-2', 'shopee-1'].map((id) => service.startBackfill(id)),
      );

      // Reconhece: cada conta devolve o job correspondente (nunca `null`,
      // nunca um id trocado entre contas).
      expect(results[0].job).toMatchObject({
        id: 'job-ml-1',
        status: 'QUEUED',
      });
      expect(results[1].job).toMatchObject({
        id: 'job-ml-2',
        status: 'RUNNING',
      });
      expect(results[2].job).toMatchObject({
        id: 'job-shopee-1',
        status: 'QUEUED',
      });

      // Nunca duplica: createJob foi chamado uma vez por conta (a chamada em
      // si é sempre feita — a idempotência vem do índice único parcial no
      // banco, exercitado aqui via `BackfillJobActiveConflictError` —, mas
      // nenhuma segunda tentativa de criação acontece para as contas ML).
      expect(jobsPersistence.createJob).toHaveBeenCalledTimes(3);
      expect(jobsPersistence.createJob).toHaveBeenCalledWith(
        'ml-1',
        Marketplace.MERCADO_LIVRE,
      );
      expect(jobsPersistence.createJob).toHaveBeenCalledWith(
        'ml-2',
        Marketplace.MERCADO_LIVRE,
      );
      // Cria só o que faltava: Shopee.
      expect(jobsPersistence.createJob).toHaveBeenCalledWith(
        'shopee-1',
        Marketplace.SHOPEE,
      );
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

describe('MarketplaceBackfillService.runBuyerEnrichmentChunk (função Clientes)', () => {
  const cursor = new Date('2026-09-01T00:00:00.000Z');
  const HOUR_MS = 60 * 60 * 1000;
  const link = {
    externalOrderId: 'O1',
    buyer: { externalBuyerId: '9' },
    observedAt: cursor,
  };
  const olderHistory = {
    getAccountOrderDateRange: jest.fn().mockResolvedValue({
      first: new Date('2026-01-01T00:00:00.000Z'),
      last: new Date('2026-08-30T00:00:00.000Z'),
    }),
    attachBuyersToOrders: jest.fn().mockResolvedValue(1),
  };
  const shopeeAccount = {
    findByIdOrFail: jest
      .fn()
      .mockResolvedValue(account({ marketplace: Marketplace.SHOPEE })),
  };

  it('lists a 30-day ML window ending at the cursor and persists ONLY buyer links — never the full sync (no /shipments, no sync_runs)', async () => {
    const { service, mlSyncService, persistence } = buildService({
      persistence: { ...olderHistory },
      mlSyncService: {
        fetchOrderBuyers: jest.fn().mockResolvedValue({
          links: [link],
          ordersFetched: 3,
          complete: true,
        }),
      },
    });
    const result = await service.runBuyerEnrichmentChunk('acc-1', cursor);
    expect(mlSyncService.fetchOrderBuyers).toHaveBeenCalledWith('acc-1', {
      from: new Date('2026-08-02T00:00:00.000Z'),
      to: cursor,
    });
    expect(mlSyncService.syncOrders).not.toHaveBeenCalled();
    expect(persistence.recoverStaleRunningRuns).not.toHaveBeenCalled();
    expect(persistence.attachBuyersToOrders).toHaveBeenCalledWith('acc-1', [
      link,
    ]);
    expect(result).toEqual({
      done: false,
      nextCursor: new Date('2026-08-02T00:00:00.000Z'),
      ordersFetched: 3,
      ordersLinked: 1,
    });
  });

  it('clamps the last window to one day before the oldest persisted order and finishes', async () => {
    const { service, mlSyncService } = buildService({
      persistence: {
        getAccountOrderDateRange: jest.fn().mockResolvedValue({
          first: new Date('2026-08-20T00:00:00.000Z'),
          last: new Date('2026-08-30T00:00:00.000Z'),
        }),
      },
    });
    const result = await service.runBuyerEnrichmentChunk('acc-1', cursor);
    const floor = new Date('2026-08-19T00:00:00.000Z');
    expect(mlSyncService.fetchOrderBuyers).toHaveBeenCalledWith('acc-1', {
      from: floor,
      to: cursor,
    });
    expect(result.done).toBe(true);
    expect(result.nextCursor).toEqual(floor);
  });

  it('finishes immediately, without any provider call, when the account has no orders (or the cursor already passed the floor)', async () => {
    const empty = buildService({
      persistence: {
        getAccountOrderDateRange: jest.fn().mockResolvedValue(null),
      },
    });
    expect(
      await empty.service.runBuyerEnrichmentChunk('acc-1', cursor),
    ).toMatchObject({ done: true, nextCursor: cursor });
    expect(empty.mlSyncService.fetchOrderBuyers).not.toHaveBeenCalled();

    const past = buildService({ persistence: { ...olderHistory } });
    const beforeFloor = new Date('2025-12-31T00:00:00.000Z');
    expect(
      await past.service.runBuyerEnrichmentChunk('acc-1', beforeFloor),
    ).toMatchObject({ done: true, nextCursor: beforeFloor });
    expect(past.mlSyncService.fetchOrderBuyers).not.toHaveBeenCalled();
  });

  it('Shopee window above the 5000-order cap is halved (same `to`) until it fits; the cursor only advances over the enumerated window', async () => {
    // Simula uma semana com > 5000 pedidos: só janelas de até ~1,75 dia cabem.
    const fetchOrderBuyers = jest.fn(
      (_accountId: string, window: { from: Date; to: Date }) => {
        const days = (window.to.getTime() - window.from.getTime()) / 86400000;
        return Promise.resolve(
          days > 2
            ? { links: [], ordersFetched: 0, complete: false }
            : { links: [link], ordersFetched: 4200, complete: true },
        );
      },
    );
    const { service } = buildService({
      marketplaceAccountsService: shopeeAccount,
      persistence: { ...olderHistory },
      shopeeSyncService: { fetchOrderBuyers },
    });
    const result = await service.runBuyerEnrichmentChunk('acc-1', cursor);
    const spans = fetchOrderBuyers.mock.calls.map(
      ([, w]) => (w.to.getTime() - w.from.getTime()) / HOUR_MS,
    );
    expect(spans).toEqual([168, 84, 42]);
    expect(fetchOrderBuyers.mock.calls.every(([, w]) => w.to === cursor)).toBe(
      true,
    );
    expect(result).toMatchObject({
      done: false,
      nextCursor: new Date(cursor.getTime() - 42 * HOUR_MS),
      ordersFetched: 4200,
    });
  });

  it('stops explicitly (ENRICHMENT_WINDOW_INCOMPLETE, cursor untouched, nothing persisted) when even the 1-hour minimum window exceeds the cap — never loops', async () => {
    const fetchOrderBuyers = jest
      .fn()
      .mockResolvedValue({ links: [], ordersFetched: 0, complete: false });
    const { service, persistence } = buildService({
      marketplaceAccountsService: shopeeAccount,
      persistence: { ...olderHistory, attachBuyersToOrders: jest.fn() },
      shopeeSyncService: { fetchOrderBuyers },
    });
    await expect(
      service.runBuyerEnrichmentChunk('acc-1', cursor),
    ).rejects.toMatchObject({ code: 'ENRICHMENT_WINDOW_INCOMPLETE' });
    const spans = fetchOrderBuyers.mock.calls.map(
      ([, w]: [string, { from: Date; to: Date }]) =>
        (w.to.getTime() - w.from.getTime()) / HOUR_MS,
    );
    // 168h → ... → 1h: finito, estritamente decrescente, termina no mínimo.
    expect(spans[0]).toBe(168);
    expect(spans[spans.length - 1]).toBe(1);
    expect(spans.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i]).toBeLessThan(spans[i - 1]);
    }
    expect(persistence.attachBuyersToOrders).not.toHaveBeenCalled();
  });

  it('rejects Amazon (out of scope) as MARKETPLACE_NOT_SUPPORTED without any provider call', async () => {
    const { service, amazonSyncService } = buildService({
      marketplaceAccountsService: {
        findByIdOrFail: jest
          .fn()
          .mockResolvedValue(account({ marketplace: Marketplace.AMAZON })),
      },
    });
    await expect(
      service.runBuyerEnrichmentChunk('acc-1', cursor),
    ).rejects.toMatchObject({ code: 'MARKETPLACE_NOT_SUPPORTED' });
    expect(amazonSyncService.syncOrders).not.toHaveBeenCalled();
  });

  it('maps provider errors to the existing backfill codes (e.g. rate limit → PROVIDER_RATE_LIMITED)', async () => {
    const { service } = buildService({
      persistence: { ...olderHistory },
      mlSyncService: {
        fetchOrderBuyers: jest
          .fn()
          .mockRejectedValue(new SyncOrdersError('PROVIDER_RATE_LIMITED')),
      },
    });
    await expect(
      service.runBuyerEnrichmentChunk('acc-1', cursor),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
  });
});

describe('MarketplaceBackfillService — exclusão mútua com o enriquecimento (mesma fila)', () => {
  it('startBackfill with a BUYER_ENRICHMENT job active → BACKFILL_JOB_MODE_CONFLICT, never reporting it as the history job', async () => {
    const { service, jobsPersistence } = buildService({
      jobsPersistence: {
        createJob: jest
          .fn()
          .mockRejectedValue(new BackfillJobActiveConflictError()),
        findActiveJob: jest
          .fn()
          .mockResolvedValue(
            backfillJobRow({ status: 'RUNNING', mode: 'BUYER_ENRICHMENT' }),
          ),
      },
    });
    await expect(service.startBackfill('acc-1')).rejects.toMatchObject({
      code: 'BACKFILL_JOB_MODE_CONFLICT',
    });
    expect(jobsPersistence.createJob).toHaveBeenCalledTimes(1);
  });

  it('resumeBackfill blocked by an active enrichment → BACKFILL_JOB_MODE_CONFLICT (not a raw 500)', async () => {
    const { service } = buildService({
      jobsPersistence: {
        resumeJob: jest
          .fn()
          .mockRejectedValue(new BackfillJobActiveConflictError()),
      },
    });
    await expect(service.resumeBackfill('acc-1')).rejects.toMatchObject({
      code: 'BACKFILL_JOB_MODE_CONFLICT',
    });
  });
});
