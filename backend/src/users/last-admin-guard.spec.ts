import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { AccountScopeMode } from './account-scope-mode.enum';
import {
  acquireLastAdminGuardLock,
  assertOtherActiveAdminExists,
  LastActiveAdminRequiredError,
} from './last-admin-guard';
import { Role } from './role.entity';
import { User } from './user.entity';

describe('last-admin-guard (Postgres real)', () => {
  let dataSource: DataSource;
  let adminRoleId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([User, Role]);
    const adminRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ key: 'ADMIN' });
    adminRoleId = adminRole.id;
  });

  afterAll(async () => {
    // Nunca deixa admin sintético órfão no banco descartável — outras
    // suítes (ex.: `users-management.service.spec.ts`) reaproveitam o
    // MESMO banco na mesma sessão e contam admins ativos de verdade.
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@last-admin-guard-spec.example.com'",
    );
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@last-admin-guard-spec.example.com'",
    );
  });

  async function createAdmin(active = true): Promise<string> {
    const user = await dataSource.getRepository(User).save({
      id: randomUUID(),
      name: 'Admin',
      email: `${randomUUID()}@last-admin-guard-spec.example.com`,
      passwordHash: 'hash',
      active,
      isAdmin: true,
      roleId: adminRoleId,
      accountScopeMode: AccountScopeMode.ALL,
    });
    return user.id;
  }

  it('com 2 admins ativos, excluir um deles ainda deixa 1 — não lança', async () => {
    const admin1 = await createAdmin();
    await createAdmin();

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await acquireLastAdminGuardLock(queryRunner);
      await expect(
        assertOtherActiveAdminExists(queryRunner, adminRoleId, admin1),
      ).resolves.not.toThrow();
      await queryRunner.commitTransaction();
    } finally {
      await queryRunner.release();
    }
  });

  it('com 1 único admin ativo, excluí-lo da contagem lança LastActiveAdminRequiredError', async () => {
    const onlyAdmin = await createAdmin();

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await acquireLastAdminGuardLock(queryRunner);
      await expect(
        assertOtherActiveAdminExists(queryRunner, adminRoleId, onlyAdmin),
      ).rejects.toBeInstanceOf(LastActiveAdminRequiredError);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  it('admin INATIVO não conta como sobrevivente', async () => {
    const admin1 = await createAdmin();
    await createAdmin(false); // inativo — não conta

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await acquireLastAdminGuardLock(queryRunner);
      await expect(
        assertOtherActiveAdminExists(queryRunner, adminRoleId, admin1),
      ).rejects.toBeInstanceOf(LastActiveAdminRequiredError);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  it('a mensagem do erro é estável e não vaza detalhe interno', () => {
    const error = new LastActiveAdminRequiredError();
    expect(error.message).toBe('LAST_ACTIVE_ADMIN_REQUIRED');
  });
});
