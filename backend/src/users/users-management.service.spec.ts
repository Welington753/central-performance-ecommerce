import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { Marketplace } from '../integrations/contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../integrations/marketplace-accounts/marketplace-account.entity';
import { UserSession } from '../auth/user-session.entity';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { AccountScopeMode } from './account-scope-mode.enum';
import { LastActiveAdminRequiredError } from './last-admin-guard';
import { PERMISSIONS } from './permissions.catalog';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { SessionRevocationService } from './session-revocation.service';
import { User } from './user.entity';
import { UserAccessManagementService } from './user-access-management.service';
import { UserAccessRulesService } from './user-access-rules.service';
import { UserAccountScope } from './user-account-scope.entity';
import { UserAuditLog } from './user-audit-log.entity';
import { UserAuditService } from './user-audit.service';
import { UserPermissionOverride } from './user-permission-override.entity';
import { UserProvisioningService } from './user-provisioning.service';
import { UsersManagementQueryService } from './users-management-query.service';
import { UsersManagementService } from './users-management.service';
import {
  CannotResetOwnPasswordError,
  InvalidAccountScopeError,
  InvalidPermissionError,
  UserEmailAlreadyExistsError,
  UserNotFoundError,
} from './users-management.errors';

type RoleKeyName = 'ADMIN' | 'ANALYST' | 'VIEWER';

/**
 * Fiação manual da fachada + subserviços a partir de um `DataSource` de
 * teste — espelha `UsersManagementModule`, mas sem subir todo o Nest DI,
 * já que este spec instancia diretamente para controlar duas conexões
 * concorrentes no teste de concorrência do último admin.
 */
function buildUsersManagementService(
  dataSource: DataSource,
): UsersManagementService {
  const queryService = new UsersManagementQueryService(
    dataSource.getRepository(User),
    dataSource.getRepository(Role),
    dataSource.getRepository(UserPermissionOverride),
    dataSource.getRepository(UserAccountScope),
    dataSource.getRepository(UserAuditLog),
  );
  const accessRules = new UserAccessRulesService(
    dataSource.getRepository(MarketplaceAccount),
  );
  const auditService = new UserAuditService();
  const sessionRevocationService = new SessionRevocationService();
  const provisioningService = new UserProvisioningService(
    dataSource,
    dataSource.getRepository(User),
    dataSource.getRepository(Role),
    sessionRevocationService,
    accessRules,
    auditService,
    queryService,
  );
  const accessManagementService = new UserAccessManagementService(
    dataSource,
    dataSource.getRepository(User),
    dataSource.getRepository(Role),
    dataSource.getRepository(UserPermissionOverride),
    sessionRevocationService,
    accessRules,
    auditService,
    queryService,
  );
  return new UsersManagementService(
    queryService,
    provisioningService,
    accessManagementService,
  );
}

