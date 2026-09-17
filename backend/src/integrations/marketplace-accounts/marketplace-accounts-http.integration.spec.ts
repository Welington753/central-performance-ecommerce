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
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { MarketplaceAccountsModule } from './marketplace-accounts.module';

/**
 * Checkpoint CP2E-R1 — fronteira HTTP REAL (`INestApplication` + `supertest`)
 * contra um PostgreSQL 16 descartável de verdade (mesmo padrão de
 * `shopee-oauth.e2e.spec.ts`), provando o provisionamento de uma
 * `MarketplaceAccount` SHOPEE ponta a ponta: nunca afirma que o UUID/valores
 * default foram gerados pelo backend sem reler a linha persistida via SQL
 * cru (nunca confiando só no corpo JSON da resposta).
 */
describe('POST /marketplace-accounts — fronteira HTTP real (Postgres real, Checkpoint CP2E-R1)', () => {
  let app: INestApplication;
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
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
  });

  function accessTokenCookie(): string {
    const token = jwtService.sign(
      { sub: randomUUID(), email: 'test@example.com' },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    );
    return `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
  }

  interface PersistedRow {
    id: string;
    marketplace: string;
    external_seller_id: string | null;
    status: string;
    encrypted_access_token: string | null;
    encrypted_refresh_token: string | null;
    token_expires_at: Date | null;
    connected_by_user_id: string | null;
    token_version: number;
  }

  async function selectPersistedRow(id: string): Promise<PersistedRow> {
    const rows: PersistedRow[] = await dataSource.query(
      `SELECT id, marketplace, external_seller_id, status,
              encrypted_access_token, encrypted_refresh_token,
              token_expires_at, connected_by_user_id, token_version
         FROM marketplace_accounts WHERE id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  async function countAllAccounts(): Promise<number> {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT count(*) FROM marketplace_accounts',
    );
    return Number(rows[0].count);
  }

  const UUID_V4_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('creates a SHOPEE account: 200, UUID real persistido, DISCONNECTED, externalSellerId/tokens nulos (nunca confia só no corpo JSON — relê a linha)', async () => {
    const response = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'SHOPEE' });

    expect(response.status).toBe(201);
    const body = response.body as { id: string; marketplace: string };
    expect(body.marketplace).toBe('SHOPEE');
    expect(body.id).toMatch(UUID_V4_PATTERN);

    const row = await selectPersistedRow(body.id);
    expect(row.marketplace).toBe('SHOPEE');
    expect(row.status).toBe('DISCONNECTED');
    expect(row.external_seller_id).toBeNull();
    expect(row.encrypted_access_token).toBeNull();
    expect(row.encrypted_refresh_token).toBeNull();
    expect(row.token_expires_at).toBeNull();
    expect(row.connected_by_user_id).toBeNull();
    expect(row.token_version).toBe(0);
  });

  it('rejects a marketplace outside the enum with 400 and creates no row', async () => {
    const before = await countAllAccounts();

    const response = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'ALIEXPRESS' });

    expect(response.status).toBe(400);
    expect(await countAllAccounts()).toBe(before);
  });

  it('still accepts MERCADO_LIVRE (no regression from widening the allowlist)', async () => {
    const response = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'MERCADO_LIVRE' });

    expect(response.status).toBe(201);
    const body = response.body as { id: string; marketplace: string };
    expect(body.marketplace).toBe('MERCADO_LIVRE');
    const row = await selectPersistedRow(body.id);
    expect(row.marketplace).toBe('MERCADO_LIVRE');
    expect(row.status).toBe('DISCONNECTED');
  });

  it('still accepts AMAZON (no regression from widening the allowlist)', async () => {
    const response = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'AMAZON' });

    expect(response.status).toBe(201);
    const body = response.body as { id: string; marketplace: string };
    expect(body.marketplace).toBe('AMAZON');
    const row = await selectPersistedRow(body.id);
    expect(row.marketplace).toBe('AMAZON');
    expect(row.status).toBe('DISCONNECTED');
  });

  it('rejects an unauthenticated request with 401 and creates no row', async () => {
    const before = await countAllAccounts();

    const response = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .send({ marketplace: 'SHOPEE' });

    expect(response.status).toBe(401);
    expect(await countAllAccounts()).toBe(before);
  });

  it('disconnects a CONNECTED account: 200, DISCONNECTED, tokens nulled, externalSellerId preserved', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'SHOPEE' });
    const id = (createResponse.body as { id: string }).id;

    await dataSource.query(
      `UPDATE marketplace_accounts
          SET status = 'CONNECTED', external_seller_id = 'shop-999',
              encrypted_access_token = 'iv:tag:a', encrypted_refresh_token = 'iv:tag:r',
              token_expires_at = now() + interval '1 hour'
        WHERE id = $1`,
      [id],
    );

    const response = await request(app.getHttpServer())
      .post(`/marketplace-accounts/${id}/disconnect`)
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    const body = response.body as { id: string; status: string };
    expect(body.status).toBe('DISCONNECTED');

    const row = await selectPersistedRow(id);
    expect(row.status).toBe('DISCONNECTED');
    expect(row.encrypted_access_token).toBeNull();
    expect(row.encrypted_refresh_token).toBeNull();
    expect(row.token_expires_at).toBeNull();
    expect(row.external_seller_id).toBe('shop-999');
  });

  it('rejects disconnect with 401 when no session cookie is sent', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'SHOPEE' });
    const id = (createResponse.body as { id: string }).id;

    const response = await request(app.getHttpServer()).post(
      `/marketplace-accounts/${id}/disconnect`,
    );

    expect(response.status).toBe(401);
  });

  it('returns 404 when disconnecting a non-existent account id', async () => {
    const response = await request(app.getHttpServer())
      .post('/marketplace-accounts/00000000-0000-4000-8000-000000000000/disconnect')
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(404);
  });
});
