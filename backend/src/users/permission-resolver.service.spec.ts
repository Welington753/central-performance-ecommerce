import { randomUUID } from 'crypto';
import { DataSource, type Repository } from 'typeorm';
import { Marketplace } from '../integrations/contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../integrations/marketplace-accounts/marketplace-account.entity';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { AccountScopeMode } from './account-scope-mode.enum';
import { PermissionResolverService } from './permission-resolver.service';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  ROLE_PERMISSION_PRESETS,
} from './permissions.catalog';
import { Role } from './role.entity';
import { RolePermission } from './role-permission.entity';
import { User } from './user.entity';
import { UserAccountScope } from './user-account-scope.entity';
import { UserPermissionOverride } from './user-permission-override.entity';
import { UsersService } from './users.service';

type RoleKeyName = 'ADMIN' | 'ANALYST' | 'VIEWER';

describe('PermissionResolverService (Postgres real)', () => {
  let dataSource: DataSource;
  let resolver: PermissionResolverService;
  let roleIds: Record<RoleKeyName, string>;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      User,
      Role,
      RolePermission,
      UserPermissionOverride,
      UserAccountScope,
      MarketplaceAccount,
    ]);
    const usersService = new UsersService(dataSource.getRepository(User));
    resolver = new PermissionResolverService(
      usersService,
      dataSource.getRepository(Role),
      dataSource.getRepository(RolePermission),
      dataSource.getRepository(UserPermissionOverride),
      dataSource.getRepository(UserAccountScope),
    );

    const roles = await dataSource.getRepository(Role).find();
    roleIds = Object.fromEntries(
      roles
        .filter(
          (role) =>
            role.key === 'ADMIN' ||
            role.key === 'ANALYST' ||
            role.key === 'VIEWER',
        )
        .map((role) => [role.key, role.id]),
    ) as Record<RoleKeyName, string>;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@resolver-spec.example.com'",
    );
    await dataSource.query("DELETE FROM roles WHERE key = 'SUPERUSER'");
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
  });

  async function createUser(overrides: Partial<User> = {}): Promise<User> {
    return dataSource.getRepository(User).save({
      id: randomUUID(),
      name: 'Usuário de Teste',
      email: `${randomUUID()}@resolver-spec.example.com`,
      passwordHash: 'hash',
      active: true,
      accountScopeMode: AccountScopeMode.NONE,
      mustChangePassword: false,
      ...overrides,
    });
  }

  it('1. ADMIN recebe exatamente todo o catálogo canônico', async () => {
    const user = await createUser({ roleId: roleIds.ADMIN });
    const ctx = await resolver.resolve(user.id);

    expect([...ctx.permissions].sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
    expect(ctx.roleKey).toBe('ADMIN');
    expect(ctx.isAdmin).toBe(true);
    expect(ctx.active).toBe(true);
    expect(ctx.userId).toBe(user.id);
  });

  it('2. override negativo não remove permissão de ADMIN', async () => {
    const user = await createUser({ roleId: roleIds.ADMIN });
    await dataSource.getRepository(UserPermissionOverride).save({
      id: randomUUID(),
      userId: user.id,
      permissionKey: PERMISSIONS.USERS_MANAGE,
      granted: false,
    });

    const ctx = await resolver.resolve(user.id);
    expect(ctx.permissions).toContain(PERMISSIONS.USERS_MANAGE);
    expect(ctx.permissions.length).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('3. override positivo não altera o resultado completo de ADMIN', async () => {
    const user = await createUser({ roleId: roleIds.ADMIN });
    await dataSource.getRepository(UserPermissionOverride).save({
      id: randomUUID(),
      userId: user.id,
      permissionKey: PERMISSIONS.SYNC_RUN,
      granted: true,
    });

    const ctx = await resolver.resolve(user.id);
    expect(ctx.permissions.length).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('4. ANALYST recebe exatamente o preset do catálogo', async () => {
    const user = await createUser({ roleId: roleIds.ANALYST });
    const ctx = await resolver.resolve(user.id);

    expect([...ctx.permissions].sort()).toEqual(
      [...ROLE_PERMISSION_PRESETS.ANALYST].sort(),
    );
    expect(ctx.roleKey).toBe('ANALYST');
    expect(ctx.isAdmin).toBe(false);
  });

  it('5. VIEWER recebe exatamente o preset do catálogo', async () => {
    const user = await createUser({ roleId: roleIds.VIEWER });
    const ctx = await resolver.resolve(user.id);

    expect([...ctx.permissions].sort()).toEqual(
      [...ROLE_PERMISSION_PRESETS.VIEWER].sort(),
    );
    expect(ctx.roleKey).toBe('VIEWER');
  });

  it('6. override positivo adiciona permissão que o preset de VIEWER não dá', async () => {
    const user = await createUser({ roleId: roleIds.VIEWER });
    await dataSource.getRepository(UserPermissionOverride).save({
      id: randomUUID(),
      userId: user.id,
      permissionKey: PERMISSIONS.SYNC_RUN,
      granted: true,
    });

    const ctx = await resolver.resolve(user.id);
    expect(ROLE_PERMISSION_PRESETS.VIEWER).not.toContain(PERMISSIONS.SYNC_RUN);
    expect(ctx.permissions).toContain(PERMISSIONS.SYNC_RUN);
  });

  it('7. override negativo remove permissão que o preset de ANALYST daria', async () => {
    const user = await createUser({ roleId: roleIds.ANALYST });
    await dataSource.getRepository(UserPermissionOverride).save({
      id: randomUUID(),
      userId: user.id,
      permissionKey: PERMISSIONS.CUSTOMERS_EXPORT,
      granted: false,
    });

    const ctx = await resolver.resolve(user.id);
    expect(ROLE_PERMISSION_PRESETS.ANALYST).toContain(
      PERMISSIONS.CUSTOMERS_EXPORT,
    );
    expect(ctx.permissions).not.toContain(PERMISSIONS.CUSTOMERS_EXPORT);
  });

  it('8. usuário inativo é negado (permissions vazio, accountScope NONE)', async () => {
    const user = await createUser({ roleId: roleIds.ADMIN, active: false });
    const ctx = await resolver.resolve(user.id);

    expect(ctx.active).toBe(false);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.roleKey).toBeNull();
    expect(ctx.accountScope).toEqual({ mode: 'NONE' });
  });

  it('10a. usuário inexistente é negado de forma fechada, sem lançar exceção', async () => {
    const ctx = await resolver.resolve(randomUUID());
    expect(ctx.active).toBe(false);
    expect(ctx.permissions).toEqual([]);
    expect(ctx.roleKey).toBeNull();
  });

  it('10b. role_id apontando para um papel fora do vocabulário conhecido falha fechado', async () => {
    const bogusRoleId = randomUUID();
    await dataSource.query(
      `INSERT INTO roles (id, key, name, is_system) VALUES ($1, 'SUPERUSER', 'Superusuário', false)`,
      [bogusRoleId],
    );
    const user = await createUser({ roleId: bogusRoleId });

    const ctx = await resolver.resolve(user.id);
    expect(ctx.roleKey).toBeNull();
    expect(ctx.permissions).toEqual([]);
    expect(ctx.isAdmin).toBe(false);
  });

  describe('accountScope resolvido', () => {
    it('ALL', async () => {
      const user = await createUser({
        roleId: roleIds.VIEWER,
        accountScopeMode: AccountScopeMode.ALL,
      });
      const ctx = await resolver.resolve(user.id);
      expect(ctx.accountScope).toEqual({ mode: 'ALL' });
    });

    it('NONE', async () => {
      const user = await createUser({
        roleId: roleIds.VIEWER,
        accountScopeMode: AccountScopeMode.NONE,
      });
      const ctx = await resolver.resolve(user.id);
      expect(ctx.accountScope).toEqual({ mode: 'NONE' });
    });

    it('SELECTED com contas registradas — ids ordenados', async () => {
      const accountA = await dataSource.getRepository(MarketplaceAccount).save({
        id: randomUUID(),
        marketplace: Marketplace.MERCADO_LIVRE,
        externalSellerId: '1',
        status: MarketplaceAccountStatus.CONNECTED,
        tokenVersion: 1,
      });
      const accountB = await dataSource.getRepository(MarketplaceAccount).save({
        id: randomUUID(),
        marketplace: Marketplace.SHOPEE,
        externalSellerId: '2',
        status: MarketplaceAccountStatus.CONNECTED,
        tokenVersion: 1,
      });
      const user = await createUser({
        roleId: roleIds.VIEWER,
        accountScopeMode: AccountScopeMode.SELECTED,
      });
      await dataSource.getRepository(UserAccountScope).save([
        {
          id: randomUUID(),
          userId: user.id,
          marketplaceAccountId: accountA.id,
        },
        {
          id: randomUUID(),
          userId: user.id,
          marketplaceAccountId: accountB.id,
        },
      ]);

      const ctx = await resolver.resolve(user.id);
      expect(ctx.accountScope).toEqual({
        mode: 'SELECTED',
        accountIds: [accountA.id, accountB.id].sort(),
      });
    });

    it('SELECTED sem nenhum registro nunca vira ALL — zero contas', async () => {
      const user = await createUser({
        roleId: roleIds.VIEWER,
        accountScopeMode: AccountScopeMode.SELECTED,
      });
      const ctx = await resolver.resolve(user.id);
      expect(ctx.accountScope).toEqual({ mode: 'SELECTED', accountIds: [] });
    });
  });

  it('12. mudança feita no banco aparece na próxima resolução, sem reiniciar nada (nunca cacheia)', async () => {
    const user = await createUser({ roleId: roleIds.VIEWER });

    const before = await resolver.resolve(user.id);
    expect(before.roleKey).toBe('VIEWER');

    await dataSource.query('UPDATE users SET role_id = $1 WHERE id = $2', [
      roleIds.ADMIN,
      user.id,
    ]);

    const after = await resolver.resolve(user.id);
    expect(after.roleKey).toBe('ADMIN');
    expect(after.permissions.length).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('mustChangePassword é repassado do usuário', async () => {
    const user = await createUser({
      roleId: roleIds.VIEWER,
      mustChangePassword: true,
    });
    const ctx = await resolver.resolve(user.id);
    expect(ctx.mustChangePassword).toBe(true);
  });
});

/**
 * Defesa em profundidade: `role_permissions`/`user_permission_overrides`
 * têm CHECK constraint no banco (Checkpoint 1) que já impede fisicamente uma
 * `permission_key` fora do catálogo, e `users.role_id` é NOT NULL desde o
 * Checkpoint 3 — por isso nenhum dos dois cenários abaixo é reproduzível via
 * inserção real (Postgres rejeitaria antes de chegar ao resolver). Testados
 * aqui com repositórios fake para provar que o PRÓPRIO código do resolver
 * também nega, nunca só a constraint do banco.
 */
describe('PermissionResolverService — filtragem defensiva (fakes, cenários impossíveis via banco real)', () => {
  it('9. usuário sem papel é negado — nunca cai num fallback permissivo (defesa em profundidade: role_id é NOT NULL no banco)', async () => {
    const fakeUser = {
      id: 'u1',
      active: true,
      // Elenco proposital: o schema real nunca permite `role_id` nulo
      // (NOT NULL desde o Checkpoint 3) — este teste prova que, mesmo que
      // uma linha corrompida/legada chegasse aqui, o resolver ainda nega.
      roleId: null as unknown as string,
      accountScopeMode: AccountScopeMode.NONE,
      mustChangePassword: false,
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue(fakeUser),
    } as unknown as UsersService;
    const findOneBy = jest.fn();
    const roleRepository = { findOneBy } as unknown as Repository<Role>;
    const rolePermissionRepository = {
      findBy: jest.fn(),
    } as unknown as Repository<RolePermission>;
    const overrideRepository = {
      findBy: jest.fn(),
    } as unknown as Repository<UserPermissionOverride>;
    const accountScopeRepository = {
      findBy: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<UserAccountScope>;

    const resolver = new PermissionResolverService(
      usersService,
      roleRepository,
      rolePermissionRepository,
      overrideRepository,
      accountScopeRepository,
    );

    const ctx = await resolver.resolve('u1');
    expect(ctx.active).toBe(true);
    expect(ctx.roleKey).toBeNull();
    expect(ctx.isAdmin).toBe(false);
    expect(ctx.permissions).toEqual([]);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  it('ignora uma linha de role_permissions com permission_key fora do catálogo, nunca concede', async () => {
    const fakeUser = {
      id: 'u1',
      active: true,
      roleId: 'role-1',
      accountScopeMode: AccountScopeMode.NONE,
      mustChangePassword: false,
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue(fakeUser),
    } as unknown as UsersService;
    const roleRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'role-1', key: 'VIEWER' }),
    } as unknown as Repository<Role>;
    const rolePermissionRepository = {
      findBy: jest
        .fn()
        .mockResolvedValue([
          { permissionKey: PERMISSIONS.DASHBOARD_VIEW },
          { permissionKey: 'chave.inventada.fora.do.catalogo' },
        ]),
    } as unknown as Repository<RolePermission>;
    const overrideRepository = {
      findBy: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<UserPermissionOverride>;
    const accountScopeRepository = {
      findBy: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<UserAccountScope>;

    const resolver = new PermissionResolverService(
      usersService,
      roleRepository,
      rolePermissionRepository,
      overrideRepository,
      accountScopeRepository,
    );

    const ctx = await resolver.resolve('u1');
    expect(ctx.permissions).toEqual([PERMISSIONS.DASHBOARD_VIEW]);
    expect(ctx.permissions).not.toContain('chave.inventada.fora.do.catalogo');
  });

  it('ignora um override com permission_key fora do catálogo, nunca concede nem remove nada por ela', async () => {
    const fakeUser = {
      id: 'u1',
      active: true,
      roleId: 'role-1',
      accountScopeMode: AccountScopeMode.NONE,
      mustChangePassword: false,
    };
    const usersService = {
      findById: jest.fn().mockResolvedValue(fakeUser),
    } as unknown as UsersService;
    const roleRepository = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'role-1', key: 'VIEWER' }),
    } as unknown as Repository<Role>;
    const rolePermissionRepository = {
      findBy: jest
        .fn()
        .mockResolvedValue([{ permissionKey: PERMISSIONS.DASHBOARD_VIEW }]),
    } as unknown as Repository<RolePermission>;
    const overrideRepository = {
      findBy: jest
        .fn()
        .mockResolvedValue([
          { permissionKey: 'chave.inventada', granted: true },
        ]),
    } as unknown as Repository<UserPermissionOverride>;
    const accountScopeRepository = {
      findBy: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<UserAccountScope>;

    const resolver = new PermissionResolverService(
      usersService,
      roleRepository,
      rolePermissionRepository,
      overrideRepository,
      accountScopeRepository,
    );

    const ctx = await resolver.resolve('u1');
    expect(ctx.permissions).toEqual([PERMISSIONS.DASHBOARD_VIEW]);
  });
});
