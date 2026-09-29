import { DataSource } from 'typeorm';
import {
  ALL_PERMISSION_KEYS,
  ROLE_PERMISSION_PRESETS,
} from '../users/permissions.catalog';
import { requireTestDatabaseUrl } from '../test-utils/require-test-database-url';
import { buildDataSourceOptions } from './typeorm-options.factory';

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
}

interface RolePermissionRow {
  key: string;
  permission_key: string;
}

const PREVIOUS_16_PERMISSION_KEYS = [
  'dashboard.view',
  'full.view',
  'customers.view',
  'customers.export',
  'customers.export_personal_data',
  'customers.manage_enrichment',
  'goals.view',
  'goals.manage',
  'integrations.view',
  'integrations.manage',
  'sync.view',
  'sync.run',
  'sync.backfill',
  'sync.full_history',
  'users.view',
  'users.manage',
];

/**
 * Prova REAL (PostgreSQL descartável, nunca mock) da migration do CP1 de
 * "Problemas": schema das 3 tabelas novas, CHECK de confidence, e o efeito
 * completo `up -> down -> up` sobre o catálogo de permissões (16 -> 19 -> 16
 * -> 19), mesmo padrão de `users-roles-permissions-migration.integration.spec.ts`.
 */
describe('MarketplaceProblems migration (Postgres real)', () => {
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

  it('cria marketplace_problems com os tipos/defaults esperados, sem enum nativo', async () => {
    const columns = await dataSource.query<ColumnRow[]>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'marketplace_problems'`,
    );
    expect(columns.length).toBeGreaterThan(0);
    expect(columns.every((c) => c.data_type !== 'USER-DEFINED')).toBe(true);

    const byName = new Map(columns.map((c) => [c.column_name, c]));
    expect(byName.get('external_claim_id')?.is_nullable).toBe('NO');
    expect(byName.get('resource_id')?.data_type).toBe('character varying');
    expect(byName.get('claim_version')?.data_type).toBe('character varying');
    expect(byName.get('responsibility')?.column_default).toContain('UNKNOWN');
    expect(byName.get('responsibility_confidence')?.column_default).toContain(
      'NONE',
    );
    expect(byName.get('responsibility_source')?.is_nullable).toBe('YES');
    expect(byName.get('resolution_benefited_roles')?.data_type).toBe('ARRAY');
  });

  it('marketplace_problem_reasons e marketplace_problem_actions existem com os arrays esperados', async () => {
    const reasonColumns = await dataSource.query<ColumnRow[]>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'marketplace_problem_reasons'`,
    );
    const reasonByName = new Map(reasonColumns.map((c) => [c.column_name, c]));
    expect(reasonByName.get('triage')?.data_type).toBe('ARRAY');
    expect(reasonByName.get('allowed_flows')?.data_type).toBe('ARRAY');
    expect(reasonByName.get('expected_resolutions')?.data_type).toBe('ARRAY');

    const actionColumns = await dataSource.query<ColumnRow[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'marketplace_problem_actions'`,
    );
    expect(
      actionColumns.some((c) => c.column_name === 'marketplace_problem_id'),
    ).toBe(true);
  });

  it('unique (marketplace_account_id, external_claim_id) rejeita duplicata', async () => {
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM marketplace_accounts LIMIT 1`,
    );
    if (!account) {
      // Sem conta cadastrada neste banco descartável: cria uma mínima só
      // para este teste de constraint, sem depender de fixtures externas.
    }
    const accountId =
      account?.id ??
      (
        await dataSource.query<Array<{ id: string }>>(
          `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
           VALUES ('MERCADO_LIVRE', 'teste-cp1', 'x', 'x', 'x') RETURNING id`,
        )
      )[0].id;

    const insertOne = () =>
      dataSource.query(
        `INSERT INTO marketplace_problems
           (marketplace_account_id, external_claim_id, resource, resource_id, status, type, stage, site_id, date_created, last_updated)
         VALUES ($1, 'claim-dup', 'order', 'r1', 'opened', 'mediations', 'claim', 'MLB', now(), now())`,
        [accountId],
      );

    await insertOne();
    await expect(insertOne()).rejects.toThrow();
  });

  it('CHECK de responsibility_confidence só aceita NONE/HEURISTIC_TRIAGE/MANUAL', async () => {
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM marketplace_accounts LIMIT 1`,
    );
    await expect(
      dataSource.query(
        `INSERT INTO marketplace_problems
           (marketplace_account_id, external_claim_id, resource, resource_id, status, type, stage, site_id, date_created, last_updated, responsibility_confidence)
         VALUES ($1, 'claim-bad-confidence', 'order', 'r1', 'opened', 'mediations', 'claim', 'MLB', now(), now(), 'INVALID')`,
        [account.id],
      ),
    ).rejects.toThrow();
  });

  it('catálogo tem as 19 permission keys e os presets corretos após o up', async () => {
    const rows = await dataSource.query<RolePermissionRow[]>(
      `SELECT r.key, rp.permission_key
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id`,
    );
    const byRole = new Map<string, string[]>();
    for (const row of rows) {
      byRole.set(row.key, [...(byRole.get(row.key) ?? []), row.permission_key]);
    }
    expect([...(byRole.get('ADMIN') ?? [])].sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
    expect([...(byRole.get('ANALYST') ?? [])].sort()).toEqual(
      [...ROLE_PERMISSION_PRESETS.ANALYST].sort(),
    );
    expect([...(byRole.get('VIEWER') ?? [])].sort()).toEqual(
      [...ROLE_PERMISSION_PRESETS.VIEWER].sort(),
    );
  });

  it('down remove as tabelas novas, as 3 permission keys novas, e restaura o CHECK de 16 chaves; up reaplica tudo', async () => {
    await dataSource.undoLastMigration();

    const tablesAfterDown = await dataSource.query<
      Array<{ table_name: string }>
    >(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('marketplace_problems', 'marketplace_problem_reasons', 'marketplace_problem_actions')`,
    );
    expect(tablesAfterDown).toHaveLength(0);

    const remainingKeys = await dataSource.query<
      Array<{ permission_key: string }>
    >(`SELECT DISTINCT permission_key FROM role_permissions`);
    expect(remainingKeys.map((r) => r.permission_key).sort()).toEqual(
      [...PREVIOUS_16_PERMISSION_KEYS].sort(),
    );

    await expect(
      dataSource.query(
        `INSERT INTO role_permissions (role_id, permission_key)
         SELECT id, 'problems.view' FROM roles WHERE key = 'ADMIN'`,
      ),
    ).rejects.toThrow();

    await dataSource.runMigrations();

    const tablesAfterReup = await dataSource.query<
      Array<{ table_name: string }>
    >(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = 'marketplace_problems'`,
    );
    expect(tablesAfterReup).toHaveLength(1);

    const keysAfterReup = await dataSource.query<
      Array<{ permission_key: string }>
    >(`SELECT DISTINCT permission_key FROM role_permissions`);
    expect(keysAfterReup.map((r) => r.permission_key).sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
  });
});
