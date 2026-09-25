import { ConfigService } from '@nestjs/config';
import { BackfillError } from './marketplace-backfill.service';
import type {
  BackfillJobRow,
  BackfillJobStateUpdate,
} from './backfill-jobs-persistence.service';
import { MarketplaceBackfillWorkerService } from './marketplace-backfill-worker.service';
import type {
  BackfillWorkerClock,
  BackfillWorkerTimers,
} from './backfill-worker.clock';

type CommitCall = [string, number, string, BackfillJobStateUpdate];

function commitCalls(jobsPersistence: {
  commitJobState: jest.Mock;
}): CommitCall[] {
  return jobsPersistence.commitJobState.mock.calls as CommitCall[];
}

function lastCommitUpdate(jobsPersistence: {
  commitJobState: jest.Mock;
}): BackfillJobStateUpdate {
  const calls = commitCalls(jobsPersistence);
  return calls[calls.length - 1][3];
}

function job(overrides: Partial<BackfillJobRow> = {}): BackfillJobRow {
  return {
    id: 'job-1',
    marketplaceAccountId: 'acc-1',
    marketplace: 'MERCADO_LIVRE' as never,
    mode: 'HISTORY',
    cursorBefore: null,
    status: 'RUNNING',
    chunksProcessed: 0,
    attemptCount: 0,
    requestedAt: new Date('2026-09-01T00:00:00.000Z'),
    startedAt: new Date('2026-09-01T00:00:00.000Z'),
    lastActivityAt: new Date('2026-09-01T00:00:00.000Z'),
    nextAttemptAt: new Date('2026-09-01T00:00:00.000Z'),
    completedAt: null,
    lastErrorCode: null,
    pauseRequested: false,
    leaseOwner: 'worker-x',
    leaseExpiresAt: new Date('2026-09-01T00:05:00.000Z'),
    version: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeConfigService(
  overrides: Record<string, string | number> = {},
): ConfigService {
  const values: Record<string, string | number> = {
    NODE_ENV: 'production',
    BACKFILL_WORKER_ENABLED: 'true',
    BACKFILL_WORKER_TICK_MS: 5000,
    BACKFILL_WORKER_MAX_CONCURRENT_JOBS: 2,
    BACKFILL_WORKER_LEASE_MS: 120000,
    BACKFILL_WORKER_MAX_ATTEMPTS: 3,
    BACKFILL_WORKER_RETRY_BASE_MS: 1000,
    BACKFILL_WORKER_RETRY_MAX_MS: 60000,
    BACKFILL_WORKER_REQUEUE_MS: 2000,
    BACKFILL_WORKER_RATE_LIMIT_BACKOFF_MS: 30000,
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
}

function fakeClock(now: Date): BackfillWorkerClock {
  return { now: () => now };
}

function fakeTimers(): BackfillWorkerTimers & {
  handlers: Array<() => void>;
  cleared: unknown[];
} {
  const handlers: Array<() => void> = [];
  const cleared: unknown[] = [];
  let nextHandle = 0;
  return {
    handlers,
    cleared,
    setInterval: (handler) => {
      handlers.push(handler);
      nextHandle += 1;
      return nextHandle;
    },
    clearInterval: (handle) => {
      cleared.push(handle);
    },
  };
}

function buildWorker(options: {
  configOverrides?: Record<string, string | number>;
  backfillService?: Record<string, jest.Mock>;
  jobsPersistence?: Record<string, jest.Mock>;
  clock?: BackfillWorkerClock;
  timers?: BackfillWorkerTimers;
}) {
  const backfillService: Record<string, jest.Mock> = {
    runNextChunk: jest.fn(),
    runBuyerEnrichmentChunk: jest.fn(),
    ...options.backfillService,
  };
  const jobsPersistence = {
    countCurrentlyRunning: jest.fn().mockResolvedValue(0),
    claimJobs: jest.fn().mockResolvedValue([]),
    commitJobState: jest.fn().mockResolvedValue(true),
    ...options.jobsPersistence,
  };
  const worker = new MarketplaceBackfillWorkerService(
    fakeConfigService(options.configOverrides),
    backfillService as never,
    jobsPersistence as never,
    options.clock,
    options.timers,
  );
  return { worker, backfillService, jobsPersistence };
}

describe('MarketplaceBackfillWorkerService', () => {
  describe('modo BUYER_ENRICHMENT (função Clientes)', () => {
    const cursor = new Date('2026-09-10T00:00:00.000Z');
    const now = new Date('2026-09-20T00:00:00.000Z');

    function enrichmentJob(overrides: Partial<BackfillJobRow> = {}) {
      return job({
        mode: 'BUYER_ENRICHMENT',
        cursorBefore: cursor,
        ...overrides,
      });
    }

    it('runs the enrichment chunk (never runNextChunk) and persists the new cursor, requeueing', async () => {
      const nextCursor = new Date('2026-08-11T00:00:00.000Z');
      const { worker, jobsPersistence, backfillService } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([enrichmentJob()]),
        },
        backfillService: {
          runBuyerEnrichmentChunk: jest
            .fn()
            .mockResolvedValue({ done: false, nextCursor, ordersFetched: 3 }),
        },
      });
      await worker.runTickOnce();
      expect(backfillService.runBuyerEnrichmentChunk).toHaveBeenCalledWith(
        'acc-1',
        cursor,
      );
      expect(backfillService.runNextChunk).not.toHaveBeenCalled();
      expect(lastCommitUpdate(jobsPersistence)).toMatchObject({
        status: 'QUEUED',
        cursorBefore: nextCursor,
        chunksProcessed: 1,
      });
    });

    it('marks COMPLETED when the enrichment reached the oldest persisted order', async () => {
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([enrichmentJob()]),
        },
        backfillService: {
          runBuyerEnrichmentChunk: jest.fn().mockResolvedValue({
            done: true,
            nextCursor: cursor,
            ordersFetched: 0,
          }),
        },
      });
      await worker.runTickOnce();
      expect(lastCommitUpdate(jobsPersistence)).toMatchObject({
        status: 'COMPLETED',
        completedAt: now,
      });
    });

    it('an incomplete provider window fails the job WITHOUT advancing the cursor', async () => {
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([enrichmentJob()]),
        },
        backfillService: {
          runBuyerEnrichmentChunk: jest
            .fn()
            .mockRejectedValue(
              new BackfillError('ENRICHMENT_WINDOW_INCOMPLETE'),
            ),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update).toMatchObject({
        status: 'FAILED',
        lastErrorCode: 'ENRICHMENT_WINDOW_INCOMPLETE',
      });
      expect(update.cursorBefore).toBeUndefined();
    });

    it('a transient failure keeps the cursor and schedules a retry', async () => {
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([enrichmentJob()]),
        },
        backfillService: {
          runBuyerEnrichmentChunk: jest
            .fn()
            .mockRejectedValue(new BackfillError('SYNC_FAILED')),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('RETRY_WAIT');
      expect(update.cursorBefore).toBeUndefined();
    });
  });

  describe('inicialização', () => {
    it('never starts a timer when NODE_ENV=test, even if the env flag says enabled', () => {
      const timers = fakeTimers();
      const { worker } = buildWorker({
        configOverrides: { NODE_ENV: 'test', BACKFILL_WORKER_ENABLED: 'true' },
        timers,
      });
      worker.onModuleInit();
      expect(timers.handlers).toHaveLength(0);
    });

    it('starts a tick timer in production when enabled', () => {
      const timers = fakeTimers();
      const { worker } = buildWorker({ timers });
      worker.onModuleInit();
      expect(timers.handlers).toHaveLength(1);
    });

    it('does not start when BACKFILL_WORKER_ENABLED=false', () => {
      const timers = fakeTimers();
      const { worker } = buildWorker({
        configOverrides: { BACKFILL_WORKER_ENABLED: 'false' },
        timers,
      });
      worker.onModuleInit();
      expect(timers.handlers).toHaveLength(0);
    });

    it('clears the timer on shutdown', () => {
      const timers = fakeTimers();
      const { worker } = buildWorker({ timers });
      worker.onModuleInit();
      worker.onModuleDestroy();
      expect(timers.cleared).toHaveLength(1);
    });
  });

  describe('runTickOnce — claim e concorrência global', () => {
    it('claims nothing when the global concurrency headroom is zero', async () => {
      const { worker, jobsPersistence } = buildWorker({
        configOverrides: { BACKFILL_WORKER_MAX_CONCURRENT_JOBS: 2 },
        jobsPersistence: {
          countCurrentlyRunning: jest.fn().mockResolvedValue(2),
        },
      });
      await worker.runTickOnce();
      expect(jobsPersistence.claimJobs).not.toHaveBeenCalled();
    });

    it('claims up to the remaining headroom, never more', async () => {
      const { worker, jobsPersistence } = buildWorker({
        configOverrides: { BACKFILL_WORKER_MAX_CONCURRENT_JOBS: 2 },
        jobsPersistence: {
          countCurrentlyRunning: jest.fn().mockResolvedValue(1),
        },
      });
      await worker.runTickOnce();
      expect(jobsPersistence.claimJobs).toHaveBeenCalledWith(
        expect.any(String),
        1,
        expect.any(Number),
      );
    });

    it('processes claimed jobs from two different accounts in isolation — one failing never affects the other', async () => {
      const jobA = job({ id: 'job-a', marketplaceAccountId: 'acc-a' });
      const jobB = job({ id: 'job-b', marketplaceAccountId: 'acc-b' });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([jobA, jobB]),
        },
        backfillService: {
          runNextChunk: jest.fn().mockImplementation((accountId: string) => {
            if (accountId === 'acc-a') {
              return Promise.reject(new BackfillError('SYNC_FAILED'));
            }
            return Promise.resolve({
              hasMoreHistory: true,
              oldestCoveredAt: '2026-01-01',
              ordersFetched: 3,
            });
          }),
        },
      });

      await worker.runTickOnce();

      expect(backfillService.runNextChunk).toHaveBeenCalledWith('acc-a');
      expect(backfillService.runNextChunk).toHaveBeenCalledWith('acc-b');
      const calls = commitCalls(jobsPersistence);
      const commitForA = calls.find((c) => c[0] === 'job-a')!;
      const commitForB = calls.find((c) => c[0] === 'job-b')!;
      expect(commitForA[3].status).toBe('RETRY_WAIT');
      expect(commitForB[3].status).toBe('QUEUED');
    });

    it('a failure while claiming/counting never throws — the worker logs and stays alive for the next tick', async () => {
      const { worker, jobsPersistence } = buildWorker({
        jobsPersistence: {
          countCurrentlyRunning: jest
            .fn()
            .mockRejectedValue(new Error('db down')),
        },
      });
      await expect(worker.runTickOnce()).resolves.toBeUndefined();
      expect(jobsPersistence.claimJobs).not.toHaveBeenCalled();
    });

    it('never issues a real network call — only the injected runNextChunk mock is invoked', async () => {
      const { worker, jobsPersistence, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([job()]),
        },
      });
      backfillService.runNextChunk.mockResolvedValue({
        hasMoreHistory: true,
        oldestCoveredAt: '2026-01-01',
        ordersFetched: 1,
      });
      await worker.runTickOnce();
      expect(backfillService.runNextChunk).toHaveBeenCalledTimes(1);
      expect(jobsPersistence.commitJobState).toHaveBeenCalledTimes(1);
    });
  });

  describe('processamento de UM chunk — sucesso', () => {
    it('increments chunksProcessed, resets attemptCount, and requeues to QUEUED for the next tick', async () => {
      const now = new Date('2026-09-05T12:00:00.000Z');
      const claimedJob = job({ chunksProcessed: 2, attemptCount: 1 });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockResolvedValue({
        hasMoreHistory: true,
        oldestCoveredAt: '2026-01-01',
        ordersFetched: 5,
      });

      await worker.runTickOnce();

      expect(jobsPersistence.commitJobState).toHaveBeenCalledWith(
        claimedJob.id,
        claimedJob.version,
        expect.any(String),
        expect.objectContaining({
          status: 'QUEUED',
          chunksProcessed: 3,
          attemptCount: 0,
          nextAttemptAt: now,
          releaseLease: true,
        }),
      );
    });

    it('transitions to SAFETY_LIMIT_REACHED and sets completedAt when hasMoreHistory=false', async () => {
      const now = new Date('2026-09-05T12:00:00.000Z');
      const claimedJob = job();
      const { worker, jobsPersistence, backfillService } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockResolvedValue({
        hasMoreHistory: false,
        oldestCoveredAt: '2010-01-01',
        ordersFetched: 0,
      });

      await worker.runTickOnce();

      expect(jobsPersistence.commitJobState).toHaveBeenCalledWith(
        claimedJob.id,
        claimedJob.version,
        expect.any(String),
        expect.objectContaining({
          status: 'SAFETY_LIMIT_REACHED',
          completedAt: now,
        }),
      );
    });

    it('respects a pause requested while the chunk was in flight — transitions to PAUSED instead of requeueing', async () => {
      const claimedJob = job({ pauseRequested: true });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockResolvedValue({
        hasMoreHistory: true,
        oldestCoveredAt: '2026-01-01',
        ordersFetched: 1,
      });

      await worker.runTickOnce();

      expect(jobsPersistence.commitJobState).toHaveBeenCalledWith(
        claimedJob.id,
        claimedJob.version,
        expect.any(String),
        expect.objectContaining({ status: 'PAUSED', pauseRequested: false }),
      );
    });
  });

  describe('processamento de UM chunk — falha', () => {
    it('classifies ACCOUNT_NOT_CONNECTED as terminal: FAILED immediately, no retry', async () => {
      const claimedJob = job();
      const { worker, jobsPersistence, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(
        new BackfillError('ACCOUNT_NOT_CONNECTED'),
      );

      await worker.runTickOnce();

      expect(jobsPersistence.commitJobState).toHaveBeenCalledWith(
        claimedJob.id,
        claimedJob.version,
        expect.any(String),
        expect.objectContaining({
          status: 'FAILED',
          lastErrorCode: 'ACCOUNT_NOT_CONNECTED',
        }),
      );
    });

    it('classifies TOKEN_EXPIRED as terminal with a sanitized error code, never the raw message', async () => {
      const claimedJob = job();
      const { worker, jobsPersistence, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(
        new BackfillError('TOKEN_EXPIRED'),
      );

      await worker.runTickOnce();

      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('FAILED');
      expect(update.lastErrorCode).toBe('TOKEN_EXPIRED');
    });

    it('BACKFILL_ALREADY_RUNNING (contention with incremental sync) always requeues, never counts toward attempts, never FAILED', async () => {
      const claimedJob = job({ attemptCount: 2 });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        configOverrides: { BACKFILL_WORKER_MAX_ATTEMPTS: 3 },
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(
        new BackfillError('BACKFILL_ALREADY_RUNNING'),
      );

      await worker.runTickOnce();

      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('RETRY_WAIT');
      expect(update.attemptCount).toBe(2); // nunca incrementa
    });

    it('a transient SYNC_FAILED schedules RETRY_WAIT with exponential backoff', async () => {
      const now = new Date('2026-09-05T12:00:00.000Z');
      const claimedJob = job({ attemptCount: 1 });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        clock: fakeClock(now),
        configOverrides: {
          BACKFILL_WORKER_RETRY_BASE_MS: 1000,
          BACKFILL_WORKER_MAX_ATTEMPTS: 10,
        },
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(
        new BackfillError('SYNC_FAILED'),
      );

      await worker.runTickOnce();

      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('RETRY_WAIT');
      expect(update.attemptCount).toBe(2);
      // base(1000) * 2^(2-1) = 2000ms
      expect(update.nextAttemptAt.getTime() - now.getTime()).toBe(2000);
    });

    it('gives up after maxAttempts consecutive transient failures — transitions to FAILED', async () => {
      const claimedJob = job({ attemptCount: 2 });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        configOverrides: { BACKFILL_WORKER_MAX_ATTEMPTS: 3 },
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(
        new BackfillError('SYNC_FAILED'),
      );

      await worker.runTickOnce();

      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('FAILED');
      expect(update.attemptCount).toBe(3);
    });

    it('PROVIDER_RATE_LIMITED uses the configured rate-limit backoff (distinct from the exponential one)', async () => {
      const now = new Date('2026-09-05T12:00:00.000Z');
      const claimedJob = job({ attemptCount: 0 });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        clock: fakeClock(now),
        configOverrides: {
          BACKFILL_WORKER_RATE_LIMIT_BACKOFF_MS: 45000,
          BACKFILL_WORKER_MAX_ATTEMPTS: 10,
        },
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(
        new BackfillError('PROVIDER_RATE_LIMITED'),
      );

      await worker.runTickOnce();

      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('RETRY_WAIT');
      expect(update.nextAttemptAt.getTime() - now.getTime()).toBe(45000);
    });

    it('an unrecognized thrown error (not a BackfillError) falls back to SYNC_FAILED, never crashes the tick', async () => {
      const claimedJob = job();
      const { worker, jobsPersistence, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(new Error('boom'));

      await expect(worker.runTickOnce()).resolves.toBeUndefined();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.lastErrorCode).toBe('SYNC_FAILED');
      expect(update.status).toBe('RETRY_WAIT');
    });

    it('pausing during a failed chunk still respects the pause over scheduling another retry', async () => {
      const claimedJob = job({ pauseRequested: true });
      const { worker, jobsPersistence, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
        },
      });
      backfillService.runNextChunk.mockRejectedValue(
        new BackfillError('SYNC_FAILED'),
      );

      await worker.runTickOnce();

      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('PAUSED');
    });
  });

  describe('perda de corrida (lease roubado)', () => {
    it('a lost commitJobState race never throws — just logged, job left as the new owner set it', async () => {
      const claimedJob = job();
      const { worker, backfillService } = buildWorker({
        jobsPersistence: {
          claimJobs: jest.fn().mockResolvedValue([claimedJob]),
          commitJobState: jest.fn().mockResolvedValue(false),
        },
      });
      backfillService.runNextChunk.mockResolvedValue({
        hasMoreHistory: true,
        oldestCoveredAt: '2026-01-01',
        ordersFetched: 1,
      });

      await expect(worker.runTickOnce()).resolves.toBeUndefined();
    });
  });
});
