import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Marketplace } from '../integrations/contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../integrations/marketplace-accounts/marketplace-account.entity';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { AccountScopeMode } from './account-scope-mode.enum';
import { PERMISSIONS, type PermissionKey } from './permissions.catalog';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { User } from './user.entity';
import { UserAccountScope } from './user-account-scope.entity';
import { UserAuditAction } from './user-audit-action.enum';
import { UserAuditLog } from './user-audit-log.entity';
import { UserPermissionOverride } from './user-permission-override.entity';

/**
 * Assume que a cadeia inteira de migrations (incluindo
 * `1790594851607-users-roles-permissions.ts`) já foi aplicada no Postgres
 * descartável de `TEST_DATABASE_URL` — mesmo padrão de todo outro teste de
 * integração real deste projeto (ver `backfill-jobs-persistence.service.
 * integration.spec.ts`).
 */
describe('Schema de Usuários/Papéis/Permissões — entidades e constraints (Postgres real)', () => {
  let dataSource: DataSource;
  let viewerRoleId: string;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      Role,
      RolePermission,
      User,
      UserPermissionOverride,
      UserAccountScope,
      UserAuditLog,
      MarketplaceAccount,
    ]);
    const viewerRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ key: 'VIEWER' });
    viewerRoleId = viewerRole.id;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE user_audit_logs CASCADE');
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@schema-spec.example.com'",
    );
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '1',
      nickname: 'Conta de teste',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;
  });

  async function createUser(overrides: Partial<User> = {}): Promise<User> {
    return dataSource.getRepository(User).save({
      id: randomUUID(),
      name: 'Usuário de Teste',
      email: `${randomUUID()}@schema-spec.example.com`,
      passwordHash: 'hash',
      active: true,
      // role_id é NOT NULL desde o Checkpoint 3 — default sensato para
      // quem não está testando o papel em si.
      roleId: viewerRoleId,
      ...overrides,
    });
  }

  it('entidade User reflete exatamente as colunas novas do schema (role_id, account_scope_mode, must_change_password, password_changed_at)', async () => {
    const created = await createUser({ roleId: viewerRoleId });
    const reloaded = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: created.id });

    expect(reloaded.roleId).toBe(viewerRoleId);
    expect(reloaded.accountScopeMode).toBe(AccountScopeMode.NONE);
    expect(reloaded.mustChangePassword).toBe(false);
    expect(reloaded.passwordChangedAt).toBeNull();
  });

  it('novo usuário, pelo default do schema, nasce account_scope_mode = NONE — nunca ALL por acidente', async () => {
    const user = await createUser();
    expect(user.accountScopeMode).toBe(AccountScopeMode.NONE);
  });

  it('SELECTED sem nenhuma linha em user_account_scope nunca equivale a ALL', async () => {
    const user = await createUser({
      accountScopeMode: AccountScopeMode.SELECTED,
    });
    const scopedAccounts = await dataSource
      .getRepository(UserAccountScope)
      .findBy({ userId: user.id });

    expect(user.accountScopeMode).toBe(AccountScopeMode.SELECTED);
    expect(scopedAccounts).toHaveLength(0);
    // A resolução de acesso (feita pelo service do próximo checkpoint) deve
    // tratar SELECTED + 0 linhas como NENHUMA conta liberada — nunca ALL.
  });

  it('constraint única impede papel duplicado (mesma key)', async () => {
    await expect(
      dataSource.getRepository(Role).save({
        id: randomUUID(),
        key: 'VIEWER',
        name: 'Visualizador duplicado',
      }),
    ).rejects.toThrow();
  });

  it('constraint única impede permission_key duplicada para o mesmo papel', async () => {
    await expect(
      dataSource.getRepository(RolePermission).save({
        id: randomUUID(),
        roleId: viewerRoleId,
        permissionKey: PERMISSIONS.DASHBOARD_VIEW,
      }),
    ).rejects.toThrow();
  });

  it('constraint única impede override duplicado (mesmo usuário + permission_key)', async () => {
    const user = await createUser({ roleId: viewerRoleId });
    await dataSource.getRepository(UserPermissionOverride).save({
      id: randomUUID(),
      userId: user.id,
      permissionKey: PERMISSIONS.SYNC_RUN,
      granted: true,
    });

    await expect(
      dataSource.getRepository(UserPermissionOverride).save({
        id: randomUUID(),
        userId: user.id,
        permissionKey: PERMISSIONS.SYNC_RUN,
        granted: false,
      }),
    ).rejects.toThrow();
  });

  it('constraint única impede escopo de conta duplicado (mesmo usuário + conta)', async () => {
    const user = await createUser({
      roleId: viewerRoleId,
      accountScopeMode: AccountScopeMode.SELECTED,
    });
    await dataSource.getRepository(UserAccountScope).save({
      id: randomUUID(),
      userId: user.id,
      marketplaceAccountId: accountId,
    });

    await expect(
      dataSource.getRepository(UserAccountScope).save({
        id: randomUUID(),
        userId: user.id,
        marketplaceAccountId: accountId,
      }),
    ).rejects.toThrow();
  });

  it('CHECK constraint rejeita permission_key fora do catálogo canônico', async () => {
    const user = await createUser({ roleId: viewerRoleId });
    await expect(
      dataSource.getRepository(UserPermissionOverride).save({
        id: randomUUID(),
        userId: user.id,
        permissionKey: 'clientes.visualizar' as unknown as PermissionKey,
        granted: true,
      }),
    ).rejects.toThrow();
  });

  it('auditoria aceita alterações sanitizadas (sem exigir nenhum dado pessoal ou segredo)', async () => {
    const actor = await createUser({ roleId: viewerRoleId });
    const target = await createUser({ roleId: viewerRoleId });

    const entry = await dataSource.getRepository(UserAuditLog).save({
      id: randomUUID(),
      actorUserId: actor.id,
      targetUserId: target.id,
      action: UserAuditAction.PERMISSIONS_CHANGED,
      changes: { role: { from: 'VIEWER', to: 'ANALYST' } },
    });

    expect(entry.id).toBeDefined();
    expect(entry.changes).toEqual({ role: { from: 'VIEWER', to: 'ANALYST' } });
  });

  it('CHECK constraint rejeita ação de auditoria fora do vocabulário fechado', async () => {
    const actor = await createUser({ roleId: viewerRoleId });
    await expect(
      dataSource.query(
        `INSERT INTO user_audit_logs (actor_user_id, target_user_id, action, changes)
         VALUES ($1, $1, 'DELETE_EVERYTHING', '{}')`,
        [actor.id],
      ),
    ).rejects.toThrow();
  });
});
