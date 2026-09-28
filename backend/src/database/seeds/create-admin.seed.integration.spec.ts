import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { AccountScopeMode } from '../../users/account-scope-mode.enum';
import { Role } from '../../users/role.entity';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { runCreateAdminSeed } from './create-admin.seed';

/**
 * Nunca lê `.env` real — as variáveis de ambiente do seed são passadas
 * explicitamente como objeto (`CreateAdminSeedEnv`), nunca via
 * `process.env` neste teste.
 */
describe('runCreateAdminSeed (Postgres real)', () => {
  let dataSource: DataSource;
  let usersService: UsersService;
  let roleRepository: Repository<Role>;

  beforeAll(async () => {
    dataSource = await createTestDataSource([User, Role]);
    usersService = new UsersService(dataSource.getRepository(User));
    roleRepository = dataSource.getRepository(Role);
  });

  afterAll(async () => {
    // Nunca deixa admin sintético órfão no banco descartável — outras
    // suítes (ex.: `last-admin-guard.spec.ts`) reaproveitam o MESMO banco
    // na mesma sessão e contam admins ativos de verdade.
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@create-admin-seed-spec.example.com'",
    );
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      "DELETE FROM users WHERE email LIKE '%@create-admin-seed-spec.example.com'",
    );
  });

  it('42/44. falha com mensagem clara se faltar email ou senha — nunca senha padrão', async () => {
    await expect(
      runCreateAdminSeed(usersService, roleRepository, {
        email: undefined,
        password: 'whatever12',
      }),
    ).rejects.toThrow(/INITIAL_ADMIN_EMAIL/);
  });

  it('44. cria o admin completo: papel ADMIN, is_admin=true, escopo ALL, must_change_password=false', async () => {
    const email = `${randomUUID()}@create-admin-seed-spec.example.com`;

    const result = await runCreateAdminSeed(usersService, roleRepository, {
      email,
      password: 'senha-forte-123',
    });

    expect(result.outcome).toBe('created');

    const created = await usersService.findByEmail(email);
    expect(created).not.toBeNull();
    expect(created!.isAdmin).toBe(true);
    expect(created!.accountScopeMode).toBe(AccountScopeMode.ALL);
    expect(created!.mustChangePassword).toBe(false);
    expect(created!.active).toBe(true);

    const role = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ id: created!.roleId });
    expect(role.key).toBe('ADMIN');
  });

  it('nunca persiste a senha em texto puro (só hash argon2)', async () => {
    const email = `${randomUUID()}@create-admin-seed-spec.example.com`;
    const plainPassword = 'senha-forte-123';

    await runCreateAdminSeed(usersService, roleRepository, {
      email,
      password: plainPassword,
    });

    const created = await usersService.findByEmail(email);
    expect(created!.passwordHash).not.toBe(plainPassword);
    expect(created!.passwordHash).not.toContain(plainPassword);
    expect(created!.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('45. seed repetido para o mesmo email não cria duplicado nem altera o usuário existente', async () => {
    const email = `${randomUUID()}@create-admin-seed-spec.example.com`;

    const first = await runCreateAdminSeed(usersService, roleRepository, {
      email,
      password: 'senha-forte-123',
    });
    const firstUser = await usersService.findByEmail(email);

    const second = await runCreateAdminSeed(usersService, roleRepository, {
      email,
      password: 'outra-senha-456',
    });
    const secondUser = await usersService.findByEmail(email);

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('already_exists');
    // Nunca promove/altera o usuário existente — mesma senha (hash) de antes.
    expect(secondUser!.passwordHash).toBe(firstUser!.passwordHash);
    expect(secondUser!.id).toBe(firstUser!.id);
  });

  it('não cria segundo usuário no banco — confirma ausência de duplicata por contagem', async () => {
    const email = `${randomUUID()}@create-admin-seed-spec.example.com`;

    await runCreateAdminSeed(usersService, roleRepository, {
      email,
      password: 'senha-forte-123',
    });
    await runCreateAdminSeed(usersService, roleRepository, {
      email,
      password: 'senha-forte-123',
    });

    const rows = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*)::text AS count FROM users WHERE email = $1',
      [email],
    );
    expect(rows[0].count).toBe('1');
  });
});
