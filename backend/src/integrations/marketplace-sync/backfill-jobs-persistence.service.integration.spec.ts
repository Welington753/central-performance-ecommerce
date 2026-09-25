import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import {
  BackfillJobActiveConflictError,
  BackfillJobsPersistenceService,
} from './backfill-jobs-persistence.service';

/**
 * Prova de concorrência REAL (Fase 4, "Backfill durável") — contra um
 * PostgreSQL 16 de verdade, nunca mocks: `FOR UPDATE SKIP LOCKED` só tem
 * sentido testado com locks reais de banco. Requer `TEST_DATABASE_URL`
 * (nunca `cpe-local-pg` — ver `require-test-database-url.ts`).
 */
describe('BackfillJobsPersistenceService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: BackfillJobsPersistenceService;
  let accountId: string;
  let secondAccountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([MarketplaceAccount]);
    service = new BackfillJobsPersistenceService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_backfill_jobs CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '1548451374',
      nickname: 'EZIEHOME',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;

    const second = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '999888777',
      nickname: 'Segunda Loja ML',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    secondAccountId = second.id;
  });

  describe('createJob / idempotência', () => {
    it('creates a QUEUED job ready to be claimed immediately', async () => {
      const job = await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      expect(job.status).toBe('QUEUED');
      expect(job.chunksProcessed).toBe(0);
      expect(job.attemptCount).toBe(0);
      expect(job.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('a second createJob for the same account while one is active throws BackfillJobActiveConflictError (never a second job)', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await expect(
        service.createJob(accountId, Marketplace.MERCADO_LIVRE),
      ).rejects.toBeInstanceOf(BackfillJobActiveConflictError);

      const rows = await dataSource.query<Array<{ count: number }>>(
        'SELECT count(*)::int AS count FROM marketplace_backfill_jobs WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].count).toBe(1);
    });

    it('two concurrent createJob calls for the same account never create two jobs (double click)', async () => {
      const results = await Promise.allSettled([
        service.createJob(accountId, Marketplace.MERCADO_LIVRE),
        service.createJob(accountId, Marketplace.MERCADO_LIVRE),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const rows = await dataSource.query<Array<{ count: number }>>(
        'SELECT count(*)::int AS count FROM marketplace_backfill_jobs WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].count).toBe(1);
    });

    it('a new job can be created after the previous one becomes terminal (FAILED)', async () => {
      const first = await service.createJob(
        accountId,
        Marketplace.MERCADO_LIVRE,
      );
      await dataSource.query(
        `UPDATE marketplace_backfill_jobs SET status = 'FAILED' WHERE id = $1`,
        [first.id],
      );

      const second = await service.createJob(
        accountId,
        Marketplace.MERCADO_LIVRE,
      );
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('claimJobs — concorrência entre processos', () => {
    it('two simultaneous claim attempts for the same single job: only one succeeds (FOR UPDATE SKIP LOCKED)', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);

      const [claimA, claimB] = await Promise.all([
        service.claimJobs('worker-A', 5, 60000),
        service.claimJobs('worker-B', 5, 60000),
      ]);

      const totalClaimed = claimA.length + claimB.length;
      expect(totalClaimed).toBe(1);
    });

    it('claims jobs from two different accounts independently (Mercado Livre 1 x 2 isolation)', async () => {
      const jobA = await service.createJob(
        accountId,
        Marketplace.MERCADO_LIVRE,
      );
      const jobB = await service.createJob(
        secondAccountId,
        Marketplace.MERCADO_LIVRE,
      );

      const claimed = await service.claimJobs('worker-1', 5, 60000);

      expect(claimed.map((j) => j.id).sort()).toEqual(
        [jobA.id, jobB.id].sort(),
      );
      expect(claimed.find((j) => j.id === jobA.id)!.marketplaceAccountId).toBe(
        accountId,
      );
      expect(claimed.find((j) => j.id === jobB.id)!.marketplaceAccountId).toBe(
        secondAccountId,
      );
    });

    it('a job already RUNNING with a valid lease is never claimed again (sequential execution — one chunk at a time)', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      const [claimedOnce] = await service.claimJobs('worker-1', 5, 60000);
      expect(claimedOnce).toBeDefined();

      const claimedAgain = await service.claimJobs('worker-2', 5, 60000);
      expect(claimedAgain).toHaveLength(0);
    });

    it('sets started_at and last_activity_at (heartbeat) on claim', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      const [claimed] = await service.claimJobs('worker-1', 5, 60000);
      expect(claimed.status).toBe('RUNNING');
      expect(claimed.startedAt).not.toBeNull();
      expect(claimed.lastActivityAt).not.toBeNull();
      expect(claimed.leaseOwner).toBe('worker-1');
      expect(claimed.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('recovers an abandoned job: RUNNING with an expired lease is reclaimable after a restart', async () => {
      const job = await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      // Simula um worker que caiu no meio do processamento: lease no passado.
      await dataSource.query(
        `UPDATE marketplace_backfill_jobs
            SET status = 'RUNNING', lease_owner = 'dead-worker',
                lease_expires_at = now() - interval '1 hour'
          WHERE id = $1`,
        [job.id],
      );

      const claimed = await service.claimJobs('worker-new', 5, 60000);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].leaseOwner).toBe('worker-new');
    });

    it('respects the limit passed in (global concurrency control)', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await service.createJob(secondAccountId, Marketplace.MERCADO_LIVRE);

      const claimed = await service.claimJobs('worker-1', 1, 60000);
      expect(claimed).toHaveLength(1);
    });

    it('does not claim a job whose next_attempt_at is in the future (RETRY_WAIT backoff)', async () => {
      const job = await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await dataSource.query(
        `UPDATE marketplace_backfill_jobs
            SET status = 'RETRY_WAIT', next_attempt_at = now() + interval '1 hour'
          WHERE id = $1`,
        [job.id],
      );

      const claimed = await service.claimJobs('worker-1', 5, 60000);
      expect(claimed).toHaveLength(0);
    });

    it('never claims a PAUSED or FAILED job', async () => {
      const job = await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await dataSource.query(
        `UPDATE marketplace_backfill_jobs SET status = 'PAUSED' WHERE id = $1`,
        [job.id],
      );
      expect(await service.claimJobs('worker-1', 5, 60000)).toHaveLength(0);

      await dataSource.query(
        `UPDATE marketplace_backfill_jobs SET status = 'FAILED' WHERE id = $1`,
        [job.id],
      );
      expect(await service.claimJobs('worker-1', 5, 60000)).toHaveLength(0);
    });
  });

  describe('commitJobState — CAS por version + lease_owner', () => {
    it('commits successfully when version and lease_owner still match', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      const [claimed] = await service.claimJobs('worker-1', 5, 60000);

      const committed = await service.commitJobState(
        claimed.id,
        claimed.version,
        'worker-1',
        {
          status: 'QUEUED',
          chunksProcessed: 1,
          attemptCount: 0,
          nextAttemptAt: new Date(),
          lastActivityAt: new Date(),
          completedAt: null,
          lastErrorCode: null,
          pauseRequested: false,
          releaseLease: true,
        },
      );
      expect(committed).toBe(true);

      const job = await service.findLatestJob(accountId);
      expect(job!.chunksProcessed).toBe(1);
      expect(job!.leaseOwner).toBeNull();
    });

    it('a stale commit (lost the lease race) never overwrites the job — returns false, job untouched', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      const [claimed] = await service.claimJobs('worker-1', 5, 1); // lease de 1ms — expira quase na hora
      await new Promise((resolve) => setTimeout(resolve, 20));

      // worker-2 reivindica de novo, pelo lease expirado.
      const [reclaimed] = await service.claimJobs('worker-2', 5, 60000);
      expect(reclaimed.id).toBe(claimed.id);

      // worker-1 (achando que ainda é dono) tenta persistir seu resultado —
      // perdeu a corrida: nunca sobrescreve o que worker-2 já reivindicou.
      const staleCommit = await service.commitJobState(
        claimed.id,
        claimed.version,
        'worker-1',
        {
          status: 'QUEUED',
          chunksProcessed: 1,
          attemptCount: 0,
          nextAttemptAt: new Date(),
          lastActivityAt: new Date(),
          completedAt: null,
          lastErrorCode: null,
          pauseRequested: false,
          releaseLease: true,
        },
      );
      expect(staleCommit).toBe(false);

      const job = await service.findLatestJob(accountId);
      expect(job!.leaseOwner).toBe('worker-2');
      expect(job!.chunksProcessed).toBe(0);
    });
  });

  describe('pausar / retomar', () => {
    it('pauses a QUEUED job immediately', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      const paused = await service.requestPause(accountId);
      expect(paused!.status).toBe('PAUSED');
    });

    it('pausing a RUNNING job only sets pause_requested — the worker transitions to PAUSED itself between chunks', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await service.claimJobs('worker-1', 5, 60000);

      const paused = await service.requestPause(accountId);
      expect(paused!.status).toBe('RUNNING');
      expect(paused!.pauseRequested).toBe(true);
    });

    it('resumeJob moves a PAUSED job back to QUEUED with a fresh attempt budget', async () => {
      const job = await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await dataSource.query(
        `UPDATE marketplace_backfill_jobs SET status = 'PAUSED', attempt_count = 3 WHERE id = $1`,
        [job.id],
      );

      const resumed = await service.resumeJob(accountId);
      expect(resumed!.status).toBe('QUEUED');
      expect(resumed!.attemptCount).toBe(0);
      expect(resumed!.pauseRequested).toBe(false);
    });

    it('resumeJob is a no-op for an already-active job', async () => {
      const job = await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      const resumed = await service.resumeJob(accountId);
      expect(resumed!.id).toBe(job.id);
      expect(resumed!.status).toBe('QUEUED');
    });

    it('resumeJob reopens a FAILED job', async () => {
      const job = await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await dataSource.query(
        `UPDATE marketplace_backfill_jobs SET status = 'FAILED', attempt_count = 5, last_error_code = 'SYNC_FAILED' WHERE id = $1`,
        [job.id],
      );

      const resumed = await service.resumeJob(accountId);
      expect(resumed!.status).toBe('QUEUED');
      expect(resumed!.attemptCount).toBe(0);
    });
  });

  describe('isolamento entre contas', () => {
    it('pausing account A never affects account B job', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await service.createJob(secondAccountId, Marketplace.MERCADO_LIVRE);

      await service.requestPause(accountId);

      const jobA = await service.findLatestJob(accountId);
      const jobB = await service.findLatestJob(secondAccountId);
      expect(jobA!.status).toBe('PAUSED');
      expect(jobB!.status).toBe('QUEUED');
    });
  });

  describe('countCurrentlyRunning', () => {
    it('counts only RUNNING jobs with an unexpired lease', async () => {
      await service.createJob(accountId, Marketplace.MERCADO_LIVRE);
      await service.createJob(secondAccountId, Marketplace.MERCADO_LIVRE);

      expect(await service.countCurrentlyRunning()).toBe(0);

      await service.claimJobs('worker-1', 5, 60000);
      expect(await service.countCurrentlyRunning()).toBe(2);
    });
  });
  describe('modo BUYER_ENRICHMENT (função Clientes)', () => {
    it('stores mode + cursor, keeps history lookups isolated and still allows only ONE active job per account', async () => {
      const cursor = new Date('2026-09-01T00:00:00.000Z');
      const job = await service.createJob(
        accountId,
        Marketplace.MERCADO_LIVRE,
        'BUYER_ENRICHMENT',
        cursor,
      );
      expect(job).toMatchObject({
        mode: 'BUYER_ENRICHMENT',
        cursorBefore: cursor,
      });
      expect(await service.findLatestJob(accountId)).toBeNull();
      expect(
        (await service.findLatestJob(accountId, 'BUYER_ENRICHMENT'))?.id,
      ).toBe(job.id);
      await expect(
        service.createJob(accountId, Marketplace.MERCADO_LIVRE),
      ).rejects.toBeInstanceOf(BackfillJobActiveConflictError);
    });

    it('commitJobState advances the cursor only when a new one is given (CAS-guarded)', async () => {
      await service.createJob(
        accountId,
        Marketplace.MERCADO_LIVRE,
        'BUYER_ENRICHMENT',
        new Date('2026-09-01T00:00:00.000Z'),
      );
      const [claimed] = await service.claimJobs('worker-1', 1, 60000);
      const base = {
        status: 'QUEUED' as const,
        chunksProcessed: 1,
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lastActivityAt: new Date(),
        completedAt: null,
        lastErrorCode: null,
        pauseRequested: false,
        releaseLease: true,
      };
      const next = new Date('2026-08-02T00:00:00.000Z');
      expect(
        await service.commitJobState(claimed.id, claimed.version, 'worker-1', {
          ...base,
          cursorBefore: next,
        }),
      ).toBe(true);
      const [again] = await service.claimJobs('worker-1', 1, 60000);
      await service.commitJobState(again.id, again.version, 'worker-1', base);
      const latest = await service.findLatestJob(accountId, 'BUYER_ENRICHMENT');
      expect(latest?.cursorBefore).toEqual(next);
    });

    it('pause/resume act only on the requested mode', async () => {
      await service.createJob(
        accountId,
        Marketplace.MERCADO_LIVRE,
        'BUYER_ENRICHMENT',
        new Date(),
      );
      expect(await service.requestPause(accountId)).toBeNull();
      const paused = await service.requestPause(accountId, 'BUYER_ENRICHMENT');
      expect(paused?.status).toBe('PAUSED');
      const resumed = await service.resumeJob(accountId, 'BUYER_ENRICHMENT');
      expect(resumed?.status).toBe('QUEUED');
    });
  });
});
