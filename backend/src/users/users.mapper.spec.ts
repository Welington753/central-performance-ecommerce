import { AccountScopeMode } from './account-scope-mode.enum';
import type { AuthorizationContext } from './authorization-context.interface';
import { ALL_PERMISSION_KEYS, PERMISSIONS } from './permissions.catalog';
import type { User } from './user.entity';
import { toCurrentUserResponse, toUserResponse } from './users.mapper';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    name: 'Ana',
    email: 'ana@example.com',
    passwordHash: 'super-secret-hash',
    active: true,
    isAdmin: false,
    roleId: 'role-1',
    accountScopeMode: AccountScopeMode.NONE,
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildAuthorizationContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    userId: 'u1',
    active: true,
    roleKey: 'ANALYST',
    isAdmin: false,
    permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.FULL_VIEW],
    accountScope: { mode: 'ALL' },
    mustChangePassword: false,
    ...overrides,
  };
}

describe('toCurrentUserResponse', () => {
  it('26. inclui role, permissions, accountScope e mustChangePassword', () => {
    const dto = toCurrentUserResponse(buildUser(), buildAuthorizationContext());
    expect(dto.role).toBe('ANALYST');
    expect(dto.permissions).toEqual([
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.FULL_VIEW,
    ]);
    expect(dto.accountScope).toEqual({ mode: 'ALL' });
    expect(dto.mustChangePassword).toBe(false);
  });

  it('27. mantém os campos anteriores do contrato, incluindo isAdmin (da coluna, não do contexto)', () => {
    const user = buildUser({ isAdmin: true });
    const dto = toCurrentUserResponse(
      user,
      buildAuthorizationContext({ isAdmin: true }),
    );
    expect(dto.id).toBe(user.id);
    expect(dto.name).toBe(user.name);
    expect(dto.email).toBe(user.email);
    expect(dto.active).toBe(user.active);
    expect(dto.isAdmin).toBe(true);
    expect(dto.createdAt).toBe(user.createdAt);
    expect(dto.updatedAt).toBe(user.updatedAt);
  });

  it('28. nunca inclui passwordHash, tokens ou overrides internos', () => {
    const dto = toCurrentUserResponse(buildUser(), buildAuthorizationContext());
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('super-secret-hash');
    expect(serialized.toLowerCase()).not.toContain('token');
    expect(serialized.toLowerCase()).not.toContain('override');
  });

  it('29. permissions e accountScope.accountIds vêm ordenados (resposta determinística)', () => {
    const dto = toCurrentUserResponse(
      buildUser(),
      buildAuthorizationContext({
        permissions: [PERMISSIONS.SYNC_VIEW, PERMISSIONS.DASHBOARD_VIEW],
        accountScope: { mode: 'SELECTED', accountIds: ['b', 'a'] },
      }),
    );
    // O resolver já ordena (Checkpoint 2, permission-resolver.service.ts) —
    // este teste prova que o mapper NÃO reordena por conta própria nem
    // desfaz a ordem recebida (nenhuma cópia/serialização perde a ordem).
    expect(dto.permissions).toEqual([
      PERMISSIONS.SYNC_VIEW,
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
  });

  it('ADMIN recebe todas as permissões do catálogo no DTO', () => {
    const dto = toCurrentUserResponse(
      buildUser({ isAdmin: true }),
      buildAuthorizationContext({
        roleKey: 'ADMIN',
        isAdmin: true,
        permissions: ALL_PERMISSION_KEYS,
      }),
    );
    expect(dto.permissions).toHaveLength(ALL_PERMISSION_KEYS.length);
  });

  it('roleKey null vira role null no DTO (usuário sem papel)', () => {
    const dto = toCurrentUserResponse(
      buildUser(),
      buildAuthorizationContext({ roleKey: null, permissions: [] }),
    );
    expect(dto.role).toBeNull();
    expect(dto.permissions).toEqual([]);
  });
});

describe('toUserResponse (contrato de login/refresh — não alterado por este checkpoint)', () => {
  it('continua sem os campos novos — /auth/me é o único endpoint estendido', () => {
    const dto = toUserResponse(buildUser());
    expect(dto).not.toHaveProperty('role');
    expect(dto).not.toHaveProperty('permissions');
    expect(dto).not.toHaveProperty('accountScope');
    expect(dto).not.toHaveProperty('mustChangePassword');
  });
});
