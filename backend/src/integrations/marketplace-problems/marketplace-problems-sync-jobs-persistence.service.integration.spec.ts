import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import type { MarketplaceProblemsSyncJobCommitUpdate } from './marketplace-problems-sync-jobs.types';
import {
  INITIAL_WINDOW_DAYS,
  MarketplaceProblemsSyncJobsPersistenceService,
} from './marketplace-problems-sync-jobs-persistence.service';

const DAY_MS = 24 * 60 * 60 * 1000;

function newDataSource(): DataSource {
  return new DataSource(
    buildDataSourceOptions({
      databaseUrl: requireTestDatabaseUrl(),
      nodeEnv: 'test',
    }),
  );
}

describe('MarketplaceProblemsSyncJobsPersistenceService (Postgres real)', () => {
  let dataSource: DataSource;
  let secondDataSource: DataSource;
  let service: MarketplaceProblemsSyncJobsPersistenceService;
  let secondService: MarketplaceProblemsSyncJobsPersistenceService;

  beforeAll(async () => {
    dataSource = newDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
    secondDataSource = newDataSource();
    await secondDataSource.initialize();
    service = new MarketplaceProblemsSyncJobsPersistenceService(dataSource);
    secondService = new MarketplaceProblemsSyncJobsPersistenceService(
      secondDataSource,
    );
  });

  afterAll(async () => {
    await secondDataSource.destroy();
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // Isola cada teste: a claim query enxerga a tabela inteira.
    await dataSource.query(`DELETE FROM marketplace_problems_sync_jobs`);
  });

  async function newAccount(): Promise<string> {
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`],
    );
    return account.id;
  }

  function commitUpdate(
    overrides: Partial<MarketplaceProblemsSyncJobCommitUpdate> = {},
  ): MarketplaceProblemsSyncJobCommitUpdate {
    const now = new Date();
    return {
      status: 'RUNNING',
      windowCursorAt: now,
      claimsProcessedDelta: 0,
      claimsPersistedDelta: 0,
      claimsFailedDelta: 0,
      callsMadeDelta: 0,
      attemptCount: 0,
      nextAttemptAt: now,
      lastActivityAt: now,
      lastErrorCode: null,
      lastCompleteCensusAt: null,
      historical: null,
      ...overrides,
    };
  }

  describe('createIfAbsent', () => {
    it('cria RUNNING com cursor inicial = now - INITIAL_WINDOW_DAYS', async () => {
      const accountId = await newAccount();
      const now = new Date('2026-06-15T12:00:00.000Z');
      const job = await service.createIfAbsent(accountId, now);
      expect(job.status).toBe('RUNNING');
      expect(job.attemptCount).toBe(0);
      expect(job.version).toBe(0);
      expect(job.windowCursorAt.getTime()).toBe(
        now.getTime() - INITIAL_WINDOW_DAYS * DAY_MS,
      );
    });

    it('é idempotente: segunda chamada devolve a linha existente sem tocar em nada', async () => {
      const accountId = await newAccount();
      const first = await service.createIfAbsent(
        accountId,
        new Date('2026-06-15T12:00:00.000Z'),
      );
      const second = await service.createIfAbsent(
        accountId,
        new Date('2026-07-20T12:00:00.000Z'),
      );
      expect(second.id).toBe(first.id);
      expect(second.windowCursorAt.getTime()).toBe(
        first.windowCursorAt.getTime(),
      );
      const [{ count }] = await dataSource.query<Array<{ count: string }>>(
        `SELECT count(*) FROM marketplace_problems_sync_jobs WHERE marketplace_account_id = $1`,
        [accountId],
      );
      expect(count).toBe('1');
    });

    it('o default da janela inicial é 60 dias', () => {
      expect(INITIAL_WINDOW_DAYS).toBe(60);
    });

    it('aceita initialWindowDays explícito', async () => {
      const accountId = await newAccount();
      const now = new Date('2026-06-15T12:00:00.000Z');
      const job = await service.createIfAbsent(accountId, now, 7);
      expect(job.windowCursorAt.getTime()).toBe(now.getTime() - 7 * DAY_MS);
    });
  });

  describe('claim', () => {
    it('reivindica com lease, owner e version+1', async () => {
      const accountId = await newAccount();
      const created = await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 5, 60000);
      expect(claimed.id).toBe(created.id);
      expect(claimed.leaseOwner).toBe('worker-a');
      expect(claimed.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(claimed.version).toBe(created.version + 1);
    });

    it('não reivindica job com lease ativo nem com next_attempt_at no futuro', async () => {
      const a = await newAccount();
      const b = await newAccount();
      await service.createIfAbsent(a, new Date());
      const jobB = await service.createIfAbsent(b, new Date());
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET next_attempt_at = now() + interval '1 hour' WHERE id = $1`,
        [jobB.id],
      );
      const first = await service.claim('worker-a', 5, 60000);
      expect(first).toHaveLength(1);
      expect(first[0].marketplaceAccountId).toBe(a);
      expect(await service.claim('worker-b', 5, 60000)).toHaveLength(0);
    });

    it('reivindica lease EXPIRADO (worker anterior caiu)', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [first] = await service.claim('worker-a', 1, 60000);
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
        [first.id],
      );
      const [reclaimed] = await service.claim('worker-b', 1, 60000);
      expect(reclaimed.id).toBe(first.id);
      expect(reclaimed.leaseOwner).toBe('worker-b');
      expect(reclaimed.version).toBe(first.version + 1);
    });

    it('não reivindica PAUSED, FAILED nem FAILED_AUTH', async () => {
      for (const status of ['PAUSED', 'FAILED', 'FAILED_AUTH']) {
        const accountId = await newAccount();
        const job = await service.createIfAbsent(accountId, new Date());
        await dataSource.query(
          `UPDATE marketplace_problems_sync_jobs SET status = $2 WHERE id = $1`,
          [job.id, status],
        );
      }
      expect(await service.claim('worker-a', 10, 60000)).toHaveLength(0);
    });

    it('limit <= 0 devolve vazio', async () => {
      await service.createIfAbsent(await newAccount(), new Date());
      expect(await service.claim('worker-a', 0, 60000)).toEqual([]);
    });

    it('duas conexões reais nunca reivindicam o mesmo job (SKIP LOCKED: linha travada é pulada, sem bloquear)', async () => {
      const accountId = await newAccount();
      const job = await service.createIfAbsent(accountId, new Date());

      // Conexão A segura o lock da linha numa transação aberta.
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT id FROM marketplace_problems_sync_jobs WHERE id = $1 FOR UPDATE`,
        [job.id],
      );
      try {
        // Conexão B (outro pool) NÃO espera e NÃO enxerga o job.
        const claimedByB = await secondService.claim('worker-b', 5, 60000);
        expect(claimedByB).toHaveLength(0);
      } finally {
        await holder.rollbackTransaction();
        await holder.release();
      }
    });

    it('claims simultâneos de duas conexões: exatamente um vence', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [a, b] = await Promise.all([
        service.claim('worker-a', 1, 60000),
        secondService.claim('worker-b', 1, 60000),
      ]);
      expect(a.length + b.length).toBe(1);
    });

    it('round-robin determinístico: next_attempt_at, depois atividade (nulos primeiro), depois id', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const job = await service.createIfAbsent(
          await newAccount(),
          new Date(),
        );
        ids.push(job.id);
      }
      const [oldest, neverActive, activeEarly, activeLate] = ids;
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET
           next_attempt_at = CASE id
             WHEN $1 THEN now() - interval '10 minutes'
             ELSE now() - interval '1 minute' END,
           last_activity_at = CASE id
             WHEN $2 THEN NULL
             WHEN $3 THEN now() - interval '30 minutes'
             WHEN $4 THEN now() - interval '5 minutes'
             ELSE now() - interval '1 hour' END`,
        [oldest, neverActive, activeEarly, activeLate],
      );
      const claimed = await service.claim('worker-a', 4, 60000);
      expect(claimed.map((j) => j.id)).toEqual([
        oldest,
        neverActive,
        activeEarly,
        activeLate,
      ]);
    });
  });

  describe('commit (CAS)', () => {
    it('grava, soma deltas, libera o lease e incrementa version', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 1, 60000);
      const cursor = new Date('2026-06-01T00:00:00.000Z');
      const ok = await service.commit(
        claimed.id,
        claimed.version,
        'worker-a',
        commitUpdate({
          windowCursorAt: cursor,
          claimsProcessedDelta: 3,
          claimsPersistedDelta: 2,
          claimsFailedDelta: 1,
          callsMadeDelta: 9,
          lastErrorCode: 'RATE_LIMITED',
          lastCompleteCensusAt: cursor,
        }),
      );
      expect(ok).toBe(true);
      const after = (await service.findByAccountId(accountId))!;
      expect(after.windowCursorAt.getTime()).toBe(cursor.getTime());
      expect(after.claimsProcessedCount).toBe(3);
      expect(after.claimsPersistedCount).toBe(2);
      expect(after.claimsFailedCount).toBe(1);
      expect(after.callsMadeCount).toBe(9);
      expect(after.lastErrorCode).toBe('RATE_LIMITED');
      expect(after.lastCompleteCensusAt!.getTime()).toBe(cursor.getTime());
      expect(after.leaseOwner).toBeNull();
      expect(after.leaseExpiresAt).toBeNull();
      expect(after.version).toBe(claimed.version + 1);

      // Segundo commit soma (deltas), nunca substitui; lastCompleteCensusAt null mantém.
      const [again] = await service.claim('worker-a', 1, 60000);
      await service.commit(
        again.id,
        again.version,
        'worker-a',
        commitUpdate({ claimsProcessedDelta: 2, lastCompleteCensusAt: null }),
      );
      const final = (await service.findByAccountId(accountId))!;
      expect(final.claimsProcessedCount).toBe(5);
      expect(final.lastCompleteCensusAt!.getTime()).toBe(cursor.getTime());
    });

    it('version errada retorna false e NÃO escreve', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 1, 60000);
      const ok = await service.commit(
        claimed.id,
        claimed.version - 1,
        'worker-a',
        commitUpdate({ claimsProcessedDelta: 99, status: 'FAILED' }),
      );
      expect(ok).toBe(false);
      const after = (await service.findByAccountId(accountId))!;
      expect(after.claimsProcessedCount).toBe(0);
      expect(after.status).toBe('RUNNING');
      expect(after.leaseOwner).toBe('worker-a');
    });

    it('lease_owner errado retorna false e NÃO escreve', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 1, 60000);
      const ok = await service.commit(
        claimed.id,
        claimed.version,
        'worker-intruso',
        commitUpdate({ claimsProcessedDelta: 99 }),
      );
      expect(ok).toBe(false);
      expect(
        (await service.findByAccountId(accountId))!.claimsProcessedCount,
      ).toBe(0);
    });

    it('worker que perdeu o lease para outro não sobrescreve o novo dono', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [first] = await service.claim('worker-a', 1, 60000);
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
        [first.id],
      );
      const [second] = await service.claim('worker-b', 1, 60000);
      // worker-a (lento) tenta commitar com a version antiga.
      const stale = await service.commit(
        first.id,
        first.version,
        'worker-a',
        commitUpdate({ claimsProcessedDelta: 50 }),
      );
      expect(stale).toBe(false);
      const still = (await service.findByAccountId(accountId))!;
      expect(still.leaseOwner).toBe('worker-b');
      expect(still.version).toBe(second.version);
      expect(still.claimsProcessedCount).toBe(0);
    });
  });

  describe('pause_requested', () => {
    it('sem lease ativo (RUNNING ocioso) pausa imediatamente', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const paused = await service.requestPause(accountId);
      expect(paused!.status).toBe('PAUSED');
      expect(await service.claim('worker-a', 5, 60000)).toHaveLength(0);
    });

    it('WAITING_RETRY pausa imediatamente', async () => {
      const accountId = await newAccount();
      const job = await service.createIfAbsent(accountId, new Date());
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET status = 'WAITING_RETRY' WHERE id = $1`,
        [job.id],
      );
      expect((await service.requestPause(accountId))!.status).toBe('PAUSED');
    });

    it('com lease ativo só marca a flag, SEM alterar version — o commit do tick em voo ainda vale e converte em PAUSED', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 1, 60000);
      const flagged = await service.requestPause(accountId);
      expect(flagged!.status).toBe('RUNNING');
      expect(flagged!.pauseRequested).toBe(true);
      expect(flagged!.version).toBe(claimed.version);

      const ok = await service.commit(
        claimed.id,
        claimed.version,
        'worker-a',
        commitUpdate({ status: 'RUNNING', claimsProcessedDelta: 4 }),
      );
      expect(ok).toBe(true);
      const after = (await service.findByAccountId(accountId))!;
      expect(after.status).toBe('PAUSED');
      expect(after.pauseRequested).toBe(false);
      expect(after.claimsProcessedCount).toBe(4);
    });

    it('resume volta PAUSED/FAILED/FAILED_AUTH a RUNNING, zera tentativas e erro', async () => {
      const accountId = await newAccount();
      const job = await service.createIfAbsent(accountId, new Date());
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs
            SET status = 'FAILED', attempt_count = 5, last_error_code = 'X' WHERE id = $1`,
        [job.id],
      );
      const resumed = await service.resume(accountId, new Date());
      expect(resumed!.status).toBe('RUNNING');
      expect(resumed!.attemptCount).toBe(0);
      expect(resumed!.lastErrorCode).toBeNull();
      // RUNNING não é retomável (sem efeito).
      expect(await service.resume(accountId, new Date())).toBeNull();
    });
  });

  describe('backfill histórico (historical_*)', () => {
    const T = (iso: string) => new Date(iso);
    const progress = (
      overrides: Partial<
        NonNullable<MarketplaceProblemsSyncJobCommitUpdate['historical']>
      > = {},
    ) => ({
      coveredFrom: T('2026-05-01T00:00:00.000Z'),
      targetFrom: T('2026-01-01T00:00:00.000Z'),
      status: 'RUNNING' as const,
      completedAt: null,
      errorCode: null,
      attemptCount: 0,
      nextAttemptAt: null,
      ...overrides,
    });

    it('createIfAbsent: o histórico nasce no início da cobertura atual (cursor inicial), RUNNING, sem alvo nem conclusão', async () => {
      const accountId = await newAccount();
      const now = T('2026-06-15T12:00:00.000Z');

      const job = await service.createIfAbsent(accountId, now);

      expect(job.historicalCoveredFrom).toEqual(job.windowCursorAt);
      expect(job.historicalCoveredFrom.getTime()).toBe(
        now.getTime() - INITIAL_WINDOW_DAYS * DAY_MS,
      );
      expect(job.historicalStatus).toBe('RUNNING');
      expect(job.historicalTargetFrom).toBeNull();
      expect(job.historicalCompletedAt).toBeNull();
      expect(job.historicalLastErrorCode).toBeNull();
    });

    it('commit grava o progresso histórico SOB o mesmo CAS, sem tocar no cursor incremental', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 1, 60000);
      const cursor = T('2026-06-10T00:00:00.000Z');

      const ok = await service.commit(
        claimed.id,
        claimed.version,
        'worker-a',
        commitUpdate({ windowCursorAt: cursor, historical: progress() }),
      );

      expect(ok).toBe(true);
      const after = (await service.findByAccountId(accountId))!;
      expect(after.windowCursorAt).toEqual(cursor);
      expect(after.historicalCoveredFrom).toEqual(
        T('2026-05-01T00:00:00.000Z'),
      );
      expect(after.historicalTargetFrom).toEqual(T('2026-01-01T00:00:00.000Z'));
      expect(after.historicalStatus).toBe('RUNNING');
    });

    it('PERDA de lease/CAS: nada do histórico é gravado (cursor e status intactos)', async () => {
      const accountId = await newAccount();
      const created = await service.createIfAbsent(accountId, new Date());
      const [first] = await service.claim('worker-a', 1, 60000);
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
        [first.id],
      );
      await service.claim('worker-b', 1, 60000);

      const stale = await service.commit(
        first.id,
        first.version,
        'worker-a',
        commitUpdate({
          historical: progress({
            status: 'COMPLETED',
            completedAt: new Date(),
            errorCode: 'X',
          }),
        }),
      );

      expect(stale).toBe(false);
      const still = (await service.findByAccountId(accountId))!;
      expect(still.historicalCoveredFrom).toEqual(
        created.historicalCoveredFrom,
      );
      expect(still.historicalTargetFrom).toBeNull();
      expect(still.historicalStatus).toBe('RUNNING');
      expect(still.historicalCompletedAt).toBeNull();
      expect(still.historicalLastErrorCode).toBeNull();
    });

    it('historical=null preserva tudo; campos null mantêm o valor; errorCode é explícito (null limpa)', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const commitOnce = async (
        historical: MarketplaceProblemsSyncJobCommitUpdate['historical'],
      ) => {
        await dataSource.query(
          `UPDATE marketplace_problems_sync_jobs SET next_attempt_at = now() - interval '1 second'`,
        );
        const [claimed] = await service.claim('worker-a', 1, 60000);
        expect(
          await service.commit(
            claimed.id,
            claimed.version,
            'worker-a',
            commitUpdate({ historical }),
          ),
        ).toBe(true);
        return (await service.findByAccountId(accountId))!;
      };

      const withError = await commitOnce(
        progress({ errorCode: 'RATE_LIMITED' }),
      );
      expect(withError.historicalLastErrorCode).toBe('RATE_LIMITED');

      const untouched = await commitOnce(null);
      expect(untouched.historicalCoveredFrom).toEqual(
        withError.historicalCoveredFrom,
      );
      expect(untouched.historicalTargetFrom).toEqual(
        withError.historicalTargetFrom,
      );
      expect(untouched.historicalLastErrorCode).toBe('RATE_LIMITED');

      const keptCursor = await commitOnce({
        coveredFrom: null,
        targetFrom: null,
        status: null,
        completedAt: null,
        errorCode: null,
        attemptCount: 0,
        nextAttemptAt: null,
      });
      expect(keptCursor.historicalCoveredFrom).toEqual(
        withError.historicalCoveredFrom,
      );
      expect(keptCursor.historicalStatus).toBe('RUNNING');
      expect(keptCursor.historicalLastErrorCode).toBeNull();
    });

    it('conclusão grava a data de conclusão e a menor data coberta; COMPLETED prevalece sobre PAUSED', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 1, 60000);
      await service.pauseHistorical(accountId);
      const doneAt = T('2026-10-01T12:00:00.000Z');

      await service.commit(
        claimed.id,
        claimed.version,
        'worker-a',
        commitUpdate({
          historical: progress({
            coveredFrom: T('2026-01-01T00:00:00.000Z'),
            status: 'COMPLETED',
            completedAt: doneAt,
          }),
        }),
      );

      const after = (await service.findByAccountId(accountId))!;
      expect(after.historicalStatus).toBe('COMPLETED');
      expect(after.historicalCompletedAt).toEqual(doneAt);
      expect(after.historicalCoveredFrom).toEqual(
        T('2026-01-01T00:00:00.000Z'),
      );
    });

    it('pausa do histórico pedida durante o tick (lease ativo) NÃO é sobrescrita pelo commit, mas o progresso da janela é salvo', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      const [claimed] = await service.claim('worker-a', 1, 60000);

      const paused = await service.pauseHistorical(accountId);
      expect(paused!.historicalStatus).toBe('PAUSED');
      // Sem bump de version: o commit do tick em voo continua válido.
      expect(paused!.version).toBe(claimed.version);

      expect(
        await service.commit(
          claimed.id,
          claimed.version,
          'worker-a',
          commitUpdate({ historical: progress({ status: 'RUNNING' }) }),
        ),
      ).toBe(true);
      const after = (await service.findByAccountId(accountId))!;
      expect(after.historicalStatus).toBe('PAUSED');
      expect(after.historicalCoveredFrom).toEqual(
        T('2026-05-01T00:00:00.000Z'),
      );
    });

    it('pauseHistorical/resumeHistorical: só transições válidas, sem tocar no cursor nem no job incremental', async () => {
      const accountId = await newAccount();
      const created = await service.createIfAbsent(accountId, new Date());

      expect(await service.resumeHistorical(accountId)).toBeNull();
      const paused = await service.pauseHistorical(accountId);
      expect(paused!.historicalStatus).toBe('PAUSED');
      expect(paused!.status).toBe('RUNNING');
      expect(await service.pauseHistorical(accountId)).toBeNull();

      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs
            SET historical_status = 'FAILED', historical_last_error_code = 'SAFETY_LIMIT_REACHED'`,
      );
      const resumed = await service.resumeHistorical(accountId);
      expect(resumed!.historicalStatus).toBe('RUNNING');
      expect(resumed!.historicalLastErrorCode).toBeNull();
      expect(resumed!.historicalCoveredFrom).toEqual(
        created.historicalCoveredFrom,
      );
      expect(resumed!.windowCursorAt).toEqual(created.windowCursorAt);

      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET historical_status = 'COMPLETED'`,
      );
      // Concluído não é pausável nem retomável.
      expect(await service.pauseHistorical(accountId)).toBeNull();
      expect(await service.resumeHistorical(accountId)).toBeNull();
    });

    it('espera durável do histórico: o commit grava tentativas/próxima tentativa e um commit de sucesso as limpa; resumeHistorical também', async () => {
      const accountId = await newAccount();
      const created = await service.createIfAbsent(accountId, new Date());
      expect(created.historicalAttemptCount).toBe(0);
      expect(created.historicalNextAttemptAt).toBeNull();
      const commitOnce = async (
        historical: MarketplaceProblemsSyncJobCommitUpdate['historical'],
      ) => {
        await dataSource.query(
          `UPDATE marketplace_problems_sync_jobs SET next_attempt_at = now() - interval '1 second'`,
        );
        const [claimed] = await service.claim('worker-a', 1, 60000);
        await service.commit(
          claimed.id,
          claimed.version,
          'worker-a',
          commitUpdate({ historical }),
        );
        return (await service.findByAccountId(accountId))!;
      };
      const wait = T('2026-10-01T12:30:00.000Z');

      const waiting = await commitOnce(
        progress({
          coveredFrom: null,
          errorCode: 'CORE_COVERAGE_INCOMPLETE',
          attemptCount: 3,
          nextAttemptAt: wait,
        }),
      );
      expect(waiting.historicalAttemptCount).toBe(3);
      expect(waiting.historicalNextAttemptAt).toEqual(wait);
      expect(waiting.historicalCoveredFrom).toEqual(
        created.historicalCoveredFrom,
      );

      // Tick que não tocou no histórico (ex.: espera ativa) preserva a espera.
      const untouched = await commitOnce(null);
      expect(untouched.historicalAttemptCount).toBe(3);
      expect(untouched.historicalNextAttemptAt).toEqual(wait);

      const cleared = await commitOnce(progress({ coveredFrom: null }));
      expect(cleared.historicalAttemptCount).toBe(0);
      expect(cleared.historicalNextAttemptAt).toBeNull();

      await commitOnce(
        progress({
          coveredFrom: null,
          status: 'FAILED',
          attemptCount: 2,
          nextAttemptAt: wait,
        }),
      );
      const resumed = await service.resumeHistorical(accountId);
      expect(resumed!.historicalStatus).toBe('RUNNING');
      expect(resumed!.historicalAttemptCount).toBe(0);
      expect(resumed!.historicalNextAttemptAt).toBeNull();
    });

    it('REABERTURA: commit RUNNING sobre um histórico COMPLETED limpa a data de conclusão, atualiza o alvo e preserva o cursor', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs
            SET historical_status = 'COMPLETED',
                historical_completed_at = '2026-09-01T00:00:00Z',
                historical_covered_from = '2026-07-15T00:00:00Z',
                historical_target_from = '2026-07-15T00:00:00Z'`,
      );
      const [claimed] = await service.claim('worker-a', 1, 60000);

      await service.commit(
        claimed.id,
        claimed.version,
        'worker-a',
        commitUpdate({
          historical: progress({
            coveredFrom: null,
            targetFrom: T('2026-06-01T00:00:00.000Z'),
            status: 'RUNNING',
          }),
        }),
      );

      const after = (await service.findByAccountId(accountId))!;
      expect(after.historicalStatus).toBe('RUNNING');
      expect(after.historicalCompletedAt).toBeNull();
      expect(after.historicalTargetFrom).toEqual(T('2026-06-01T00:00:00.000Z'));
      expect(after.historicalCoveredFrom).toEqual(
        T('2026-07-15T00:00:00.000Z'),
      );
    });

    it('o resume do job incremental não reinicia o histórico', async () => {
      const accountId = await newAccount();
      const created = await service.createIfAbsent(accountId, new Date());
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs
            SET status = 'FAILED', historical_status = 'COMPLETED',
                historical_covered_from = '2026-01-01T00:00:00.000Z'`,
      );

      const resumed = await service.resume(accountId, new Date());

      expect(resumed!.status).toBe('RUNNING');
      expect(resumed!.historicalStatus).toBe('COMPLETED');
      expect(resumed!.historicalCoveredFrom).toEqual(
        T('2026-01-01T00:00:00.000Z'),
      );
      expect(resumed!.windowCursorAt).toEqual(created.windowCursorAt);
    });

    it('o banco rejeita status histórico fora do vocabulário', async () => {
      const accountId = await newAccount();
      await service.createIfAbsent(accountId, new Date());
      await expect(
        dataSource.query(
          `UPDATE marketplace_problems_sync_jobs SET historical_status = 'DONE'`,
        ),
      ).rejects.toThrow();
    });
  });
});
