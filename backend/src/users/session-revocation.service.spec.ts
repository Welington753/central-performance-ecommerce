import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { UserSession } from '../auth/user-session.entity';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { AccountScopeMode } from './account-scope-mode.enum';
import { Role } from './role.entity';
import { SessionRevocationService } from './session-revocation.service';
import { User } from './user.entity';

describe('SessionRevocationService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: SessionRevocationService;
  let viewerRoleId: string;
  let userId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([UserSession, User, Role]);
    service = new SessionRevocationService();
    const viewerRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ key: 'VIEWER' });
    viewerRoleId = viewerRole.id;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function createUser(): Promise<string> {
    const user = await dataSource.getRepository(User).save({
      id: randomUUID(),
      name: 'Usuário de Teste',
      email: `${randomUUID()}@session-revocation-spec.example.com`,
      passwordHash: 'hash',
      active: true,
      roleId: viewerRoleId,
      accountScopeMode: AccountScopeMode.NONE,
    });
    return user.id;
  }

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE user_sessions CASCADE');
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@session-revocation-spec.example.com'",
    );
    userId = await createUser();
  });

  async function insertSession(
    overrides: Partial<UserSession> = {},
  ): Promise<UserSession> {
    return dataSource.getRepository(UserSession).save({
      id: randomUUID(),
      userId,
      refreshTokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      ip: null,
      userAgent: null,
      ...overrides,
    });
  }

  it('zero sessões: não lança, devolve 0', async () => {
    const revoked = await dataSource.manager.transaction((manager) =>
      service.revokeAllActiveForUser(manager, userId),
    );
    expect(revoked).toBe(0);
  });

  it('uma sessão ativa: revoga e devolve 1', async () => {
    const session = await insertSession();

    const revoked = await dataSource.manager.transaction((manager) =>
      service.revokeAllActiveForUser(manager, userId),
    );

    expect(revoked).toBe(1);
    const reloaded = await dataSource
      .getRepository(UserSession)
      .findOneByOrFail({ id: session.id });
    expect(reloaded.revokedAt).not.toBeNull();
  });

  it('várias sessões ativas: revoga todas', async () => {
    await insertSession();
    await insertSession();
    await insertSession();

    const revoked = await dataSource.manager.transaction((manager) =>
      service.revokeAllActiveForUser(manager, userId),
    );

    expect(revoked).toBe(3);
    const remaining = await dataSource
      .getRepository(UserSession)
      .findBy({ userId });
    expect(remaining.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('nunca revoga sessão de OUTRO usuário', async () => {
    const otherUserId = await createUser();
    await insertSession();
    await insertSession({ userId: otherUserId });

    await dataSource.manager.transaction((manager) =>
      service.revokeAllActiveForUser(manager, userId),
    );

    const otherSessions = await dataSource
      .getRepository(UserSession)
      .findBy({ userId: otherUserId });
    expect(otherSessions.every((s) => s.revokedAt === null)).toBe(true);
  });

  it('idempotente: revogar de novo não falha e não conta sessões já revogadas', async () => {
    await insertSession();

    const first = await dataSource.manager.transaction((manager) =>
      service.revokeAllActiveForUser(manager, userId),
    );
    const second = await dataSource.manager.transaction((manager) =>
      service.revokeAllActiveForUser(manager, userId),
    );

    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('ignora sessão já revogada (não sobrescreve revokedAt de uma já revogada anteriormente)', async () => {
    const oldRevokedAt = new Date('2026-01-01T00:00:00Z');
    const session = await insertSession({ revokedAt: oldRevokedAt });

    await dataSource.manager.transaction((manager) =>
      service.revokeAllActiveForUser(manager, userId),
    );

    const reloaded = await dataSource
      .getRepository(UserSession)
      .findOneByOrFail({ id: session.id });
    expect(reloaded.revokedAt?.toISOString()).toBe(oldRevokedAt.toISOString());
  });
});
