import { ConfigService } from '@nestjs/config';
import { emptyAccountReport } from './logistics-reclassification-report';
import type { ReclassificationAccountReport } from './logistics-reclassification-report';
import type {
  MlLogisticsReclassificationJobCommitUpdate,
  MlLogisticsReclassificationJobRow,
} from './ml-logistics-reclassification-jobs-persistence.service';
import { MlLogisticsReclassificationWorkerService } from './ml-logistics-reclassification-worker.service';
import type {
  MlLogisticsReclassificationWorkerClock,
  MlLogisticsReclassificationWorkerTimers,
} from './ml-logistics-reclassification-worker.clock';

type CommitCall = [
  string,
  number,
  string,
  MlLogisticsReclassificationJobCommitUpdate,
];

function commitCalls(jobsPersistence: { commit: jest.Mock }): CommitCall[] {
  return jobsPersistence.commit.mock.calls as CommitCall[];
}

function lastCommitUpdate(jobsPersistence: {
  commit: jest.Mock;
}): MlLogisticsReclassificationJobCommitUpdate {
  const calls = commitCalls(jobsPersistence);
  return calls[calls.length - 1][3];
}

function job(
  overrides: Partial<MlLogisticsReclassificationJobRow> = {},
): MlLogisticsReclassificationJobRow {
  return {
    id: 'job-1',
    marketplaceAccountId: 'acc-1',
    status: 'RUNNING',
    initialUnknownCount: 100,
    remainingUnknownCount: 100,
    resolvedFullCount: 0,
    resolvedNotFullCount: 0,
    callsMadeCount: 0,
    queue1CursorId: null,
    queue2CursorId: null,
    passResolvedCount: 0,
    lastActivityAt: new Date('2026-09-01T00:00:00.000Z'),
    nextAttemptAt: new Date('2026-09-01T00:00:00.000Z'),
    lastErrorCode: null,
    pauseRequested: false,
    leaseOwner: 'worker-x',
    leaseExpiresAt: new Date('2026-09-01T00:05:00.000Z'),
    version: 1,
    startedAt: new Date('2026-09-01T00:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function report(
  overrides: Partial<ReclassificationAccountReport> = {},
): ReclassificationAccountReport {
  return { ...emptyAccountReport(null), ...overrides };
}

function fakeConfigService(
  overrides: Record<string, string | number> = {},
): ConfigService {
  const values: Record<string, string | number> = {
    NODE_ENV: 'production',
    ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'true',
    ML_LOGISTICS_RECLASSIFICATION_WORKER_TICK_MS: 8000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_BATCH_SIZE: 20,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_MAX_CALLS_PER_TICK: 20,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_MAX_CONCURRENT_JOBS: 2,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_LEASE_MS: 120000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_RATE_LIMIT_BACKOFF_MS: 60000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_PROVIDER_UNAVAILABLE_BACKOFF_MS: 30000,
    ML_LOGISTICS_RECLASSIFICATION_WORKER_TOKEN_UNAVAILABLE_BACKOFF_MS: 30000,
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
}

function fakeClock(now: Date): MlLogisticsReclassificationWorkerClock {
  return { now: () => now };
}

function fakeTimers(): MlLogisticsReclassificationWorkerTimers & {
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
  reclassificationService?: Record<string, jest.Mock>;
  jobsPersistence?: Record<string, jest.Mock>;
  repository?: Record<string, jest.Mock>;
  clock?: MlLogisticsReclassificationWorkerClock;
  timers?: MlLogisticsReclassificationWorkerTimers;
}) {
  const reclassificationService = {
    apply: jest.fn().mockResolvedValue([report()]),
    ...options.reclassificationService,
  };
  const jobsPersistence = {
    claim: jest.fn().mockResolvedValue([]),
    commit: jest.fn().mockResolvedValue(true),
    ...options.jobsPersistence,
  };
  const repository = {
    countPendingByAccount: jest
      .fn()
      .mockResolvedValue([
        { pendingWithShipmentId: 0, pendingWithoutShipmentId: 0 },
      ]),
    ...options.repository,
  };
  const worker = new MlLogisticsReclassificationWorkerService(
    fakeConfigService(options.configOverrides),
    reclassificationService as never,
    jobsPersistence as never,
    repository as never,
    options.clock,
    options.timers,
  );
  return { worker, reclassificationService, jobsPersistence, repository };
}

describe('MlLogisticsReclassificationWorkerService', () => {
  describe('inicialização', () => {
    it('never starts a timer when NODE_ENV=test, even if the env flag says enabled', () => {
      const timers = fakeTimers();
      buildWorker({
        configOverrides: { NODE_ENV: 'test' },
        timers,
      }).worker.onModuleInit();
      expect(timers.handlers).toHaveLength(0);
    });

    it('does not start when ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED=false', () => {
      const timers = fakeTimers();
      buildWorker({
        configOverrides: {
          ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'false',
        },
        timers,
      }).worker.onModuleInit();
      expect(timers.handlers).toHaveLength(0);
    });

    it('starts a tick timer in production when enabled', () => {
      const timers = fakeTimers();
      buildWorker({ timers }).worker.onModuleInit();
      expect(timers.handlers).toHaveLength(1);
    });

    it('clears the timer on shutdown', () => {
      const timers = fakeTimers();
      const { worker } = buildWorker({ timers });
      worker.onModuleInit();
      worker.onModuleDestroy();
      expect(timers.cleared).toHaveLength(1);
    });
  });

  describe('runTickOnce — claim e Shopee nunca entra', () => {
    it('does nothing when claim returns no jobs', async () => {
      const { worker, reclassificationService } = buildWorker({});
      await worker.runTickOnce();
      expect(reclassificationService.apply).not.toHaveBeenCalled();
    });

    it('processes two claimed jobs (Meli 1 and Meli 2) in isolation — one failing never affects the other', async () => {
      const { worker, reclassificationService, jobsPersistence } = buildWorker({
        jobsPersistence: {
          claim: jest
            .fn()
            .mockResolvedValue([
              job({ id: 'job-1', marketplaceAccountId: 'acc-1' }),
              job({ id: 'job-2', marketplaceAccountId: 'acc-2' }),
            ]),
          commit: jest.fn().mockResolvedValue(true),
        },
        reclassificationService: {
          apply: jest
            .fn()
            .mockImplementation(({ accountId }: { accountId: string }) =>
              accountId === 'acc-1'
                ? Promise.reject(new Error('boom'))
                : Promise.resolve([report({ outcome: 'COMPLETED' })]),
            ),
        },
      });
      await expect(worker.runTickOnce()).resolves.not.toThrow();
      expect(reclassificationService.apply).toHaveBeenCalledTimes(2);
      // acc-2 ainda foi commitado apesar de acc-1 ter lançado.
      expect(jobsPersistence.commit).toHaveBeenCalledTimes(1);
    });

    it('a failure while claiming never throws — the worker logs and stays alive for the next tick', async () => {
      const { worker } = buildWorker({
        jobsPersistence: {
          claim: jest.fn().mockRejectedValue(new Error('db down')),
          commit: jest.fn(),
        },
      });
      await expect(worker.runTickOnce()).resolves.not.toThrow();
    });

    it('never issues a real network call — only the injected apply() mock is invoked', async () => {
      const { worker, reclassificationService, jobsPersistence } = buildWorker({
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
      });
      await worker.runTickOnce();
      expect(reclassificationService.apply).toHaveBeenCalledTimes(1);
      expect(jobsPersistence.commit).toHaveBeenCalledTimes(1);
    });
  });

  describe('mapeamento de outcome → transição de estado', () => {
    it('COMPLETED (as duas filas esgotadas SEM resolver nada nesta passada) transitions to COMPLETED and sets completedAt', async () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest.fn().mockResolvedValue([
            report({
              outcome: 'COMPLETED',
              resolvedMarketplaceFulfilled: 0,
              queue1Exhausted: true,
              queue2Exhausted: true,
            }),
          ]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('COMPLETED');
      expect(update.completedAt).toEqual(now);
      expect(update.resolvedFullDelta).toBe(0);
    });

    it('as duas filas esgotam MAS algo foi resolvido nesta passada → nova passada (RUNNING, cursores voltam a null), nunca COMPLETED', async () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest.fn().mockResolvedValue([
            report({
              outcome: 'COMPLETED',
              resolvedMarketplaceFulfilled: 3,
              queue1Exhausted: true,
              queue2Exhausted: true,
            }),
          ]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('RUNNING');
      expect(update.completedAt).toBeNull();
      expect(update.resolvedFullDelta).toBe(3);
      expect(update.queue1CursorId).toBeNull();
      expect(update.queue2CursorId).toBeNull();
      expect(update.passResolvedCount).toBe(0);
    });

    it('COMPLETED never fires while STOPPED_MAX_REQUESTS is returned — stays RUNNING, requeued to now', async () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([report({ outcome: 'STOPPED_MAX_REQUESTS' })]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('RUNNING');
      expect(update.completedAt).toBeNull();
      expect(update.nextAttemptAt).toEqual(now);
    });

    it('ABORTED_UNAUTHORIZED (401/403 explícito) transitions to FAILED_AUTH and stops automatically', async () => {
      const { worker, jobsPersistence } = buildWorker({
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([report({ outcome: 'ABORTED_UNAUTHORIZED' })]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('FAILED_AUTH');
      expect(update.lastErrorCode).toBe('ABORTED_UNAUTHORIZED');
    });

    it('SKIPPED_NOT_CONNECTED also transitions to FAILED_AUTH — same user action required (reconectar)', async () => {
      const { worker, jobsPersistence } = buildWorker({
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([report({ outcome: 'SKIPPED_NOT_CONNECTED' })]),
        },
      });
      await worker.runTickOnce();
      expect(lastCommitUpdate(jobsPersistence).status).toBe('FAILED_AUTH');
    });

    it('STOPPED_RATE_LIMITED (429) schedules WAITING_RETRY with the rate-limit backoff, resumable later', async () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        configOverrides: {
          ML_LOGISTICS_RECLASSIFICATION_WORKER_RATE_LIMIT_BACKOFF_MS: 45000,
        },
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([report({ outcome: 'STOPPED_RATE_LIMITED' })]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('WAITING_RETRY');
      expect(update.nextAttemptAt).toEqual(new Date(now.getTime() + 45000));
      expect(update.lastErrorCode).toBe('STOPPED_RATE_LIMITED');
    });

    it('STOPPED_PROVIDER_UNAVAILABLE schedules WAITING_RETRY with its own (shorter) backoff', async () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([
              report({ outcome: 'STOPPED_PROVIDER_UNAVAILABLE' }),
            ]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('WAITING_RETRY');
      expect(update.nextAttemptAt).toEqual(new Date(now.getTime() + 30000));
    });

    it('ABORTED_TOKEN_UNAVAILABLE never becomes FAILED_AUTH (conservative default) — schedules WAITING_RETRY', async () => {
      const { worker, jobsPersistence } = buildWorker({
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([
              report({ outcome: 'ABORTED_TOKEN_UNAVAILABLE' }),
            ]),
        },
      });
      await worker.runTickOnce();
      expect(lastCommitUpdate(jobsPersistence).status).toBe('WAITING_RETRY');
    });

    it('SKIPPED_ACCOUNT_BUSY (advisory lock em disputa) stays RUNNING, requeued to now — never an error', async () => {
      const { worker, jobsPersistence } = buildWorker({
        jobsPersistence: { claim: jest.fn().mockResolvedValue([job()]) },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([report({ outcome: 'SKIPPED_ACCOUNT_BUSY' })]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('RUNNING');
      expect(update.lastErrorCode).toBeNull();
    });
  });

  describe('pausa durante um tick', () => {
    it('a pause requested mid-tick transitions to PAUSED instead of requeueing, even with more work left', async () => {
      const now = new Date('2026-09-01T10:00:00.000Z');
      const { worker, jobsPersistence } = buildWorker({
        clock: fakeClock(now),
        jobsPersistence: {
          claim: jest.fn().mockResolvedValue([job({ pauseRequested: true })]),
        },
        reclassificationService: {
          apply: jest
            .fn()
            .mockResolvedValue([report({ outcome: 'STOPPED_MAX_REQUESTS' })]),
        },
      });
      await worker.runTickOnce();
      const update = lastCommitUpdate(jobsPersistence);
      expect(update.status).toBe('PAUSED');
      expect(update.nextAttemptAt).toEqual(now);
      expect(update.pauseRequested).toBe(false);
    });
  });

  describe('remainingUnknownCount — sempre a contagem real', () => {
    it('reads the fresh count from the repository after each tick, never the stale value on the claimed row', async () => {
      const { worker, jobsPersistence, repository } = buildWorker({
        jobsPersistence: {
          claim: jest
            .fn()
            .mockResolvedValue([job({ remainingUnknownCount: 999 })]),
        },
        repository: {
          countPendingByAccount: jest
            .fn()
            .mockResolvedValue([
              { pendingWithShipmentId: 2, pendingWithoutShipmentId: 3 },
            ]),
        },
      });
      await worker.runTickOnce();
      expect(repository.countPendingByAccount).toHaveBeenCalledWith(
        'MERCADO_LIVRE',
        'acc-1',
      );
      expect(lastCommitUpdate(jobsPersistence).remainingUnknownCount).toBe(5);
    });
  });

  describe('perda de corrida (lease roubado)', () => {
    it('a lost commit race never throws — just logged', async () => {
      const { worker } = buildWorker({
        jobsPersistence: {
          claim: jest.fn().mockResolvedValue([job()]),
          commit: jest.fn().mockResolvedValue(false),
        },
      });
      await expect(worker.runTickOnce()).resolves.not.toThrow();
    });
  });
});
