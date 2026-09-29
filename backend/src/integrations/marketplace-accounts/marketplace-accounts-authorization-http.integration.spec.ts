import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../auth/auth.module';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../auth/constants/auth.constants';
import { PermissionResolverService } from '../../users/permission-resolver.service';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { MarketplaceAccountsModule } from './marketplace-accounts.module';

/**
 * Checkpoint 5A — prova HTTP REAL representativa (correção do usuário, item
 * 3): `AccessTokenGuard`, `PermissionGuard`, `AuthorizationContextService` e
 * `PermissionResolverService` REAIS, contra um PostgreSQL 16 descartável de
 * verdade, com usuário/papel/`role_permissions`/overrides/
 * `account_scope_mode`/`user_account_scope` reais persistidos e um JWT real
 * assinado para cada usuário. Não repetida em cada controller — a matriz
 * extensa dos demais controllers usa o padrão leve mockado (ver
 * `marketplace-accounts.controller.spec.ts`).
 */
describe('MarketplaceAccountsController — autorização real de ponta a ponta (Checkpoint 5A)', () => {
  let app: INestApplication;
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];
  let dataSource: DataSource;
  let jwtService: JwtService;

  const ACCESS_TOKEN_SECRET = 'x'.repeat(32);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'production',
              ACCESS_TOKEN_SECRET,
              ACCESS_TOKEN_TTL_SECONDS: 900,
            }),
          ],
        }),
        TypeOrmModule.forRootAsync({
          useFactory: () =>
            buildDataSourceOptions({
              databaseUrl: requireTestDatabaseUrl(),
              nodeEnv: 'test',
            }),
        }),
        AuthModule,
        MarketplaceAccountsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Nunca trunca `roles`/`role_permissions` — são seed fixo da própria
    // migration (ADMIN/ANALYST/VIEWER), nunca estado de teste.
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
  });

  interface CreateUserOptions {
    roleKey: 'ADMIN' | 'ANALYST' | 'VIEWER';
    accountScopeMode: 'ALL' | 'SELECTED' | 'NONE';
    mustChangePassword?: boolean;
  }

  async function createUser(options: CreateUserOptions): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active, is_admin, role_id, account_scope_mode, must_change_password)
       VALUES ($1, 'Test User', $2, 'x', true, false,
               (SELECT id FROM roles WHERE key = $3), $4, $5)`,
      [
        id,
        `test-${id}@example.com`,
        options.roleKey,
        options.accountScopeMode,
        options.mustChangePassword ?? false,
      ],
    );
    return id;
  }

  async function overridePermission(
    userId: string,
    permissionKey: string,
    granted: boolean,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO user_permission_overrides (user_id, permission_key, granted)
       VALUES ($1, $2, $3)`,
      [userId, permissionKey, granted],
    );
  }

  async function grantAccountScope(
    userId: string,
    marketplaceAccountId: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO user_account_scope (user_id, marketplace_account_id) VALUES ($1, $2)`,
      [userId, marketplaceAccountId],
    );
  }

  async function seedAccount(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status, token_version)
       VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED', 0)`,
      [id],
    );
    return id;
  }

  function cookieFor(userId: string): string {
    const token = jwtService.sign(
      { sub: userId, email: `test-${userId}@example.com` },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    );
    return `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
  }

  it('a. ADMIN + ALL acessa leitura (GET) e mutação (PATCH nickname)', async () => {
    const userId = await createUser({
      roleKey: 'ADMIN',
      accountScopeMode: 'ALL',
    });
    const accountId = await seedAccount();
    const cookie = cookieFor(userId);

    await request(http())
      .get('/marketplace-accounts')
      .set('Cookie', cookie)
      .expect(200);

    await request(http())
      .patch(`/marketplace-accounts/${accountId}/nickname`)
      .set('Cookie', cookie)
      .send({ nickname: 'Loja ADMIN' })
      .expect(200);
  });

  it('b. VIEWER sem integrations.manage recebe 403 na mutação', async () => {
    const userId = await createUser({
      roleKey: 'VIEWER',
      accountScopeMode: 'ALL',
    });
    const accountId = await seedAccount();

    await request(http())
      .patch(`/marketplace-accounts/${accountId}/nickname`)
      .set('Cookie', cookieFor(userId))
      .send({ nickname: 'Não deveria funcionar' })
      .expect(403);
  });

  it('c. ANALYST com override concedido de integrations.manage acessa a mutação', async () => {
    const userId = await createUser({
      roleKey: 'ANALYST',
      accountScopeMode: 'ALL',
    });
    await overridePermission(userId, 'integrations.manage', true);
    const accountId = await seedAccount();

    await request(http())
      .patch(`/marketplace-accounts/${accountId}/nickname`)
      .set('Cookie', cookieFor(userId))
      .send({ nickname: 'Loja ANALYST' })
      .expect(200);
  });

  it('d. override negativo remove integrations.view do preset e bloqueia a leitura', async () => {
    const userId = await createUser({
      roleKey: 'ANALYST',
      accountScopeMode: 'ALL',
    });
    await overridePermission(userId, 'integrations.view', false);

    await request(http())
      .get('/marketplace-accounts')
      .set('Cookie', cookieFor(userId))
      .expect(403);
  });

  it('e/f. SELECTED acessa a conta autorizada e recebe 404 na conta fora do escopo', async () => {
    const userId = await createUser({
      roleKey: 'ADMIN',
      accountScopeMode: 'SELECTED',
    });
    const allowedAccount = await seedAccount();
    const forbiddenAccount = await seedAccount();
    await grantAccountScope(userId, allowedAccount);
    const cookie = cookieFor(userId);

    await request(http())
      .patch(`/marketplace-accounts/${allowedAccount}/nickname`)
      .set('Cookie', cookie)
      .send({ nickname: 'Permitida' })
      .expect(200);

    await request(http())
      .patch(`/marketplace-accounts/${forbiddenAccount}/nickname`)
      .set('Cookie', cookie)
      .send({ nickname: 'Não deveria funcionar' })
      .expect(404);
  });

  it('g. NONE não acessa nenhuma conta', async () => {
    const userId = await createUser({
      roleKey: 'ADMIN',
      accountScopeMode: 'NONE',
    });
    const accountId = await seedAccount();
    const cookie = cookieFor(userId);

    const list = await request(http())
      .get('/marketplace-accounts')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toEqual([]);

    await request(http())
      .patch(`/marketplace-accounts/${accountId}/nickname`)
      .set('Cookie', cookie)
      .send({ nickname: 'Não deveria funcionar' })
      .expect(404);
  });

  it('h. mustChangePassword=true recebe 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const userId = await createUser({
      roleKey: 'ADMIN',
      accountScopeMode: 'ALL',
      mustChangePassword: true,
    });

    const res = await request(http())
      .get('/marketplace-accounts')
      .set('Cookie', cookieFor(userId))
      .expect(403);
    expect((res.body as { message: string }).message).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
  });

  it('i. PermissionResolverService.resolve roda no máximo uma vez por requisição', async () => {
    const userId = await createUser({
      roleKey: 'ADMIN',
      accountScopeMode: 'ALL',
    });
    const resolver = app.get(PermissionResolverService);
    const resolveSpy = jest.spyOn(resolver, 'resolve');

    await request(http())
      .get('/marketplace-accounts')
      .set('Cookie', cookieFor(userId))
      .expect(200);

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    resolveSpy.mockRestore();
  });

  it('j. mudar role_permissions/user_account_scope no banco muda o resultado da próxima requisição do MESMO token, sem novo login', async () => {
    const userId = await createUser({
      roleKey: 'ANALYST',
      accountScopeMode: 'ALL',
    });
    const accountId = await seedAccount();
    const cookie = cookieFor(userId);

    await request(http())
      .patch(`/marketplace-accounts/${accountId}/nickname`)
      .set('Cookie', cookie)
      .send({ nickname: 'Antes' })
      .expect(403);

    await overridePermission(userId, 'integrations.manage', true);

    await request(http())
      .patch(`/marketplace-accounts/${accountId}/nickname`)
      .set('Cookie', cookie)
      .send({ nickname: 'Depois' })
      .expect(200);
  });
});
