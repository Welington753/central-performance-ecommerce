import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { MarketplaceProblemsSyncJobsPersistenceService } from './marketplace-problems-sync-jobs-persistence.service';
import type { MarketplaceProblemsSyncJobRow } from './marketplace-problems-sync-jobs.types';
import type { ProblemsSyncTickReport } from './marketplace-problems-sync-tick.service';
import { MarketplaceProblemsSyncWorkerService } from './marketplace-problems-sync-worker.service';

function newDataSource(): DataSource {
  return new DataSource(
    buildDataSourceOptions({
      databaseUrl: requireTestDatabaseUrl(),
      nodeEnv: 'test',
    }),
  );
}

function report(
  overrides: Partial<ProblemsSyncTickReport> = {},
): ProblemsSyncTickReport {
  return {
    stopReason: 'COMPLETED',
    retryAfterMs: null,
    thrownCode: null,
    failureCode: null,
    creationCursorAdvancedTo: null,
    censusCompletedInFull: false,
    historical: null,
    claimsProcessed: 2,
    claimsPersisted: 2,
    claimsFailed: 0,
    callsMade: 5,
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('MarketplaceProblemsSyncWorkerService (Postgres real, duas instâncias)', () => {
  let dsA: DataSource;
  let dsB: DataSource;
  let persistenceA: MarketplaceProblemsSyncJobsPersistenceService;
  let persistenceB: MarketplaceProblemsSyncJobsPersistenceService;

  beforeAll(async () => {
    dsA = newDataSource();
    await dsA.initialize();
    await dsA.runMigrations();
    dsB = newDataSource();
    await dsB.initialize();
    persistenceA = new MarketplaceProblemsSyncJobsPersistenceService(dsA);
    persistenceB = new MarketplaceProblemsSyncJobsPersistenceService(dsB);
  });

  afterAll(async () => {
    await dsB.destroy();
    await dsA.destroy();
  });

  beforeEach(async () => {
    await dsA.query(`DELETE FROM marketplace_problems_sync_jobs`);
  });

  async function newJob(): Promise<MarketplaceProblemsSyncJobRow> {
    const [account] = await dsA.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`],
    );
    return persistenceA.createIfAbsent(account.id, new Date());
  }

  function buildWorker(
    persistence: MarketplaceProblemsSyncJobsPersistenceService,
    runTick: (
      job: MarketplaceProblemsSyncJobRow,
    ) => Promise<ProblemsSyncTickReport>,
    values: Record<string, unknown> = {},
  ) {
    const configService = {
      get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    } as unknown as ConfigService;
    return new MarketplaceProblemsSyncWorkerService(
      configService,
      persistence,
      {
        runTick: (job: MarketplaceProblemsSyncJobRow) => runTick(job),
      } as never,
    );
  }

  it('duas instâncias reais rodando em paralelo processam cada job exatamente uma vez e nunca dois ticks simultâneos do mesmo job', async () => {
    const jobs = await Promise.all([newJob(), newJob(), newJob(), newJob()]);
    const processed: string[] = [];
    const inFlight = new Set<string>();
    let overlapped = false;
    const runTick = async (job: MarketplaceProblemsSyncJobRow) => {
      if (inFlight.has(job.id)) overlapped = true;
      inFlight.add(job.id);
      processed.push(job.id);
      await sleep(40);
      inFlight.delete(job.id);
      return report();
    };
    const a = buildWorker(persistenceA, runTick, {
      PROBLEMS_SYNC_WORKER_MAX_CONCURRENT_JOBS: 4,
    });
    const b = buildWorker(persistenceB, runTick, {
      PROBLEMS_SYNC_WORKER_MAX_CONCURRENT_JOBS: 4,
    });

    await Promise.all([a.runTickOnce(), b.runTickOnce()]);

    expect(overlapped).toBe(false);
    expect([...processed].sort()).toEqual(jobs.map((j) => j.id).sort());
    for (const job of jobs) {
      const after = (await persistenceA.findByAccountId(
        job.marketplaceAccountId,
      ))!;
      expect(after.claimsProcessedCount).toBe(2);
      expect(after.callsMadeCount).toBe(5);
      expect(after.leaseOwner).toBeNull();
      expect(after.status).toBe('RUNNING');
      // Sucesso => próximo ciclo só daqui a syncIntervalMs.
      expect(after.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('uma conta falhando (auth terminal) não bloqueia a outra', async () => {
    const [bad, good] = await Promise.all([newJob(), newJob()]);
    const worker = buildWorker(
      persistenceA,
      (job) =>
        Promise.resolve(
          job.id === bad.id
            ? report({
                thrownCode: 'TOKEN_EXPIRED',
                claimsProcessed: 0,
                callsMade: 0,
              })
            : report(),
        ),
      { PROBLEMS_SYNC_WORKER_MAX_CONCURRENT_JOBS: 2 },
    );
    await worker.runTickOnce();
    const badAfter = (await persistenceA.findByAccountId(
      bad.marketplaceAccountId,
    ))!;
    const goodAfter = (await persistenceA.findByAccountId(
      good.marketplaceAccountId,
    ))!;
    expect(badAfter.status).toBe('FAILED_AUTH');
    expect(badAfter.lastErrorCode).toBe('TOKEN_EXPIRED');
    expect(goodAfter.status).toBe('RUNNING');
    expect(goodAfter.claimsProcessedCount).toBe(2);
  });

  it('falha transitória agenda retry com attempt_count=1; sucesso seguinte zera', async () => {
    const job = await newJob();
    let failing = true;
    const worker = buildWorker(persistenceA, () =>
      Promise.resolve(
        failing ? report({ stopReason: 'PROVIDER_UNAVAILABLE' }) : report(),
      ),
    );
    await worker.runTickOnce();
    let after = (await persistenceA.findByAccountId(job.marketplaceAccountId))!;
    expect(after.status).toBe('WAITING_RETRY');
    expect(after.attemptCount).toBe(1);
    expect(after.lastErrorCode).toBe('PROVIDER_UNAVAILABLE');

    failing = false;
    await dsA.query(
      `UPDATE marketplace_problems_sync_jobs SET next_attempt_at = now() WHERE id = $1`,
      [job.id],
    );
    await worker.runTickOnce();
    after = (await persistenceA.findByAccountId(job.marketplaceAccountId))!;
    expect(after.status).toBe('RUNNING');
    expect(after.attemptCount).toBe(0);
    expect(after.lastErrorCode).toBeNull();
  });

  it('cursor: falha de core mantém; sucesso avança', async () => {
    const job = await newJob();
    const advanced = new Date(job.windowCursorAt.getTime() + 3_600_000);
    let mode: 'core' | 'ok' = 'core';
    const worker = buildWorker(persistenceA, () =>
      Promise.resolve(
        mode === 'core'
          ? report({ stopReason: 'CORE_COVERAGE_INCOMPLETE' })
          : report({ creationCursorAdvancedTo: advanced }),
      ),
    );
    await worker.runTickOnce();
    let after = (await persistenceA.findByAccountId(job.marketplaceAccountId))!;
    expect(after.windowCursorAt.getTime()).toBe(job.windowCursorAt.getTime());

    mode = 'ok';
    await dsA.query(
      `UPDATE marketplace_problems_sync_jobs SET next_attempt_at = now() WHERE id = $1`,
      [job.id],
    );
    await worker.runTickOnce();
    after = (await persistenceA.findByAccountId(job.marketplaceAccountId))!;
    expect(after.windowCursorAt.getTime()).toBe(advanced.getTime());
  });

  it('pausa pedida com o tick em voo: o tick termina, o progresso é gravado e o job fica PAUSED; o próximo ciclo não o reivindica', async () => {
    const job = await newJob();
    const worker = buildWorker(persistenceA, async (running) => {
      await persistenceB.requestPause(running.marketplaceAccountId);
      return report({ claimsProcessed: 7 });
    });
    await worker.runTickOnce();
    const after = (await persistenceA.findByAccountId(
      job.marketplaceAccountId,
    ))!;
    expect(after.status).toBe('PAUSED');
    expect(after.pauseRequested).toBe(false);
    expect(after.claimsProcessedCount).toBe(7);

    const second = jest.fn();
    const again = buildWorker(persistenceA, (j) => {
      second(j);
      return Promise.resolve(report());
    });
    await again.runTickOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('perda de CAS: worker lento que teve o lease roubado não sobrescreve o novo dono e não derruba o ciclo', async () => {
    const job = await newJob();
    const slow = buildWorker(persistenceA, async (running) => {
      // Enquanto o worker A "trabalha", o lease expira e B reivindica e commita.
      await dsA.query(
        `UPDATE marketplace_problems_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
        [running.id],
      );
      const fast = buildWorker(persistenceB, () =>
        Promise.resolve(report({ claimsProcessed: 11 })),
      );
      await fast.runTickOnce();
      return report({ claimsProcessed: 999 });
    });
    await expect(slow.runTickOnce()).resolves.toBeUndefined();
    const after = (await persistenceA.findByAccountId(
      job.marketplaceAccountId,
    ))!;
    // Só o commit do worker B (11) valeu; o de A (999) foi descartado.
    expect(after.claimsProcessedCount).toBe(11);
  });
});
