import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { AccountScopeMode } from '../users/account-scope-mode.enum';
import { Role } from '../users/role.entity';
import { SessionRevocationService } from '../users/session-revocation.service';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  CurrentPasswordInvalidError,
  NewPasswordMustDifferError,
} from './change-password.errors';
import { UserSession } from './user-session.entity';

/**
 * Fluxo completo de troca de senha (Checkpoint 3) contra Postgres real:
 * hash, revogação de sessões, `must_change_password`/`password_changed_at`,
 * auditoria sem segredo, e que a senha antiga deixa de autenticar.
 */
describe('AuthService.changePassword (Postgres real)', () => {
  let dataSource: DataSource;
  let authService: AuthService;
  let viewerRoleId: string;

  const configService = {
    get: (key: string, fallback?: unknown) => fallback,
    getOrThrow: () => 'test-access-token-secret-at-least-32-chars',
  } as unknown as ConfigService;

  beforeAll(async () => {
    dataSource = await createTestDataSource([User, Role, UserSession]);
    const viewerRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ key: 'VIEWER' });
    viewerRoleId = viewerRole.id;

    const usersService = new UsersService(dataSource.getRepository(User));
    authService = new AuthService(
      usersService,
      dataSource.getRepository(UserSession),
      new JwtService(),
      configService,
      new SessionRevocationService(),
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE user_sessions CASCADE');
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@change-password-spec.example.com'",
    );
  });

  const currentPassword = 'senha-atual-123';

  async function createUser(): Promise<string> {
    const passwordHash = await argon2.hash(currentPassword);
    const user = await dataSource.getRepository(User).save({
      id: randomUUID(),
      name: 'Usuário',
      email: `${randomUUID()}@change-password-spec.example.com`,
      passwordHash,
      active: true,
      roleId: viewerRoleId,
      accountScopeMode: AccountScopeMode.NONE,
      mustChangePassword: true,
    });
    return user.id;
  }

  it('28. senha atual incorreta -> CurrentPasswordInvalidError', async () => {
    const userId = await createUser();
    await expect(
      authService.changePassword(userId, 'senha-errada', 'nova-senha-456'),
    ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
  });

  it('29. nova senha igual à atual -> NewPasswordMustDifferError', async () => {
    const userId = await createUser();
    await expect(
      authService.changePassword(userId, currentPassword, currentPassword),
    ).rejects.toBeInstanceOf(NewPasswordMustDifferError);
  });

  it('30/31/32. nova senha válida atualiza hash, limpa must_change_password e grava password_changed_at', async () => {
    const userId = await createUser();
    const before = new Date();

    await authService.changePassword(userId, currentPassword, 'nova-senha-456');

    const row = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    expect(row.mustChangePassword).toBe(false);
    expect(row.passwordChangedAt).not.toBeNull();
    expect(row.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );
    expect(await argon2.verify(row.passwordHash, 'nova-senha-456')).toBe(true);
  });

  it('33. revoga todas as sessões do usuário', async () => {
    const userId = await createUser();
    await dataSource.getRepository(UserSession).save({
      id: randomUUID(),
      userId,
      refreshTokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
    });

    await authService.changePassword(userId, currentPassword, 'nova-senha-456');

    const sessions = await dataSource
      .getRepository(UserSession)
      .findBy({ userId });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('35/36. senha antiga deixa de autenticar; nova senha autentica', async () => {
    const userId = await createUser();
    await authService.changePassword(userId, currentPassword, 'nova-senha-456');

    const row = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    expect(await argon2.verify(row.passwordHash, currentPassword)).toBe(false);
    expect(await argon2.verify(row.passwordHash, 'nova-senha-456')).toBe(true);
  });

  it('37. auditoria PASSWORD_CHANGED não contém senha nem o VALOR do hash (o nome do campo "passwordHash" é esperado e ok)', async () => {
    const userId = await createUser();
    await authService.changePassword(userId, currentPassword, 'nova-senha-456');

    const rows = await dataSource.query<
      Array<{ action: string; changes: Record<string, unknown> }>
    >('SELECT action, changes FROM user_audit_logs WHERE target_user_id = $1', [
      userId,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('PASSWORD_CHANGED');
    expect(rows[0].changes).toEqual({ fields: ['passwordHash'] });

    const row = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    const serialized = JSON.stringify(rows[0].changes);
    expect(serialized).not.toContain(currentPassword);
    expect(serialized).not.toContain('nova-senha-456');
    expect(serialized).not.toContain(row.passwordHash);
  });
});
