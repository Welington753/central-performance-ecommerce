import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../test-utils/require-test-database-url';
import { buildDataSourceOptions } from './typeorm-options.factory';

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
}

interface IndexDefRow {
  indexdef: string;
}

/**
 * Prova REAL (PostgreSQL descartável) da migration do CP2-A: adiciona
 * `last_checked_at` e o índice da fila de refresh, `up -> down -> up`, sem
 * tocar nenhum dado existente de `marketplace_problems`.
 */
describe('MarketplaceProblemsRefreshCursor migration (Postgres real)', () => {
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

  it('adiciona last_checked_at como TIMESTAMPTZ nullable', async () => {
    const columns = await dataSource.query<ColumnRow[]>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_name = 'marketplace_problems' AND column_name = 'last_checked_at'`,
    );
    expect(columns).toHaveLength(1);
    expect(columns[0].data_type).toBe('timestamp with time zone');
    expect(columns[0].is_nullable).toBe('YES');
  });

  it('cria o índice da fila de refresh cobrindo account_id, last_checked_at (NULLS FIRST) e id, parcial por resolution_date IS NULL', async () => {
    const rows = await dataSource.query<IndexDefRow[]>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'marketplace_problems'
          AND indexname = 'IX_marketplace_problems_refresh_queue'`,
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef.toLowerCase();
    expect(def).toContain('marketplace_account_id');
    expect(def).toContain('last_checked_at');
    expect(def).toContain('nulls first');
    expect(def).toContain(' id');
    expect(def).toContain('resolution_date is null');
  });

  it('down remove coluna e índice sem afetar outras colunas; up reaplica', async () => {
    // Prova que uma linha pré-existente (de um teste anterior neste mesmo
    // banco descartável, ou inserida aqui) sobrevive intacta ao down/up.
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`teste-cp2a-migration-${randomUUID()}`],
    );
    await dataSource.query(
      `INSERT INTO marketplace_problems
         (marketplace_account_id, external_claim_id, resource, resource_id, status, type, stage, site_id, date_created, last_updated)
       VALUES ($1, 'claim-migration-survives', 'order', 'r1', 'opened', 'mediations', 'claim', 'MLB', now(), now())`,
      [account.id],
    );

    await dataSource.undoLastMigration();

    const columnsAfterDown = await dataSource.query<ColumnRow[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'marketplace_problems' AND column_name = 'last_checked_at'`,
    );
    expect(columnsAfterDown).toHaveLength(0);

    const indexAfterDown = await dataSource.query<IndexDefRow[]>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'marketplace_problems'
          AND indexname = 'IX_marketplace_problems_refresh_queue'`,
    );
    expect(indexAfterDown).toHaveLength(0);

    const survivingRow = await dataSource.query<
      Array<{ external_claim_id: string }>
    >(
      `SELECT external_claim_id FROM marketplace_problems WHERE marketplace_account_id = $1`,
      [account.id],
    );
    expect(survivingRow).toHaveLength(1);
    expect(survivingRow[0].external_claim_id).toBe('claim-migration-survives');

    await dataSource.runMigrations();

    const columnsAfterReup = await dataSource.query<ColumnRow[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'marketplace_problems' AND column_name = 'last_checked_at'`,
    );
    expect(columnsAfterReup).toHaveLength(1);
  });
});
