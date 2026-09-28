import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import {
  ALL_PERMISSION_KEYS,
  ROLE_PERMISSION_PRESETS,
} from '../users/permissions.catalog';
import { requireTestDatabaseUrl } from '../test-utils/require-test-database-url';
import { buildDataSourceOptions } from './typeorm-options.factory';

interface RoleRow {
  id: string;
  key: string;
  name: string;
  is_system: boolean;
}

interface RolePermissionRow {
  permission_key: string;
}

interface UserRow {
  id: string;
  role_id: string | null;
  account_scope_mode: string;
  is_admin: boolean;
  active: boolean;
}

/**
 * Prova REAL (PostgreSQL descartável, nunca mock) da migration de Checkpoint
 * 1 de Usuários/Papéis/Permissões: roda a cadeia INTEIRA de migrations do
 * zero (prova que a nova migration é compatível com as anteriores), depois
 * isola só a migration nova (`undoLastMigration` + reaplica) para testar o
 * backfill de `is_admin` contra usuários reais inseridos entre os dois
 * passos — e finalmente prova `up -> down -> up`.
 */
describe('UsersRolesPermissions migration (Postgres real)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(
      buildDataSourceOptions({
        databaseUrl: requireTestDatabaseUrl(),
        nodeEnv: 'test',
      }),
    );
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('roda a cadeia inteira de migrations (incluindo as anteriores) sem erro, idempotente se já aplicada', async () => {
    // Nunca assume banco vazio: `runMigrations()` deve ser seguro tanto num
    // Postgres descartável do zero (aplica tudo) quanto já na "head" (nenhum
    // pendente) — nos dois casos, sem erro e com o schema desta migration
    // presente ao final.
    await dataSource.runMigrations();
    const rolesTableExists = await dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'roles') AS exists`,
    );
    expect(rolesTableExists[0].exists).toBe(true);
  });

  it('cria exatamente os 3 papéis ADMIN, ANALYST e VIEWER', async () => {
    const roles = await dataSource.query<RoleRow[]>(
      'SELECT id, key, name, is_system FROM roles ORDER BY key',
    );
    expect(roles.map((role) => role.key)).toEqual([
      'ADMIN',
      'ANALYST',
      'VIEWER',
    ]);
    expect(roles.every((role) => role.is_system)).toBe(true);
  });

  it('ADMIN recebe todas as permissões do catálogo canônico', async () => {
    const rows = await dataSource.query<RolePermissionRow[]>(
      `SELECT rp.permission_key FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id WHERE r.key = 'ADMIN'`,
    );
    const dbKeys = rows.map((row) => row.permission_key).sort();
    expect(dbKeys).toEqual([...ALL_PERMISSION_KEYS].sort());
  });

  it('ANALYST e VIEWER recebem exatamente os presets do catálogo (alinhamento código <-> migration)', async () => {
    for (const roleKey of ['ANALYST', 'VIEWER'] as const) {
      const rows = await dataSource.query<RolePermissionRow[]>(
        `SELECT rp.permission_key FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id WHERE r.key = $1`,
        [roleKey],
      );
      const dbKeys = rows.map((row) => row.permission_key).sort();
      expect(dbKeys).toEqual([...ROLE_PERMISSION_PRESETS[roleKey]].sort());
    }
  });

  describe('backfill de usuários preexistentes (is_admin -> role_id/account_scope_mode)', () => {
    let adminUserId: string;
    let commonUserId: string;

    beforeAll(async () => {
      // Isola só a migration nova: reverte (schema volta a ter só is_admin),
      // insere usuários "preexistentes" direto na tabela `users` (que já
      // existia antes desta migration), depois reaplica — reproduzindo
      // exatamente o cenário de um banco em produção sendo migrado.
      await dataSource.undoLastMigration();

      adminUserId = randomUUID();
      commonUserId = randomUUID();
      // E-mails únicos por execução: este describe roda `undoLastMigration`
      // (que nunca apaga linhas de `users`, só reverte colunas/tabelas), e o
      // banco descartável pode ser reaproveitado por execuções repetidas do
      // Jest na mesma sessão — um e-mail fixo colidiria com `UQ_users_email`
      // na segunda vez.
      await dataSource.query(
        `INSERT INTO users (id, name, email, password_hash, active, is_admin)
         VALUES ($1, 'Admin Existente', $2, 'hash', true, true)`,
        [adminUserId, `admin-existente-${adminUserId}@example.com`],
      );
      await dataSource.query(
        `INSERT INTO users (id, name, email, password_hash, active, is_admin)
         VALUES ($1, 'Usuário Comum', $2, 'hash', true, false)`,
        [commonUserId, `comum-${commonUserId}@example.com`],
      );

      await dataSource.runMigrations();
    });

    afterAll(async () => {
      // Nunca deixa um admin sintético órfão no banco descartável — outras
      // suítes (ex.: `last-admin-guard.spec.ts`) reaproveitam o MESMO banco
      // na mesma sessão e contam admins ativos de verdade.
      await dataSource.query('DELETE FROM users WHERE id = ANY($1)', [
        [adminUserId, commonUserId],
      ]);
    });

    async function loadUser(id: string): Promise<UserRow> {
      const rows = await dataSource.query<UserRow[]>(
        'SELECT id, role_id, account_scope_mode, is_admin, active FROM users WHERE id = $1',
        [id],
      );
      return rows[0];
    }

    it('usuário preexistente com is_admin=true vira ADMIN e permanece ativo', async () => {
      const user = await loadUser(adminUserId);
      expect(user.active).toBe(true);
      expect(user.role_id).not.toBeNull();

      const role = await dataSource.query<RoleRow[]>(
        'SELECT key FROM roles WHERE id = $1',
        [user.role_id],
      );
      expect(role[0].key).toBe('ADMIN');
    });

    it('admin migrado recebe account_scope_mode = ALL', async () => {
      const user = await loadUser(adminUserId);
      expect(user.account_scope_mode).toBe('ALL');
    });

    it('usuário preexistente com is_admin=false vira VIEWER', async () => {
      const user = await loadUser(commonUserId);
      const role = await dataSource.query<RoleRow[]>(
        'SELECT key FROM roles WHERE id = $1',
        [user.role_id],
      );
      expect(role[0].key).toBe('VIEWER');
    });

    it('usuário comum migrado também recebe account_scope_mode = ALL (preserva visão que já tinha)', async () => {
      const user = await loadUser(commonUserId);
      expect(user.account_scope_mode).toBe('ALL');
    });
  });

  it('up -> down -> up: down preserva a tabela users e os usuários originais, up final restaura o schema', async () => {
    const beforeDown = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM users',
    );

    await dataSource.undoLastMigration();

    const rolesTableExists = await dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'roles') AS exists`,
    );
    expect(rolesTableExists[0].exists).toBe(false);

    const afterDown = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM users',
    );
    expect(afterDown[0].count).toBe(beforeDown[0].count);

    await dataSource.runMigrations();

    const rolesAfterReUp = await dataSource.query<RoleRow[]>(
      'SELECT key FROM roles ORDER BY key',
    );
    expect(rolesAfterReUp.map((role) => role.key)).toEqual([
      'ADMIN',
      'ANALYST',
      'VIEWER',
    ]);

    const afterReUp = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM users',
    );
    expect(afterReUp[0].count).toBe(beforeDown[0].count);
  });
});
