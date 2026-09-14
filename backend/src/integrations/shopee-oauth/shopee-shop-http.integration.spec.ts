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
import { CommonModule } from '../../common/common.module';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { SHOPEE_FETCH } from './shopee-http.client';
import { ShopeeOAuthModule } from './shopee-oauth.module';
import {
  jsonResponse,
  textResponse,
} from './shopee-shop-api.client.test-helpers';

/**
 * Checkpoint CP2J — fronteira HTTP REAL de
 * `GET /marketplace-accounts/:id/shopee/shop-info`, via `INestApplication` +
 * `supertest` contra PostgreSQL 16 real. Mesmo padrão de
 * `shopee-oauth.e2e.spec.ts`: monta um módulo de teste mínimo (não o
 * `AppModule` inteiro), `SHOPEE_FETCH` é SEMPRE o mock injetado — nenhum
 * teste aqui chama a Shopee real, Cloudflare Tunnel, internet ou banco de
 * produção.
 */
describe('GET /marketplace-accounts/:id/shopee/shop-info — fronteira HTTP real (Postgres real, Checkpoint CP2J)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let encryptionService: EncryptionService;
  let shopeeFetch: jest.Mock;
  let accountId: string;
  let userId: string;

  const FRONTEND_URL = 'https://app.example.com';
  const ACCESS_TOKEN_SECRET = 'x'.repeat(32);
  const PARTNER_KEY = 'partner-key-example-never-leaked';

  beforeAll(async () => {
    shopeeFetch = jest.fn(() => {
      throw new Error(
        'SHOPEE_FETCH não deveria ser chamado sem mock explícito.',
      );
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'production',
              FRONTEND_URL,
              ACCESS_TOKEN_SECRET,
              ACCESS_TOKEN_TTL_SECONDS: 900,
              CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
              ML_ACCOUNT_LOCK_WAIT_MS: 500,
              SHOPEE_PARTNER_ID: '1000000',
              SHOPEE_PARTNER_KEY: PARTNER_KEY,
              SHOPEE_REDIRECT_URI:
                'https://api.example.com/integrations/shopee/callback',
              SHOPEE_ENVIRONMENT: 'SANDBOX',
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
        CommonModule,
        AuthModule,
        ShopeeOAuthModule,
      ],
    })
      .overrideProvider(SHOPEE_FETCH)
      .useValue(shopeeFetch)
      .compile();

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
    encryptionService = app.get(EncryptionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    shopeeFetch.mockReset();
    shopeeFetch.mockImplementation(() => {
      throw new Error(
        'SHOPEE_FETCH não deveria ser chamado sem mock explícito.',
      );
    });

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    accountId = randomUUID();
  });

  function accessTokenCookie(): string {
    const token = jwtService.sign(
      { sub: userId, email: `test-${userId}@example.com` },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    );
    return `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
  }

  /** Insere uma conta Shopee com `tokenExpiresAt` bem no futuro — o fast path
   * de skew de `ShopeeAccessTokenService` nunca tenta renovar, então
   * `shopeeFetch` só recebe a chamada da Shop API (`getShopInfo`), nunca a de
   * refresh. */
  async function insertConnectedAccount(
    overrides: { externalSellerId?: string } = {},
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO marketplace_accounts
         (id, marketplace, status, external_seller_id, encrypted_access_token,
          encrypted_refresh_token, token_expires_at, token_version)
       VALUES ($1, 'SHOPEE', 'CONNECTED', $2, $3, $4, $5, 0)`,
      [
        accountId,
        overrides.externalSellerId ?? '555444333',
        encryptionService.encrypt('current-access-token'),
        encryptionService.encrypt('current-refresh-token'),
        new Date(Date.now() + 4 * 60 * 60 * 1000),
      ],
    );
  }

  async function insertAccount(
    marketplace: string,
    status: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, $2, $3)`,
      [accountId, marketplace, status],
    );
  }

  function route(id: string = accountId): string {
    return `/marketplace-accounts/${id}/shopee/shop-info`;
  }

  function shopInfoBody(overrides: Record<string, unknown> = {}) {
    return {
      error: '',
      message: '',
      request_id: 'req-abc123',
      shop_name: 'Loja Exemplo',
      region: 'BR',
      status: 'NORMAL',
      auth_time: Math.floor(Date.now() / 1000) - 1000,
      expire_time: Math.floor(Date.now() / 1000) + 100000,
      merchant_id: null,
      ...overrides,
    };
  }

  it('1: sem cookie → 401, nenhum serviço externo chamado', async () => {
    await insertConnectedAccount();

    const response = await request(app.getHttpServer()).get(route());

    expect(response.status).toBe(401);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('2: JWT assinado com segredo errado → 401', async () => {
    await insertConnectedAccount();
    const wrongToken = jwtService.sign(
      { sub: userId, email: 'x@y.com' },
      { secret: 'wrong-secret-'.padEnd(32, '0'), expiresIn: '15m' },
    );

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${wrongToken}`);

    expect(response.status).toBe(401);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('3/4/5: autenticado + sucesso → 200, exatamente os seis campos públicos, Cache-Control no-store', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockResolvedValue(jsonResponse(200, shopInfoBody()));

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.body as object)).toEqual([
      'shopName',
      'region',
      'status',
      'authorizationGrantedAt',
      'authorizationExpiresAt',
      'merchantId',
    ]);
    expect((response.body as { shopName: string }).shopName).toBe(
      'Loja Exemplo',
    );
    expect((response.body as { status: string }).status).toBe('NORMAL');
    expect(shopeeFetch).toHaveBeenCalledTimes(1);
  });

  it('6: conta inexistente → resposta genérica de "não encontrada"', async () => {
    const response = await request(app.getHttpServer())
      .get(route(randomUUID()))
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(404);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('6: conta de outro marketplace → a MESMA resposta genérica de "não encontrada" (nunca revela o marketplace real)', async () => {
    await insertAccount('MERCADO_LIVRE', 'DISCONNECTED');

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(404);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('7: conta Shopee desconectada → 409 fechado, nenhuma chamada externa', async () => {
    await insertAccount('SHOPEE', 'DISCONNECTED');

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(409);
    expect((response.body as { message: string }).message).toBe(
      'SHOPEE_NOT_CONNECTED',
    );
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('8: fornecedor indisponível (erro de rede) → erro público fechado (503)', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockRejectedValue(new Error('ECONNRESET'));

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(503);
    expect((response.body as { message: string }).message).toBe(
      'SHOPEE_TEMPORARILY_UNAVAILABLE',
    );
  });

  it('8b: Shopee rejeita explicitamente (error_shop) → erro público fechado (502)', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockResolvedValue(
      jsonResponse(200, {
        error: 'error_shop',
        message: 'a loja foi banida por dropshipping suspeito',
      }),
    );

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(502);
    expect((response.body as { message: string }).message).toBe(
      'SHOPEE_DATA_UNAVAILABLE',
    );
  });

  it('9: mensagem maliciosa/bruta do mock nunca aparece na resposta', async () => {
    await insertConnectedAccount();
    const maliciousMessage = '<script>alert(document.cookie)</script>';
    shopeeFetch.mockResolvedValue(
      jsonResponse(200, {
        error: 'error_server',
        message: maliciousMessage,
      }),
    );

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(JSON.stringify(response.body)).not.toContain(maliciousMessage);
    expect(JSON.stringify(response.body)).not.toContain('<script>');
  });

  it('9b: JSON inválido do fornecedor nunca aparece cru na resposta', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockResolvedValue(textResponse(200, 'not-json{{'));

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain('not-json');
  });

  it('10: nenhum token/sign/Partner Key aparece na resposta de sucesso', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockResolvedValue(jsonResponse(200, shopInfoBody()));

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(PARTNER_KEY);
    expect(serialized).not.toContain('current-access-token');
    expect(serialized).not.toContain('current-refresh-token');
    expect(serialized).not.toMatch(/[0-9a-f]{64}/); // nenhum `sign` hex de 64 chars
  });

  it('10b: a URL/querystring completa (com access_token/sign) nunca chega ao chamador de shopeeFetch em texto exposto na resposta', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockImplementation((url: string) => {
      // Prova que a URL realmente carrega segredos (senão o teste seria
      // vazio) — mas nunca deixa isso vazar de volta na resposta HTTP.
      expect(url).toContain('access_token=');
      expect(url).toContain('sign=');
      return Promise.resolve(jsonResponse(200, shopInfoBody()));
    });

    const response = await request(app.getHttpServer())
      .get(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('access_token=');
    expect(serialized).not.toContain('sign=');
  });

  it('UUID inválido → 400, nenhuma chamada externa', async () => {
    const response = await request(app.getHttpServer())
      .get(route('not-a-uuid'))
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(400);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('UUID sintaticamente válido mas de outra versão (v1) → 400, nenhuma chamada externa', async () => {
    const uuidV1 = '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d';

    const response = await request(app.getHttpServer())
      .get(route(uuidV1))
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(400);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('parâmetros extras na query (token/shopId/environment/host/returnUrl) nunca controlam a chamada nem aparecem na resposta', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockResolvedValue(jsonResponse(200, shopInfoBody()));

    const response = await request(app.getHttpServer())
      .get(
        `${route()}?token=attacker-token&shopId=999999&environment=PRODUCTION` +
          '&host=https://evil.example.com&path=/evil&returnUrl=https://evil.example.com',
      )
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    const [calledUrl] = shopeeFetch.mock.calls[0] as [string];
    expect(calledUrl).not.toContain('evil.example.com');
    expect(calledUrl).toContain('openplatform.sandbox.test-stable.shopee.sg');
  });
});
