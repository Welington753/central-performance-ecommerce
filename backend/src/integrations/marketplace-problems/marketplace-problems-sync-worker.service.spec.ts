import type { ConfigService } from '@nestjs/config';
import type {
  MarketplaceProblemsSyncJobCommitUpdate,
  MarketplaceProblemsSyncJobRow,
} from './marketplace-problems-sync-jobs.types';
import type { ProblemsSyncTickReport } from './marketplace-problems-sync-tick.service';
import { MarketplaceProblemsSyncWorkerService } from './marketplace-problems-sync-worker.service';

const NOW = new Date('2026-06-15T12:00:00.000Z');

function jobRow(
  id: string,
  overrides: Partial<MarketplaceProblemsSyncJobRow> = {},
): MarketplaceProblemsSyncJobRow {
  return {
    id,
    marketplaceAccountId: `acc-${id}`,
    status: 'RUNNING',
    windowCursorAt: new Date('2026-06-15T11:00:00.000Z'),
    claimsProcessedCount: 0,
    claimsPersistedCount: 0,
    claimsFailedCount: 0,
    callsMadeCount: 0,
    attemptCount: 0,
    nextAttemptAt: NOW,
    lastErrorCode: null,
    pauseRequested: false,
    leaseOwner: 'w',
    leaseExpiresAt: null,
    version: 4,
    lastActivityAt: null,
    lastCompleteCensusAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type CommitArgs = [
  string,
  number,
  string,
  MarketplaceProblemsSyncJobCommitUpdate,
];

function commitCalls(commit: jest.Mock): CommitArgs[] {
  return commit.mock.calls as CommitArgs[];
}

function okReport(
  overrides: Partial<ProblemsSyncTickReport> = {},
): ProblemsSyncTickReport {
  return {
    stopReason: 'COMPLETED',
    retryAfterMs: null,
    thrownCode: null,
    creationCursorAdvancedTo: null,
    censusCompletedInFull: false,
    claimsProcessed: 1,
    claimsPersisted: 1,
    claimsFailed: 0,
    callsMade: 3,
    ...overrides,
  };
}

function config(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function build(
  values: Record<string, unknown> = {},
  overrides: {
    claim?: jest.Mock;
    commit?: jest.Mock;
    runTick?: jest.Mock;
  } = {},
) {
  const jobsPersistence = {
    claim: overrides.claim ?? jest.fn().mockResolvedValue([]),
    commit: overrides.commit ?? jest.fn().mockResolvedValue(true),
  };
  const tickService = {
    runTick: overrides.runTick ?? jest.fn().mockResolvedValue(okReport()),
  };
  const handles: unknown[] = [];
  const timers = {
    setInterval: jest.fn((handler: () => void, ms: number) => {
      const handle = { handler, ms };
      handles.push(handle);
      return handle;
    }),
    clearInterval: jest.fn(),
  };
  const worker = new MarketplaceProblemsSyncWorkerService(
    config(values),
    jobsPersistence as never,
    tickService as never,
    { now: () => NOW },
    timers,
  );
  return { worker, jobsPersistence, tickService, timers, handles };
}

const ENABLED = {
  PROBLEMS_SYNC_WORKER_ENABLED: 'true',
  NODE_ENV: 'production',
};

describe('MarketplaceProblemsSyncWorkerService', () => {
  describe('habilitação e timers', () => {
    it('desabilitado por padrão: nenhum timer é criado', () => {
      const { worker, timers } = build();
      worker.onModuleInit();
      expect(timers.setInterval).not.toHaveBeenCalled();
    });

    it('desabilitado em NODE_ENV=test mesmo com a flag ligada', () => {
      const { worker, timers } = build({
        PROBLEMS_SYNC_WORKER_ENABLED: 'true',
        NODE_ENV: 'test',
      });
      worker.onModuleInit();
      expect(timers.setInterval).not.toHaveBeenCalled();
    });

    it('habilitado: cria um timer com tickMs e limpa no destroy (sem timer órfão)', () => {
      const { worker, timers } = build({
        ...ENABLED,
        PROBLEMS_SYNC_WORKER_TICK_MS: 7000,
      });
      worker.onModuleInit();
      expect(timers.setInterval).toHaveBeenCalledTimes(1);
      expect(timers.setInterval.mock.calls[0][1]).toBe(7000);
      const handle: unknown = timers.setInterval.mock.results[0].value;
      worker.onModuleDestroy();
      expect(timers.clearInterval).toHaveBeenCalledWith(handle);
      worker.onModuleDestroy();
      expect(timers.clearInterval).toHaveBeenCalledTimes(1);
    });

    it('config inválida falha fechado na construção', () => {
      expect(() => build({ PROBLEMS_SYNC_WORKER_TICK_MS: 'abc' })).toThrow();
    });
  });

  describe('runTickOnce', () => {
    it('reivindica com workerId, maxConcurrentJobs e leaseMs da config', async () => {
      const { worker, jobsPersistence } = build({
        PROBLEMS_SYNC_WORKER_MAX_CONCURRENT_JOBS: 3,
        PROBLEMS_SYNC_WORKER_LEASE_MS: 111111,
      });
      await worker.runTickOnce();
      expect(jobsPersistence.claim).toHaveBeenCalledWith(
        expect.any(String),
        3,
        111111,
      );
    });

    it('nenhum job elegível: não roda tick nem commit', async () => {
      const { worker, tickService, jobsPersistence } = build();
      await worker.runTickOnce();
      expect(tickService.runTick).not.toHaveBeenCalled();
      expect(jobsPersistence.commit).not.toHaveBeenCalled();
    });

    it('processa o job e commita por CAS com a version e o workerId do claim', async () => {
      const claim = jest.fn().mockResolvedValue([jobRow('a')]);
      const { worker, jobsPersistence, tickService } = build({}, { claim });
      await worker.runTickOnce();
      expect(tickService.runTick).toHaveBeenCalledTimes(1);
      const workerId = (claim.mock.calls as Array<[string]>)[0][0];
      expect(jobsPersistence.commit).toHaveBeenCalledWith(
        'a',
        4,
        workerId,
        expect.objectContaining({ status: 'RUNNING', attemptCount: 0 }),
      );
    });

    it('nenhuma sobreposição: chamada concorrente enquanto há tick em voo retorna sem reivindicar', async () => {
      let release!: () => void;
      const claim = jest
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<never[]>((resolve) => {
              release = () => resolve([]);
            }),
        )
        .mockResolvedValue([]);
      const { worker } = build({}, { claim });
      const first = worker.runTickOnce();
      await worker.runTickOnce();
      expect(claim).toHaveBeenCalledTimes(1);
      release();
      await first;
      await worker.runTickOnce();
      expect(claim).toHaveBeenCalledTimes(2);
    });

    it('CAS perdido (commit=false) não derruba o worker', async () => {
      const claim = jest.fn().mockResolvedValue([jobRow('a')]);
      const commit = jest.fn().mockResolvedValue(false);
      const { worker } = build({}, { claim, commit });
      await expect(worker.runTickOnce()).resolves.toBeUndefined();
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it('uma conta falhando (commit lança) não bloqueia a outra', async () => {
      const claim = jest
        .fn()
        .mockResolvedValue([jobRow('a'), jobRow('b'), jobRow('c')]);
      const commit = jest
        .fn()
        .mockImplementation((id: string) =>
          id === 'a'
            ? Promise.reject(new Error('db caiu'))
            : Promise.resolve(true),
        );
      const { worker } = build({}, { claim, commit });
      await expect(worker.runTickOnce()).resolves.toBeUndefined();
      expect(
        commitCalls(commit)
          .map((c) => c[0])
          .sort(),
      ).toEqual(['a', 'b', 'c']);
    });

    it('uma conta cujo tick reporta falha commita a falha e a outra segue normal', async () => {
      const claim = jest.fn().mockResolvedValue([jobRow('a'), jobRow('b')]);
      const runTick = jest
        .fn()
        .mockImplementation((job: MarketplaceProblemsSyncJobRow) =>
          Promise.resolve(
            job.id === 'a'
              ? okReport({ stopReason: 'PROVIDER_UNAVAILABLE' })
              : okReport(),
          ),
        );
      const commit = jest.fn().mockResolvedValue(true);
      const { worker } = build({}, { claim, commit, runTick });
      await worker.runTickOnce();
      const byId = new Map(commitCalls(commit).map((c) => [c[0], c[3]]));
      expect(byId.get('a')?.status).toBe('WAITING_RETRY');
      expect(byId.get('a')?.attemptCount).toBe(1);
      expect(byId.get('b')?.status).toBe('RUNNING');
      expect(byId.get('b')?.attemptCount).toBe(0);
    });

    it('falha ao reivindicar (banco indisponível) é engolida e libera o ciclo seguinte', async () => {
      const claim = jest
        .fn()
        .mockRejectedValueOnce(new Error('db indisponível'))
        .mockResolvedValue([]);
      const { worker } = build({}, { claim });
      await expect(worker.runTickOnce()).resolves.toBeUndefined();
      await worker.runTickOnce();
      expect(claim).toHaveBeenCalledTimes(2);
    });

    it('pause_requested já marcado no claim: NÃO roda o tick e commita sem mudar progresso (o SQL converte em PAUSED)', async () => {
      const claim = jest
        .fn()
        .mockResolvedValue([
          jobRow('a', { pauseRequested: true, attemptCount: 2 }),
        ]);
      const { worker, tickService, jobsPersistence } = build({}, { claim });
      await worker.runTickOnce();
      expect(tickService.runTick).not.toHaveBeenCalled();
      const update = commitCalls(jobsPersistence.commit)[0][3];
      expect(update).toMatchObject({
        claimsProcessedDelta: 0,
        callsMadeDelta: 0,
        attemptCount: 2,
      });
    });

    it('auth terminal vira FAILED_AUTH no commit', async () => {
      const claim = jest.fn().mockResolvedValue([jobRow('a')]);
      const runTick = jest
        .fn()
        .mockResolvedValue(okReport({ thrownCode: 'TOKEN_EXPIRED' }));
      const { worker, jobsPersistence } = build({}, { claim, runTick });
      await worker.runTickOnce();
      expect(commitCalls(jobsPersistence.commit)[0][3].status).toBe(
        'FAILED_AUTH',
      );
    });
  });
});
