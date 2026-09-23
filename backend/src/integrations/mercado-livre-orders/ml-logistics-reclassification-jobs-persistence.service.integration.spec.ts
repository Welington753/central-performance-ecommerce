import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MlLogisticsReclassificationJobsPersistenceService } from './ml-logistics-reclassification-jobs-persistence.service';

/**
 * Prova de concorrência REAL (correção da auditoria Full, "Render free sem
 * Shell") — contra um PostgreSQL real, nunca mocks: `FOR UPDATE SKIP LOCKED`
 * e CAS por `version` só têm sentido testados com locks reais de banco.
 * Requer `TEST_DATABASE_URL` (nunca `cpe-local-pg`).
 */
describe('MlLogisticsReclassificationJobsPersistenceService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MlLogisticsReclassificationJobsPersistenceService;
  let accountId: string;
  let secondAccountId: string;
  const NOW = new Date('2026-09-01T12:00:00.000Z');

  async function seedAccount(nickname: string): Promise<string> {
    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: nickname,
      nickname,
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    return account.id;
  }

  beforeAll(async () => {
    dataSource = await createTestDataSource([MarketplaceAccount]);
    service = new MlLogisticsReclassificationJobsPersistenceService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE ml_logistics_reclassification_jobs CASCADE',
    );
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    accountId = await seedAccount('Meli 1');
    secondAccountId = await seedAccount('Meli 2');
  });

  describe('createIfAbsent / idempotência', () => {
    it('creates a RUNNING row with the given initial snapshot', async () => {
      const row = await service.createIfAbsent(accountId, 7933, NOW);
      expect(row.status).toBe('RUNNING');
      expect(row.initialUnknownCount).toBe(7933);
      expect(row.remainingUnknownCount).toBe(7933);
      expect(row.resolvedFullCount).toBe(0);
      expect(row.resolvedNotFullCount).toBe(0);
      expect(row.callsMadeCount).toBe(0);
    });

    it('a second createIfAbsent for the same account never creates a second row and never overwrites the original snapshot', async () => {
      await service.createIfAbsent(accountId, 7933, NOW);
      const second = await service.createIfAbsent(accountId, 999, NOW);
      expect(second.initialUnknownCount).toBe(7933);

      const rows = await dataSource.query<Array<{ count: number }>>(
        'SELECT count(*)::int AS count FROM ml_logistics_reclassification_jobs WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].count).toBe(1);
    });

    it('two concurrent createIfAbsent calls for the same account never create two rows (double click on Iniciar)', async () => {
      const results = await Promise.allSettled([
        service.createIfAbsent(accountId, 100, NOW),
        service.createIfAbsent(accountId, 100, NOW),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const rows = await dataSource.query<Array<{ count: number }>>(
        'SELECT count(*)::int AS count FROM ml_logistics_reclassification_jobs WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].count).toBe(1);
    });
  });

  describe('restart', () => {
    it('reopens a COMPLETED row, preserving initialUnknownCount and accumulated counters', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs
            SET status = 'COMPLETED', resolved_full_count = 40, resolved_not_full_count = 60
          WHERE marketplace_account_id = $1`,
        [accountId],
      );
      const restarted = await service.restart(accountId, NOW);
      expect(restarted?.status).toBe('RUNNING');
      expect(restarted?.initialUnknownCount).toBe(100);
      expect(restarted?.resolvedFullCount).toBe(40);
      expect(restarted?.resolvedNotFullCount).toBe(60);
    });

    it('reopens a FAILED_AUTH row after reconnection', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs
            SET status = 'FAILED_AUTH', last_error_code = 'ABORTED_UNAUTHORIZED'
          WHERE marketplace_account_id = $1`,
        [accountId],
      );
      const restarted = await service.restart(accountId, NOW);
      expect(restarted?.status).toBe('RUNNING');
      expect(restarted?.lastErrorCode).toBeNull();
    });

    it('never restarts a RUNNING/WAITING_RETRY/PAUSED row', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      const restarted = await service.restart(accountId, NOW);
      expect(restarted).toBeNull();
    });
  });

  describe('requestPause / resume', () => {
    it('pauses a WAITING_RETRY row immediately', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs SET status = 'WAITING_RETRY' WHERE marketplace_account_id = $1`,
        [accountId],
      );
      const paused = await service.requestPause(accountId);
      expect(paused?.status).toBe('PAUSED');
    });

    it('only flags pause_requested on a RUNNING row — the worker transitions to PAUSED itself at the end of the tick', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      const result = await service.requestPause(accountId);
      expect(result?.status).toBe('RUNNING');
      expect(result?.pauseRequested).toBe(true);
    });

    it('resume brings a PAUSED row back to RUNNING', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await service.requestPause(accountId);
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs SET status = 'PAUSED' WHERE marketplace_account_id = $1`,
        [accountId],
      );
      const resumed = await service.resume(accountId, NOW);
      expect(resumed?.status).toBe('RUNNING');
      expect(resumed?.pauseRequested).toBe(false);
    });

    it('resume brings a FAILED_AUTH row back to RUNNING, clearing lastErrorCode', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs
            SET status = 'FAILED_AUTH', last_error_code = 'ABORTED_UNAUTHORIZED'
          WHERE marketplace_account_id = $1`,
        [accountId],
      );
      const resumed = await service.resume(accountId, NOW);
      expect(resumed?.status).toBe('RUNNING');
      expect(resumed?.lastErrorCode).toBeNull();
    });
  });

  describe('claim — concorrência e justiça (round-robin)', () => {
    it('claims nothing before next_attempt_at', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs SET next_attempt_at = now() + interval '1 hour' WHERE marketplace_account_id = $1`,
        [accountId],
      );
      const claimed = await service.claim('worker-1', 5, 60000);
      expect(claimed).toHaveLength(0);
    });

    it('two workers claiming the same account at the same time never both succeed', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      const [a, b] = await Promise.all([
        service.claim('worker-a', 1, 60000),
        service.claim('worker-b', 1, 60000),
      ]);
      const claimedTotal = a.length + b.length;
      expect(claimedTotal).toBe(1);
    });

    it('recovers a RUNNING row whose lease expired (worker crashed mid-tick)', async () => {
      const created = await service.createIfAbsent(accountId, 100, NOW);
      await service.claim('worker-crashed', 1, 60000);
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`,
        [created.id],
      );
      const claimed = await service.claim('worker-recovery', 1, 60000);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].leaseOwner).toBe('worker-recovery');
    });

    it('never reclaims a row with an active (non-expired) lease', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await service.claim('worker-a', 1, 120000);
      const second = await service.claim('worker-b', 1, 120000);
      expect(second).toHaveLength(0);
    });

    it('round-robin: whichever account was serviced longest ago is claimed first under constrained concurrency', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await service.createIfAbsent(secondAccountId, 100, NOW);

      // Simula um tick anterior: Meli 1 acabou de ser atendida agora,
      // Meli 2 nunca foi atendida (last_activity_at continua o do create).
      await dataSource.query(
        `UPDATE ml_logistics_reclassification_jobs SET last_activity_at = now() WHERE marketplace_account_id = $1`,
        [accountId],
      );

      const claimed = await service.claim('worker-1', 1, 60000);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].marketplaceAccountId).toBe(secondAccountId);
    });

    it('with headroom for both, claims Meli 1 and Meli 2 in the same tick — neither monopolizes the worker', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      await service.createIfAbsent(secondAccountId, 100, NOW);
      const claimed = await service.claim('worker-1', 2, 60000);
      expect(claimed).toHaveLength(2);
      const claimedAccountIds = claimed
        .map((c) => c.marketplaceAccountId)
        .sort();
      expect(claimedAccountIds).toEqual([accountId, secondAccountId].sort());
    });
  });

  describe('commit — CAS e acumulação de contadores', () => {
    it('accumulates resolved/calls counters across successive commits, never replaces them', async () => {
      const created = await service.createIfAbsent(accountId, 100, NOW);
      const [claimed] = await service.claim('worker-1', 1, 60000);

      await service.commit(claimed.id, claimed.version, 'worker-1', {
        status: 'RUNNING',
        remainingUnknownCount: 90,
        resolvedFullDelta: 3,
        resolvedNotFullDelta: 7,
        callsMadeDelta: 10,
        queue1CursorId: null,
        queue2CursorId: null,
        passResolvedCount: 10,
        nextAttemptAt: NOW,
        lastActivityAt: NOW,
        completedAt: null,
        lastErrorCode: null,
        pauseRequested: false,
        releaseLease: true,
      });

      const [reClaimed] = await service.claim('worker-1', 1, 60000);
      await service.commit(reClaimed.id, reClaimed.version, 'worker-1', {
        status: 'COMPLETED',
        remainingUnknownCount: 0,
        resolvedFullDelta: 5,
        resolvedNotFullDelta: 2,
        callsMadeDelta: 8,
        queue1CursorId: null,
        queue2CursorId: null,
        passResolvedCount: 0,
        nextAttemptAt: NOW,
        lastActivityAt: NOW,
        completedAt: NOW,
        lastErrorCode: null,
        pauseRequested: false,
        releaseLease: true,
      });

      const final = await service.findByAccountId(accountId);
      expect(final?.resolvedFullCount).toBe(8);
      expect(final?.resolvedNotFullCount).toBe(9);
      expect(final?.callsMadeCount).toBe(18);
      expect(final?.status).toBe('COMPLETED');
      void created;
    });

    it('a commit with a stale version (lost lease race) affects nothing and returns false', async () => {
      await service.createIfAbsent(accountId, 100, NOW);
      const [claimed] = await service.claim('worker-1', 1, 60000);

      const committed = await service.commit(
        claimed.id,
        claimed.version + 999,
        'worker-1',
        {
          status: 'COMPLETED',
          remainingUnknownCount: 0,
          resolvedFullDelta: 100,
          resolvedNotFullDelta: 0,
          callsMadeDelta: 1,
          queue1CursorId: null,
          queue2CursorId: null,
          passResolvedCount: 0,
          nextAttemptAt: NOW,
          lastActivityAt: NOW,
          completedAt: NOW,
          lastErrorCode: null,
          pauseRequested: false,
          releaseLease: true,
        },
      );
      expect(committed).toBe(false);

      const row = await service.findByAccountId(accountId);
      expect(row?.resolvedFullCount).toBe(0);
      expect(row?.status).toBe('RUNNING');
    });
  });
});
