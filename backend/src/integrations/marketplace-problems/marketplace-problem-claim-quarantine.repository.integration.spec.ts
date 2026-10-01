import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import {
  MarketplaceProblemClaimQuarantineRepository,
  QUARANTINE_RETRY_BASE_MS,
  QUARANTINE_RETRY_MAX_MS,
} from './marketplace-problem-claim-quarantine.repository';

interface QuarantineRow {
  external_claim_id: string;
  failure_code: string;
  claim_date_created: Date | null;
  attempt_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  next_attempt_at: Date;
  resolved_at: Date | null;
}

describe('MarketplaceProblemClaimQuarantineRepository (Postgres real)', () => {
  let dataSource: DataSource;
  let repo: MarketplaceProblemClaimQuarantineRepository;

  beforeAll(async () => {
    dataSource = new DataSource(
      buildDataSourceOptions({
        databaseUrl: requireTestDatabaseUrl(),
        nodeEnv: 'test',
      }),
    );
    await dataSource.initialize();
    await dataSource.runMigrations();
    repo = new MarketplaceProblemClaimQuarantineRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM marketplace_problem_claim_quarantine`);
  });

  async function newAccount(): Promise<string> {
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`],
    );
    return row.id;
  }

  const rowsOf = (accountId: string) =>
    dataSource.query<QuarantineRow[]>(
      `SELECT external_claim_id, failure_code, claim_date_created, attempt_count,
              first_seen_at, last_seen_at, next_attempt_at, resolved_at
         FROM marketplace_problem_claim_quarantine
        WHERE marketplace_account_id = $1 ORDER BY external_claim_id`,
      [accountId],
    );

  const T0 = new Date('2026-09-01T12:00:00.000Z');

  it('CORE_FORBIDDEN cria UMA quarentena (1 tentativa, próxima tentativa com backoff base)', async () => {
    const account = await newAccount();

    await repo.record(account, 'claim-1', 'CORE_FORBIDDEN', T0);

    const rows = await rowsOf(account);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      external_claim_id: 'claim-1',
      failure_code: 'CORE_FORBIDDEN',
      attempt_count: 1,
      resolved_at: null,
    });
    expect(rows[0].first_seen_at).toEqual(T0);
    expect(rows[0].last_seen_at).toEqual(T0);
    expect(rows[0].next_attempt_at).toEqual(
      new Date(T0.getTime() + QUARANTINE_RETRY_BASE_MS),
    );
  });

  it('reprocessamento incrementa tentativas SEM duplicar, preserva a primeira ocorrência e dobra o backoff até o teto', async () => {
    const account = await newAccount();
    await repo.record(account, 'claim-1', 'CORE_FORBIDDEN', T0);

    const T1 = new Date(T0.getTime() + 3_600_000);
    await repo.record(account, 'claim-1', 'CORE_FORBIDDEN', T1);

    let rows = await rowsOf(account);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempt_count).toBe(2);
    expect(rows[0].first_seen_at).toEqual(T0);
    expect(rows[0].last_seen_at).toEqual(T1);
    expect(rows[0].next_attempt_at).toEqual(
      new Date(T1.getTime() + QUARANTINE_RETRY_BASE_MS * 2),
    );

    for (let i = 0; i < 12; i += 1) {
      await repo.record(account, 'claim-1', 'CORE_FORBIDDEN', T1);
    }
    rows = await rowsOf(account);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempt_count).toBe(14);
    expect(rows[0].next_attempt_at).toEqual(
      new Date(T1.getTime() + QUARANTINE_RETRY_MAX_MS),
    );
  });

  it('guarda a data de criação do claim vinda da busca; uma ocorrência sem data nunca a apaga', async () => {
    const account = await newAccount();
    const created = new Date('2026-06-30T23:30:00-03:00');

    await repo.record(account, 'c1', 'CORE_FORBIDDEN', T0, created);
    await repo.record(account, 'c1', 'CORE_FORBIDDEN', T0);

    const rows = await rowsOf(account);
    expect(rows).toHaveLength(1);
    expect(rows[0].claim_date_created).toEqual(created);
    expect(rows[0].attempt_count).toBe(2);

    // Linha legada (sem data) recebe a data quando ela passa a ser conhecida.
    await repo.record(account, 'legado', 'CORE_FORBIDDEN', T0);
    expect((await rowsOf(account))[1].claim_date_created).toBeNull();
    await repo.record(account, 'legado', 'CORE_FORBIDDEN', T0, created);
    expect((await rowsOf(account))[1].claim_date_created).toEqual(created);
  });

  it('CORE_NOT_FOUND é registrado como CORE_FORBIDDEN: único, com backoff, sem duplicar', async () => {
    const account = await newAccount();

    await repo.record(account, 'c404', 'CORE_NOT_FOUND', T0, T0);
    await repo.record(account, 'c404', 'CORE_NOT_FOUND', T0, T0);

    const rows = await rowsOf(account);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      failure_code: 'CORE_NOT_FOUND',
      attempt_count: 2,
    });
    expect(rows[0].next_attempt_at).toEqual(
      new Date(T0.getTime() + QUARANTINE_RETRY_BASE_MS * 2),
    );
  });

  it('deferPending dá espera durável SÓ a pendência existente (incrementa e adia); resolvida/inexistente é no-op', async () => {
    const account = await newAccount();
    await repo.record(account, 'p', 'CORE_FORBIDDEN', T0, T0);
    await repo.record(account, 'r', 'CORE_FORBIDDEN', T0, T0);
    await repo.resolve(account, 'r', T0);
    const T1 = new Date(T0.getTime() + 5000);

    await repo.deferPending(account, 'p', T1);
    await repo.deferPending(account, 'r', T1);
    await repo.deferPending(account, 'nao-existe', T1);

    const [p, r] = await rowsOf(account);
    expect(p.attempt_count).toBe(2);
    expect(p.next_attempt_at).toEqual(
      new Date(T1.getTime() + QUARANTINE_RETRY_BASE_MS * 2),
    );
    expect(p.failure_code).toBe('CORE_FORBIDDEN');
    expect(r.attempt_count).toBe(1);
    expect(r.resolved_at).not.toBeNull();
    expect(await rowsOf(account)).toHaveLength(2);
  });

  it('pendingSummaryByAccount: pendentes por mês (America/Sao_Paulo), sem data e total; resolvidas ficam fora', async () => {
    const a = await newAccount();
    const b = await newAccount();
    const empty = await newAccount();
    // 30/06 23:30 em SP já é 01/07 em UTC: pertence a JUNHO.
    await repo.record(
      a,
      'jun',
      'CORE_FORBIDDEN',
      T0,
      new Date('2026-07-01T02:30:00Z'),
    );
    await repo.record(
      a,
      'jul-1',
      'CORE_NOT_FOUND',
      T0,
      new Date('2026-07-01T03:30:00Z'),
    );
    await repo.record(
      a,
      'jul-2',
      'CORE_FORBIDDEN',
      T0,
      new Date('2026-07-20T12:00:00Z'),
    );
    await repo.record(a, 'legado', 'CORE_FORBIDDEN', T0);
    await repo.record(
      a,
      'resolvida',
      'CORE_FORBIDDEN',
      T0,
      new Date('2026-08-10T12:00:00Z'),
    );
    await repo.resolve(a, 'resolvida', T0);
    await repo.record(
      b,
      'b-ago',
      'CORE_FORBIDDEN',
      T0,
      new Date('2026-08-05T12:00:00Z'),
    );

    const summary = await repo.pendingSummaryByAccount([a, b, empty]);

    expect(summary.get(a)).toEqual({
      total: 4,
      unknownDate: 1,
      byMonth: new Map([
        ['2026-06', 1],
        ['2026-07', 2],
      ]),
    });
    expect(summary.get(b)).toEqual({
      total: 1,
      unknownDate: 0,
      byMonth: new Map([['2026-08', 1]]),
    });
    expect(summary.has(empty)).toBe(false);
    expect((await repo.pendingSummaryByAccount([])).size).toBe(0);
  });

  it('é única por conta + claim: o mesmo claim em outra conta é outra quarentena', async () => {
    const a = await newAccount();
    const b = await newAccount();

    await repo.record(a, 'claim-1', 'CORE_FORBIDDEN', T0);
    await repo.record(b, 'claim-1', 'CORE_FORBIDDEN', T0);

    expect(await rowsOf(a)).toHaveLength(1);
    expect(await rowsOf(b)).toHaveLength(1);
  });

  it('resolve marca resolved_at uma única vez; nova ocorrência reabre', async () => {
    const account = await newAccount();
    await repo.record(account, 'claim-1', 'CORE_FORBIDDEN', T0);

    const T1 = new Date(T0.getTime() + 1000);
    expect(await repo.resolve(account, 'claim-1', T1)).toBe(true);
    expect(await repo.resolve(account, 'claim-1', T1)).toBe(false);
    expect(await repo.resolve(account, 'sem-quarentena', T1)).toBe(false);
    expect((await rowsOf(account))[0].resolved_at).toEqual(T1);

    await repo.record(account, 'claim-1', 'CORE_FORBIDDEN', T1);
    const reopened = await rowsOf(account);
    expect(reopened).toHaveLength(1);
    expect(reopened[0].resolved_at).toBeNull();
    expect(reopened[0].attempt_count).toBe(2);
  });

  it('findDue devolve só pendentes vencidos, mais antigos primeiro, respeitando o limite', async () => {
    const account = await newAccount();
    await repo.record(account, 'a', 'CORE_FORBIDDEN', T0);
    await repo.record(
      account,
      'b',
      'CORE_FORBIDDEN',
      new Date(T0.getTime() + 1),
    );
    await repo.record(
      account,
      'c',
      'CORE_FORBIDDEN',
      new Date(T0.getTime() + 2),
    );
    await repo.resolve(account, 'a', T0);
    const due = new Date(T0.getTime() + QUARANTINE_RETRY_BASE_MS + 10);

    const ids = async (limit: number, at: Date) =>
      (await repo.findDue(account, limit, at)).map((c) => c.externalClaimId);
    expect(await ids(10, due)).toEqual(['b', 'c']);
    expect(await ids(1, due)).toEqual(['b']);
    expect(await ids(10, T0)).toEqual([]);
    expect(await ids(0, due)).toEqual([]);
  });

  it('countPendingByAccount conta só pendentes, por conta', async () => {
    const a = await newAccount();
    const b = await newAccount();
    const c = await newAccount();
    await repo.record(a, 'x', 'CORE_FORBIDDEN', T0);
    await repo.record(a, 'y', 'CORE_FORBIDDEN', T0);
    await repo.record(b, 'x', 'CORE_FORBIDDEN', T0);
    await repo.resolve(b, 'x', T0);

    const counts = await repo.countPendingByAccount([a, b, c]);

    expect(counts.get(a)).toBe(2);
    expect(counts.has(b)).toBe(false);
    expect(counts.has(c)).toBe(false);
    expect((await repo.countPendingByAccount([])).size).toBe(0);
  });

  it('o banco só aceita código sanitizado (nunca URL, mensagem ou texto livre)', async () => {
    const account = await newAccount();
    const insert = (code: string) =>
      dataSource.query(
        `INSERT INTO marketplace_problem_claim_quarantine
           (marketplace_account_id, external_claim_id, failure_code,
            first_seen_at, last_seen_at, next_attempt_at)
         VALUES ($1, $2, $3, now(), now(), now())`,
        [account, `claim-${randomUUID()}`, code],
      );

    await expect(
      insert('https://api.mercadolibre.com/claims/1'),
    ).rejects.toThrow();
    await expect(insert('Bearer abc.def')).rejects.toThrow();
    await expect(insert('forbidden for user 123')).rejects.toThrow();
    await expect(insert('core_forbidden')).rejects.toThrow();
    await expect(insert('CORE_FORBIDDEN')).resolves.toBeDefined();
  });

  it('a tabela não possui coluna para URL, token, payload ou mensagem', async () => {
    const columns = await dataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'marketplace_problem_claim_quarantine'
        ORDER BY column_name`,
    );

    expect(columns.map((c) => c.column_name)).toEqual([
      'attempt_count',
      'claim_date_created',
      'created_at',
      'external_claim_id',
      'failure_code',
      'first_seen_at',
      'id',
      'last_seen_at',
      'marketplace_account_id',
      'next_attempt_at',
      'resolved_at',
      'updated_at',
    ]);
  });
});
