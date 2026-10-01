import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../test-utils/require-test-database-url';
import { buildDataSourceOptions } from './typeorm-options.factory';

const TABLE = 'marketplace_problems_sync_jobs';

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

/**
 * Prova REAL (PostgreSQL descartável) da migration do CP2-C de "Problemas":
 * schema da tabela de jobs (uma linha por conta), FK com CASCADE, CHECK de
 * status sem `COMPLETED` (sincronização incremental é perene), ausência de
 * `refresh_cursor_problem_id` e o efeito `up -> down -> up`.
 */
describe('MarketplaceProblemsSyncJobs migration (Postgres real)', () => {
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

  async function tableExists(): Promise<boolean> {
    const rows = await dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [TABLE],
    );
    return rows[0].exists;
  }

  async function insertAccount(): Promise<string> {
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`teste-cp2c-migration-${randomUUID()}`],
    );
    return account.id;
  }

  it('cria a tabela com as colunas de estado, cursor, contadores, retry, pausa, lease e version', async () => {
    const columns = await dataSource.query<ColumnRow[]>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = $1`,
      [TABLE],
    );
    const byName = new Map(columns.map((c) => [c.column_name, c]));
    for (const name of [
      'id',
      'marketplace_account_id',
      'status',
      'window_cursor_at',
      'claims_processed_count',
      'claims_persisted_count',
      'claims_failed_count',
      'calls_made_count',
      'attempt_count',
      'next_attempt_at',
      'last_error_code',
      'pause_requested',
      'lease_owner',
      'lease_expires_at',
      'version',
      'last_activity_at',
      'last_census_at',
      'created_at',
      'updated_at',
    ]) {
      expect(byName.has(name)).toBe(true);
    }
    expect(byName.get('window_cursor_at')?.is_nullable).toBe('NO');
    expect(byName.get('window_cursor_at')?.data_type).toBe(
      'timestamp with time zone',
    );
    expect(byName.get('last_error_code')?.is_nullable).toBe('YES');
  });

  it('nunca cria refresh_cursor_problem_id (refresh segue a fila por last_checked_at)', async () => {
    const rows = await dataSource.query<ColumnRow[]>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = $1 AND column_name = 'refresh_cursor_problem_id'`,
      [TABLE],
    );
    expect(rows).toHaveLength(0);
  });

  it('uma linha por conta: UNIQUE em marketplace_account_id', async () => {
    const accountId = await insertAccount();
    await dataSource.query(
      `INSERT INTO ${TABLE} (marketplace_account_id, window_cursor_at, historical_covered_from) VALUES ($1, now(), now())`,
      [accountId],
    );
    await expect(
      dataSource.query(
        `INSERT INTO ${TABLE} (marketplace_account_id, window_cursor_at, historical_covered_from) VALUES ($1, now(), now())`,
        [accountId],
      ),
    ).rejects.toThrow();
  });

  it('CHECK de status aceita os 5 estados e rejeita COMPLETED', async () => {
    for (const status of [
      'RUNNING',
      'PAUSED',
      'WAITING_RETRY',
      'FAILED',
      'FAILED_AUTH',
    ]) {
      const accountId = await insertAccount();
      await dataSource.query(
        `INSERT INTO ${TABLE} (marketplace_account_id, status, window_cursor_at, historical_covered_from) VALUES ($1, $2, now(), now())`,
        [accountId, status],
      );
    }
    const accountId = await insertAccount();
    await expect(
      dataSource.query(
        `INSERT INTO ${TABLE} (marketplace_account_id, status, window_cursor_at, historical_covered_from) VALUES ($1, 'COMPLETED', now(), now())`,
        [accountId],
      ),
    ).rejects.toThrow();
  });

  it('FK ON DELETE CASCADE remove o job junto com a conta', async () => {
    const accountId = await insertAccount();
    await dataSource.query(
      `INSERT INTO ${TABLE} (marketplace_account_id, window_cursor_at, historical_covered_from) VALUES ($1, now(), now())`,
      [accountId],
    );
    await dataSource.query(`DELETE FROM marketplace_accounts WHERE id = $1`, [
      accountId,
    ]);
    const rows = await dataSource.query<unknown[]>(
      `SELECT 1 FROM ${TABLE} WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(rows).toHaveLength(0);
  });

  it('down remove a tabela sem afetar marketplace_problems; up reaplica', async () => {
    expect(await tableExists()).toBe(true);
    // `undoLastMigration()` só desfaz a mais RECENTE; migrations posteriores
    // (ex.: quarentena/backfill, CP4) empilham por cima — desfaz até a tabela sumir.
    for (let attempt = 0; attempt < 20 && (await tableExists()); attempt++) {
      await dataSource.undoLastMigration();
    }
    expect(await tableExists()).toBe(false);
    const problems = await dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_problems') AS exists`,
    );
    expect(problems[0].exists).toBe(true);

    await dataSource.runMigrations();
    expect(await tableExists()).toBe(true);
  });
});