describe('UsersManagementService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: UsersManagementService;
  let roleIds: Record<RoleKeyName, string>;
  let accountId: string;
  let actorId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      User,
      Role,
      RolePermission,
      UserPermissionOverride,
      UserAccountScope,
      UserAuditLog,
      MarketplaceAccount,
      UserSession,
    ]);
    service = buildUsersManagementService(dataSource);

    const roles = await dataSource.getRepository(Role).find();
    roleIds = Object.fromEntries(
      roles
        .filter(
          (r) => r.key === 'ADMIN' || r.key === 'ANALYST' || r.key === 'VIEWER',
        )
        .map((r) => [r.key, r.id]),
    ) as Record<RoleKeyName, string>;
  });

  afterAll(async () => {
    // Nunca deixa usuário/admin sintético órfão no banco descartável —
    // outras suítes (ex.: `last-admin-guard.spec.ts`) reaproveitam o
    // MESMO banco na mesma sessão e contam admins ativos de verdade.
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@users-mgmt-spec.example.com'",
    );
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE user_audit_logs CASCADE');
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query('TRUNCATE TABLE user_sessions CASCADE');
    // O guard do último admin conta TODOS os admins ativos do banco: parte de
    // uma tabela `users` vazia para não depender de admins deixados por
    // outras suítes (independe da ordem de execução).
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '1',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;

    actorId = await createRawUser(roleIds.ADMIN, true);
  });

  async function createRawUser(
    roleId: string,
    isAdmin: boolean,
    active = true,
  ): Promise<string> {
    const user = await dataSource.getRepository(User).save({
      id: randomUUID(),
      name: 'Seed',
      email: `${randomUUID()}@users-mgmt-spec.example.com`,
      passwordHash: 'hash',
      active,
      roleId,
      isAdmin,
      accountScopeMode: AccountScopeMode.NONE,
    });
    return user.id;
  }

  function email(): string {
    return `${randomUUID()}@users-mgmt-spec.example.com`;
  }

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe('create', () => {
    it('5/6. ADMIN cria VIEWER com senha temporária retornada só nesta resposta', async () => {
      const { user, temporaryPassword } = await service.create(actorId, {
        name: 'Novo Viewer',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      expect(user.role).toBe('VIEWER');
      expect(user.isAdmin).toBe(false);
      expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
      expect(user).not.toHaveProperty('temporaryPassword');
      expect(JSON.stringify(user)).not.toContain(temporaryPassword);
    });

    it('7. senha temporária não aparece na auditoria', async () => {
      const { user, temporaryPassword } = await service.create(actorId, {
        name: 'Novo Viewer',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      const audit = await service.getAudit(user.id, {});
      const serialized = JSON.stringify(audit);
      expect(serialized).not.toContain(temporaryPassword);
    });

    it('8. email duplicado -> UserEmailAlreadyExistsError', async () => {
      const sharedEmail = email();
      await service.create(actorId, {
        name: 'A',
        email: sharedEmail,
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      await expect(
        service.create(actorId, {
          name: 'B',
          email: sharedEmail,
          role: 'VIEWER',
          accountScope: { mode: 'ALL' },
        }),
      ).rejects.toBeInstanceOf(UserEmailAlreadyExistsError);
    });

    it('email é normalizado (trim + lowercase) para unicidade', async () => {
      const base = randomUUID();
      await service.create(actorId, {
        name: 'A',
        email: `${base}@Users-Mgmt-Spec.example.com`,
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      await expect(
        service.create(actorId, {
          name: 'B',
          email: `  ${base}@users-mgmt-spec.example.com  `,
          role: 'VIEWER',
          accountScope: { mode: 'ALL' },
        }),
      ).rejects.toBeInstanceOf(UserEmailAlreadyExistsError);
    });

    it('11. permission key desconhecida em override -> InvalidPermissionError', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'ANALYST',
          overrides: [{ permissionKey: 'chave.inventada', granted: true }],
          accountScope: { mode: 'ALL' },
        }),
      ).rejects.toBeInstanceOf(InvalidPermissionError);
    });

    it('12. ADMIN com override -> InvalidPermissionError', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'ADMIN',
          overrides: [{ permissionKey: PERMISSIONS.SYNC_RUN, granted: true }],
          accountScope: { mode: 'ALL' },
        }),
      ).rejects.toBeInstanceOf(InvalidPermissionError);
    });

    it('13. não-ADMIN com override de users.manage -> InvalidPermissionError', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'ANALYST',
          overrides: [
            { permissionKey: PERMISSIONS.USERS_MANAGE, granted: true },
          ],
          accountScope: { mode: 'ALL' },
        }),
      ).rejects.toBeInstanceOf(InvalidPermissionError);
    });

    it('14. SELECTED sem conta -> InvalidAccountScopeError', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'VIEWER',
          accountScope: { mode: 'SELECTED', accountIds: [] },
        }),
      ).rejects.toBeInstanceOf(InvalidAccountScopeError);
    });

    it('15. ALL com accountIds -> InvalidAccountScopeError', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'VIEWER',
          accountScope: { mode: 'ALL', accountIds: [accountId] },
        }),
      ).rejects.toBeInstanceOf(InvalidAccountScopeError);
    });

    it('15b. NONE com accountIds -> InvalidAccountScopeError', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'VIEWER',
          accountScope: { mode: 'NONE', accountIds: [accountId] },
        }),
      ).rejects.toBeInstanceOf(InvalidAccountScopeError);
    });

    it('ADMIN com accountScope SELECTED -> InvalidAccountScopeError (ADMIN sempre ALL)', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'ADMIN',
          accountScope: { mode: 'SELECTED', accountIds: [accountId] },
        }),
      ).rejects.toBeInstanceOf(InvalidAccountScopeError);
    });

    it('16. conta inexistente em SELECTED -> erro seguro (InvalidAccountScopeError, sem revelar qual ID)', async () => {
      await expect(
        service.create(actorId, {
          name: 'A',
          email: email(),
          role: 'VIEWER',
          accountScope: { mode: 'SELECTED', accountIds: [randomUUID()] },
        }),
      ).rejects.toBeInstanceOf(InvalidAccountScopeError);
    });

    it('18. ADMIN criado tem is_admin=true; ANALYST/VIEWER têm is_admin=false — sempre sincronizado', async () => {
      const admin = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'ADMIN',
        accountScope: { mode: 'ALL' },
      });
      const analyst = await service.create(actorId, {
        name: 'B',
        email: email(),
        role: 'ANALYST',
        accountScope: { mode: 'ALL' },
      });

      const adminRow = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: admin.user.id });
      const analystRow = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: analyst.user.id });
      expect(adminRow.isAdmin).toBe(true);
      expect(analystRow.isAdmin).toBe(false);
    });

    it('overrides redundantes com o preset não são persistidos (só diferenças reais)', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'ANALYST',
        // ANALYST já tem dashboard.view por preset — override redundante.
        overrides: [
          { permissionKey: PERMISSIONS.DASHBOARD_VIEW, granted: true },
          { permissionKey: PERMISSIONS.SYNC_RUN, granted: true },
        ],
        accountScope: { mode: 'ALL' },
      });

      const detail = await service.getById(user.id);
      expect(detail.overrides).toEqual([
        { permissionKey: PERMISSIONS.SYNC_RUN, granted: true },
      ]);
      expect(detail.permissions).toContain(PERMISSIONS.SYNC_RUN);
      expect(detail.permissions).toContain(PERMISSIONS.DASHBOARD_VIEW);
    });

    it('SELECTED com contas válidas persiste o escopo', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'SELECTED', accountIds: [accountId] },
      });

      const detail = await service.getById(user.id);
      expect(detail.accountScope).toEqual({
        mode: 'SELECTED',
        accountIds: [accountId],
      });
    });

    it('campo desconhecido no DTO seria rejeitado pelo ValidationPipe global — coberto no controller.spec (whitelist:true)', () => {
      // Marcador: a validação de forma acontece no DTO/ValidationPipe
      // (main.ts), testado no e2e de controller — o service recebe sempre
      // um input já validado.
      expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // list / getById
  // -----------------------------------------------------------------------

  describe('list / getById', () => {
    it('3/4. lista usuários sem passwordHash/tokens, ordenação determinística', async () => {
      await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });
      await service.create(actorId, {
        name: 'B',
        email: email(),
        role: 'ANALYST',
        accountScope: { mode: 'ALL' },
      });

      const page1 = await service.list({});
      const page1Again = await service.list({});
      expect(page1.items.map((i) => i.id)).toEqual(
        page1Again.items.map((i) => i.id),
      );
      for (const item of page1.items) {
        expect(item).not.toHaveProperty('passwordHash');
      }
    });

    it('paginação: limit restringe o tamanho da página, total reflete o universo inteiro', async () => {
      for (let i = 0; i < 3; i += 1) {
        await service.create(actorId, {
          name: `User ${i}`,
          email: email(),
          role: 'VIEWER',
          accountScope: { mode: 'ALL' },
        });
      }

      const result = await service.list({ limit: 2, page: 1 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBeGreaterThanOrEqual(4); // 3 + actorId admin
    });

    it('filtro por status e papel', async () => {
      const { user: viewer } = await service.create(actorId, {
        name: 'V',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });
      await service.setStatus(actorId, viewer.id, false);

      const inactive = await service.list({ status: 'inactive' });
      expect(inactive.items.some((i) => i.id === viewer.id)).toBe(true);
      expect(inactive.items.every((i) => i.active === false)).toBe(true);

      const admins = await service.list({ role: 'ADMIN' });
      expect(admins.items.every((i) => i.role === 'ADMIN')).toBe(true);
    });

    it('getById inexistente -> UserNotFoundError', async () => {
      await expect(service.getById(randomUUID())).rejects.toBeInstanceOf(
        UserNotFoundError,
      );
    });

    it('getById nunca inclui passwordHash', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });
      const detail = await service.getById(user.id);
      expect(JSON.stringify(detail)).not.toContain('passwordHash');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe('update', () => {
    it('17. mudança de SELECTED para ALL remove associações antigas', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'SELECTED', accountIds: [accountId] },
      });

      await service.update(actorId, user.id, { accountScope: { mode: 'ALL' } });

      const rows = await dataSource
        .getRepository(UserAccountScope)
        .findBy({ userId: user.id });
      expect(rows).toHaveLength(0);
      const detail = await service.getById(user.id);
      expect(detail.accountScope).toEqual({ mode: 'ALL' });
    });

    it('19. atualizar name gera auditoria USER_UPDATED só com o nome dos campos', async () => {
      const { user } = await service.create(actorId, {
        name: 'Nome Antigo',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      await service.update(actorId, user.id, { name: 'Nome Novo' });

      const audit = await service.getAudit(user.id, {});
      const entry = audit.items.find((i) => i.action === 'USER_UPDATED');
      expect(entry).toBeDefined();
      expect(entry!.changes).toEqual({ fields: ['name'] });
      expect(JSON.stringify(entry)).not.toContain('Nome Antigo');
      expect(JSON.stringify(entry)).not.toContain('Nome Novo');
    });

    it('mudar papel gera ROLE_CHANGED e sincroniza is_admin', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      await service.update(actorId, user.id, {
        role: 'ADMIN',
        accountScope: { mode: 'ALL' },
      });

      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(row.isAdmin).toBe(true);
      const audit = await service.getAudit(user.id, {});
      expect(audit.items.some((i) => i.action === 'ROLE_CHANGED')).toBe(true);
    });

    it('rebaixar ADMIN sem informar accountScope explicitamente -> InvalidAccountScopeError', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'ADMIN',
        accountScope: { mode: 'ALL' },
      });
      await service.create(actorId, {
        name: 'Outro Admin',
        email: email(),
        role: 'ADMIN',
        accountScope: { mode: 'ALL' },
      });

      await expect(
        service.update(actorId, user.id, { role: 'VIEWER' }),
      ).rejects.toBeInstanceOf(InvalidAccountScopeError);
    });

    it('promover para ADMIN com overrides pendurados -> InvalidPermissionError', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      await expect(
        service.update(actorId, user.id, {
          role: 'ADMIN',
          overrides: [{ permissionKey: PERMISSIONS.SYNC_RUN, granted: true }],
        }),
      ).rejects.toBeInstanceOf(InvalidPermissionError);
    });

    it('update inexistente -> UserNotFoundError', async () => {
      await expect(
        service.update(actorId, randomUUID(), { name: 'X' }),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // setStatus
  // -----------------------------------------------------------------------

  describe('setStatus', () => {
    it('19b. desativar usuário revoga todas as sessões ativas', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });
      await dataSource.getRepository(UserSession).save({
        id: randomUUID(),
        userId: user.id,
        refreshTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      });

      await service.setStatus(actorId, user.id, false);

      const sessions = await dataSource
        .getRepository(UserSession)
        .findBy({ userId: user.id });
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('registra auditoria USER_DEACTIVATED / USER_ACTIVATED', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });

      await service.setStatus(actorId, user.id, false);
      await service.setStatus(actorId, user.id, true);

      const audit = await service.getAudit(user.id, {});
      expect(audit.items.map((i) => i.action)).toEqual(
        expect.arrayContaining(['USER_DEACTIVATED', 'USER_ACTIVATED']),
      );
    });
  });

  // -----------------------------------------------------------------------
  // resetPassword
  // -----------------------------------------------------------------------

  describe('resetPassword', () => {
    it('20. reset de senha revoga sessões e marca must_change_password', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });
      await dataSource.getRepository(UserSession).save({
        id: randomUUID(),
        userId: user.id,
        refreshTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: null,
      });

      const { temporaryPassword } = await service.resetPassword(
        actorId,
        user.id,
      );

      expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(row.mustChangePassword).toBe(true);
      const sessions = await dataSource
        .getRepository(UserSession)
        .findBy({ userId: user.id });
      expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    });

    it('21. reset no próprio usuário -> CannotResetOwnPasswordError', async () => {
      await expect(
        service.resetPassword(actorId, actorId),
      ).rejects.toBeInstanceOf(CannotResetOwnPasswordError);
    });

    it('22. auditoria de reset não contém senha nem hash', async () => {
      const { user } = await service.create(actorId, {
        name: 'A',
        email: email(),
        role: 'VIEWER',
        accountScope: { mode: 'ALL' },
      });
      const { temporaryPassword } = await service.resetPassword(
        actorId,
        user.id,
      );

      const audit = await service.getAudit(user.id, {});
      const serialized = JSON.stringify(audit);
      expect(serialized).not.toContain(temporaryPassword);
      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(serialized).not.toContain(row.passwordHash);
    });
  });

  // -----------------------------------------------------------------------
  // Último administrador
  // -----------------------------------------------------------------------

  describe('proteção do último administrador', () => {
    it('23. não pode desativar o último admin ativo', async () => {
      // actorId já é o único ADMIN criado no beforeEach.
      await expect(
        service.setStatus(actorId, actorId, false),
      ).rejects.toBeInstanceOf(LastActiveAdminRequiredError);
      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: actorId });
      expect(row.active).toBe(true);
    });

    it('24. não pode rebaixar o último admin ativo', async () => {
      await expect(
        service.update(actorId, actorId, {
          role: 'VIEWER',
          accountScope: { mode: 'ALL' },
        }),
      ).rejects.toBeInstanceOf(LastActiveAdminRequiredError);
      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: actorId });
      expect(row.roleId).toBe(roleIds.ADMIN);
    });

    it('25. pode desativar/rebaixar um admin quando outro admin ativo permanece', async () => {
      const { user: secondAdmin } = await service.create(actorId, {
        name: 'Segundo Admin',
        email: email(),
        role: 'ADMIN',
        accountScope: { mode: 'ALL' },
      });

      await expect(
        service.setStatus(actorId, secondAdmin.id, false),
      ).resolves.toBeDefined();

      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: secondAdmin.id });
      expect(row.active).toBe(false);
    });

    it('27. falha (último admin) não deixa role/is_admin/auditoria parcialmente alterados', async () => {
      const auditBefore = await service.getAudit(actorId, {});

      await expect(
        service.update(actorId, actorId, {
          role: 'VIEWER',
          accountScope: { mode: 'ALL' },
        }),
      ).rejects.toBeInstanceOf(LastActiveAdminRequiredError);

      const row = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: actorId });
      expect(row.roleId).toBe(roleIds.ADMIN);
      expect(row.isAdmin).toBe(true);
      const auditAfter = await service.getAudit(actorId, {});
      expect(auditAfter.total).toBe(auditBefore.total);
    });

    it('26. duas operações concorrentes desativando dois admins diferentes (só 2 existem) nunca deixam zero admins ativos', async () => {
      const { user: secondAdmin } = await service.create(actorId, {
        name: 'Segundo Admin',
        email: email(),
        role: 'ADMIN',
        accountScope: { mode: 'ALL' },
      });

      const service2 = buildUsersManagementService(dataSource);

      const results = await Promise.allSettled([
        service.setStatus(actorId, actorId, false),
        service2.setStatus(actorId, secondAdmin.id, false),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(LastActiveAdminRequiredError);

      const activeAdmins = await dataSource.query<Array<{ count: string }>>(
        `SELECT count(*)::text AS count FROM users WHERE role_id = $1 AND active = true`,
        [roleIds.ADMIN],
      );
      expect(Number(activeAdmins[0].count)).toBeGreaterThanOrEqual(1);
    });
  });
});
