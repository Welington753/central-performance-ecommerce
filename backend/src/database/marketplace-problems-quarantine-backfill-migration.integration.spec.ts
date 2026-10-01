import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../test-utils/require-test-database-url';
import { buildDataSourceOptions } from './typeorm-options.factory';

const QUARANTINE = 'marketplace_problem_claim_quarantine';
const JOBS = 'marketplace_problems_sync_jobs';
const HISTORICAL_COLUMNS = [
  'historical_attempt_count',
  'historical_completed_at',
  'historical_covered_from',
  'historical_last_error_code',
  'historical_next_attempt_at',
  'historical_status',
  'historical_target_from',
];

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
}

/**
 * Prova REAL (PostgreSQL descartável) da migration do CP4: tabela de
 * quarentena de claims inacessíveis + colunas `historical_*` do job.
 * `up -> down -> up`, preservando dados existentes e reconstituindo o início
 * da cobertura dos jobs já criados.
 */
describe('MarketplaceProblemsQuarantineBackfill migration (Postgres real)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(
      buildDataSourceOptions({
        databaseUrl: requireTestDatabaseUrl(),
        nodeEnv: 'test',
      }),
    );
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  const tableExists = async (table: string): Promise<boolean> => {
    const [row] = await dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [table],
    );
    return row.exists;
  };

  const columns = (table: string) =>
    dataSource.query<ColumnRow[]>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns WHERE table_name = $1
        ORDER BY column_name`,
      [table],
    );

  const newAccount = async (): Promise<string> => {
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`teste-cp4-migration-${randomUUID()}`],
    );
    return row.id;
  };

  it('cria a tabela de quarentena SEM colunas para URL, token, payload ou mensagem', async () => {
    const cols = await columns(QUARANTINE);

    expect(cols.map((c) => c.column_name)).toEqual([
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
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(byName.resolved_at.is_nullable).toBe('YES');
    // A data vem da busca; linha legada/sem data continua válida.
    expect(byName.claim_date_created.is_nullable).toBe('YES');
    expect(byName.claim_date_created.data_type).toBe(
      'timestamp with time zone',
    );
    expect(byName.resolved_at.data_type).toBe('timestamp with time zone');
    expect(byName.failure_code.is_nullable).toBe('NO');
    expect(byName.attempt_count.column_default).toBe('1');
  });

  it('garante unicidade por conta + claim, índice parcial dos pendentes e FK com cascade', async () => {
    const accountId = await newAccount();
    const insert = (claim: string, code = 'CORE_FORBIDDEN') =>
      dataSource.query(
        `INSERT INTO ${QUARANTINE}
           (marketplace_account_id, external_claim_id, failure_code, first_seen_at, last_seen_at, next_attempt_at)
         VALUES ($1, $2, $3, now(), now(), now())`,
        [accountId, claim, code],
      );

    await insert('c1');
    await expect(insert('c1')).rejects.toThrow();
    await expect(insert('c2', 'texto livre com espaços')).rejects.toThrow();

    const [index] = await dataSource.query<Array<{ indexdef: string }>>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = $1 AND indexname = 'IDX_marketplace_problem_claim_quarantine_pending'`,
      [QUARANTINE],
    );
    const def = index.indexdef.toLowerCase();
    expect(def).toContain('marketplace_account_id');
    expect(def).toContain('next_attempt_at');
    expect(def).toContain('resolved_at is null');

    await dataSource.query(`DELETE FROM marketplace_accounts WHERE id = $1`, [
      accountId,
    ]);
    const rows = await dataSource.query<unknown[]>(
      `SELECT 1 FROM ${QUARANTINE} WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(rows).toHaveLength(0);
  });

  it('adiciona as colunas historical_* ao job com defaults seguros e CHECK de status', async () => {
    const cols = (await columns(JOBS)).filter((c) =>
      c.column_name.startsWith('historical_'),
    );

    expect(cols.map((c) => c.column_name)).toEqual(HISTORICAL_COLUMNS);
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(byName.historical_status.is_nullable).toBe('NO');
    expect(byName.historical_status.column_default).toContain('RUNNING');
    expect(byName.historical_covered_from.is_nullable).toBe('NO');
    expect(byName.historical_target_from.is_nullable).toBe('YES');
    expect(byName.historical_completed_at.is_nullable).toBe('YES');
    expect(byName.historical_last_error_code.is_nullable).toBe('YES');
    // Espera durável do histórico: sem espera por padrão.
    expect(byName.historical_attempt_count.is_nullable).toBe('NO');
    expect(byName.historical_attempt_count.column_default).toBe('0');
    expect(byName.historical_next_attempt_at.is_nullable).toBe('YES');

    const accountId = await newAccount();
    await dataSource.query(
      `INSERT INTO ${JOBS} (marketplace_account_id, window_cursor_at, historical_covered_from)
       VALUES ($1, now(), now())`,
      [accountId],
    );
    await expect(
      dataSource.query(`UPDATE ${JOBS} SET historical_status = 'DONE'`),
    ).rejects.toThrow();
    await dataSource.query(`DELETE FROM marketplace_accounts WHERE id = $1`, [
      accountId,
    ]);
  });

  it('down remove tabela e colunas sem afetar dados existentes; up reconstitui o início da cobertura dos jobs já criados', async () => {
    expect(await tableExists(QUARANTINE)).toBe(true);
    // `undoLastMigration()` só desfaz a mais RECENTE — desfaz até a quarentena sumir.
    for (let i = 0; i < 20 && (await tableExists(QUARANTINE)); i++) {
      await dataSource.undoLastMigration();
    }
    expect(await tableExists(QUARANTINE)).toBe(false);
    const afterDown = (await columns(JOBS)).filter((c) =>
      c.column_name.startsWith('historical_'),
    );
    expect(afterDown).toEqual([]);

    // Job criado ANTES da migration (cursor inicial = created_at - 60 dias).
    const accountId = await newAccount();
    await dataSource.query(
      `INSERT INTO ${JOBS} (marketplace_account_id, window_cursor_at, created_at)
       VALUES ($1, '2026-09-20T10:00:00Z', '2026-09-30T12:00:00Z')`,
      [accountId],
    );
    // Cursor atual ANTERIOR ao início presumido: nunca declara cobertura além dele.
    const otherAccount = await newAccount();
    await dataSource.query(
      `INSERT INTO ${JOBS} (marketplace_account_id, window_cursor_at, created_at)
       VALUES ($1, '2026-07-01T00:00:00Z', '2026-09-30T12:00:00Z')`,
      [otherAccount],
    );

    await dataSource.runMigrations();

    const [job] = await dataSource.query<
      Array<{
        window_cursor_at: Date;
        historical_covered_from: Date;
        historical_status: string;
        historical_target_from: Date | null;
        historical_completed_at: Date | null;
      }>
    >(
      `SELECT window_cursor_at, historical_covered_from, historical_status,
              historical_target_from, historical_completed_at
         FROM ${JOBS} WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(job.window_cursor_at).toEqual(new Date('2026-09-20T10:00:00Z'));
    expect(job.historical_covered_from).toEqual(
      new Date('2026-08-01T12:00:00Z'),
    );
    expect(job.historical_status).toBe('RUNNING');
    expect(job.historical_target_from).toBeNull();
    expect(job.historical_completed_at).toBeNull();

    const [clamped] = await dataSource.query<
      Array<{ historical_covered_from: Date }>
    >(
      `SELECT historical_covered_from FROM ${JOBS} WHERE marketplace_account_id = $1`,
      [otherAccount],
    );
    expect(clamped.historical_covered_from).toEqual(
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(await tableExists(QUARANTINE)).toBe(true);

    await dataSource.query(
      `DELETE FROM marketplace_accounts WHERE id = ANY($1)`,
      [[accountId, otherAccount]],
    );
  });
});
