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
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { SHOPEE_FETCH } from './shopee-http.client';
import { ShopeeOAuthModule } from './shopee-oauth.module';

/**
 * Checkpoint CP2D (revisão final) — fronteira HTTP REAL, via
 * `INestApplication` + `supertest`, não só `GUARDS_METADATA`. Investigação
 * prévia (ver relatório da revisão):
 *
 *  - `AppModule` só registra UM guard global (`APP_GUARD` → `ThrottlerGuard`,
 *    rate limiting) — NÃO há guard de autenticação global nem decorator
 *    `@Public` em lugar nenhum do projeto;
 *  - autenticação é sempre OPT-IN por rota via `@UseGuards(AccessTokenGuard)`
 *    explícito — o callback do Mercado Livre (`MercadoLivreOAuthController.
 *    callback`) já segue exatamente este padrão: público pela AUSÊNCIA do
 *    guard no método, nunca por um mecanismo de bypass;
 *  - `ShopeeOAuthController.callback` segue o MESMO padrão — nada a
 *    construir, só provar via requisição HTTP real (este arquivo).
 *
 * Monta um módulo de teste mínimo (não o `AppModule` inteiro — evita
 * `ScheduleModule`/jobs/outras integrações concorrendo pelo mesmo banco)
 * com `TypeOrmModule.forRootAsync` real (mesma `buildDataSourceOptions` da
 * produção) contra o PostgreSQL 16 descartável, `cookieParser` e
 * `ValidationPipe` como em `main.ts`. `SHOPEE_FETCH` é sempre sobrescrito —
 * nenhum teste aqui chama rede real.
 */
describe('Shopee OAuth — fronteira HTTP real (Postgres real, Checkpoint CP2D)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let shopeeFetch: jest.Mock;
  let accountId: string;
  let userId: string;

  const FRONTEND_URL = 'https://app.example.com';
  const ACCESS_TOKEN_SECRET = 'x'.repeat(32);

  beforeAll(async () => {
    shopeeFetch = jest.fn(() => {
      throw new Error('SHOPEE_FETCH não deveria ser chamado neste teste.');
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
              SHOPEE_PARTNER_KEY: 'partner-key-example',
              SHOPEE_REDIRECT_URI:
                'https://api.example.com/integrations/shopee/callback',
              SHOPEE_ENVIRONMENT: 'PRODUCTION',
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    shopeeFetch.mockClear();

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    accountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'SHOPEE', 'DISCONNECTED')`,
      [accountId],
    );
  });

  interface ConnectResponseBody {
    authorizationUrl: string;
  }

  function accessTokenCookie(): string {
    const token = jwtService.sign(
      { sub: userId, email: `test-${userId}@example.com` },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    );
    return `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
  }

  async function countRequestsForAccount(
    id: string = accountId,
  ): Promise<number> {
    const rows: Array<{ count: string }> = await dataSource.query(
      'SELECT count(*) FROM oauth_authorization_requests WHERE marketplace_account_id = $1',
      [id],
    );
    return Number(rows[0].count);
  }

  // Helper único para extrair `state` real via HTTP (nunca direto do
  // service) — todo teste de query ambígua/maliciosa do callback parte de
  // um `state` legitimamente criado, para provar que a REJEIÇÃO ocorre pela
  // validação de entrada, nunca porque o state já era inválido por outro
  // motivo.
  async function startConnectionAndGetState(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/marketplace-accounts/${accountId}/shopee/connect`)
      .set('Cookie', accessTokenCookie())
      .send();
    const body = response.body as ConnectResponseBody;
    return new URL(body.authorizationUrl).searchParams.get('state') as string;
  }

  describe('POST /marketplace-accounts/:id/shopee/connect', () => {
    it('1: sem autenticação → 401, nenhuma tentativa criada, cliente Shopee nunca chamado', async () => {
      const response = await request(app.getHttpServer())
        .post(`/marketplace-accounts/${accountId}/shopee/connect`)
        .send();

      expect(response.status).toBe(401);
      expect(await countRequestsForAccount()).toBe(0);
      expect(shopeeFetch).not.toHaveBeenCalled();
    });

    it('2: autenticado (cookie access_token real) → chega ao controller, cria PENDING sem PKCE, devolve só authorizationUrl com no-store', async () => {
      const response = await request(app.getHttpServer())
        .post(`/marketplace-accounts/${accountId}/shopee/connect`)
        .set('Cookie', accessTokenCookie())
        .send();

      const body = response.body as ConnectResponseBody;
      expect(response.status).toBe(200);
      expect(Object.keys(body)).toEqual(['authorizationUrl']);
      expect(body.authorizationUrl).toContain(
        'https://open.shopee.com.br/auth',
      );
      expect(response.headers['cache-control']).toBe('no-store');

      const rows: Array<{
        status: string;
        encrypted_code_verifier: string | null;
      }> = await dataSource.query(
        `SELECT status, encrypted_code_verifier FROM oauth_authorization_requests
          WHERE marketplace_account_id = $1`,
        [accountId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('PENDING');
      expect(rows[0].encrypted_code_verifier).toBeNull();
    });

    it('cookie JWT assinado com segredo errado → 401, nenhuma tentativa criada', async () => {
      const wrongToken = jwtService.sign(
        { sub: userId, email: 'x@y.com' },
        { secret: 'wrong-secret-'.padEnd(32, '0'), expiresIn: '15m' },
      );

      const response = await request(app.getHttpServer())
        .post(`/marketplace-accounts/${accountId}/shopee/connect`)
        .set('Cookie', `${ACCESS_TOKEN_COOKIE_NAME}=${wrongToken}`)
        .send();

      expect(response.status).toBe(401);
      expect(await countRequestsForAccount()).toBe(0);
    });
  });

  describe('GET /integrations/shopee/callback', () => {
    it('3: sem JWT/cookie — público, alcança o controller, 302 para FRONTEND_URL/integracoes, com no-store e no-referrer', async () => {
      const response = await request(app.getHttpServer()).get(
        '/integrations/shopee/callback?state=unknown-state&code=c&shop_id=1',
      );

      expect(response.status).toBe(302);
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
      expect(response.headers.location).toMatch(
        /^https:\/\/app\.example\.com\/integracoes\?/,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
    });

    it('4: query inválida (shop_id vazio) — continua público, 302 com razão pública fechada, não consome tentativa, não chama o cliente', async () => {
      const state = await startConnectionAndGetState();
      shopeeFetch.mockClear();

      const response = await request(app.getHttpServer()).get(
        `/integrations/shopee/callback?state=${state}&code=c&shop_id=`,
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );
      expect(shopeeFetch).not.toHaveBeenCalled();

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM oauth_authorization_requests WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].status).toBe('PENDING');
    });

    it('5: returnUrl/redirect malicioso na query é ignorado — Location continua fixo, code/state/shop_id nunca aparecem nele', async () => {
      const response = await request(app.getHttpServer()).get(
        '/integrations/shopee/callback' +
          '?state=super-secret-state-value' +
          '&code=super-secret-auth-code' +
          '&shop_id=200000' +
          '&returnUrl=https://evil.example.com' +
          '&redirect=https://evil.example.com' +
          '&url=https://evil.example.com',
      );

      expect(response.status).toBe(302);
      const location = response.headers.location;
      expect(location.startsWith('https://app.example.com/integracoes?')).toBe(
        true,
      );
      expect(location).not.toContain('evil.example.com');
      expect(location).not.toContain('super-secret-state-value');
      expect(location).not.toContain('super-secret-auth-code');
      expect(location).not.toContain('200000');
    });

    it('query state como array (?state=a&state=b) é rejeitada antes de consumir tentativa ou chamar o cliente', async () => {
      const state = await startConnectionAndGetState();
      shopeeFetch.mockClear();

      const response = await request(app.getHttpServer()).get(
        `/integrations/shopee/callback?state=${state}&state=other&code=c&shop_id=1`,
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );
      expect(shopeeFetch).not.toHaveBeenCalled();

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM oauth_authorization_requests WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].status).toBe('PENDING');
    });

    it('query shop_id como objeto (?shop_id[x]=1) é rejeitada antes de consumir tentativa ou chamar o cliente', async () => {
      const state = await startConnectionAndGetState();
      shopeeFetch.mockClear();

      const response = await request(app.getHttpServer()).get(
        `/integrations/shopee/callback?state=${state}&code=c&shop_id[x]=1`,
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );
      expect(shopeeFetch).not.toHaveBeenCalled();

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM oauth_authorization_requests WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].status).toBe('PENDING');
    });

    it('shop_id decimal inválido (não numérico) é rejeitado antes de consumir a tentativa', async () => {
      const state = await startConnectionAndGetState();
      shopeeFetch.mockClear();

      const response = await request(app.getHttpServer()).get(
        `/integrations/shopee/callback?state=${state}&code=c&shop_id=not-a-number`,
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );
      expect(shopeeFetch).not.toHaveBeenCalled();

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM oauth_authorization_requests WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].status).toBe('PENDING');
    });

    it('query code acima do limite é rejeitada antes de consumir a tentativa', async () => {
      const state = await startConnectionAndGetState();
      shopeeFetch.mockClear();

      const hugeCode = 'c'.repeat(3000);
      const response = await request(app.getHttpServer()).get(
        `/integrations/shopee/callback?state=${state}&code=${hugeCode}&shop_id=1`,
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(
        'https://app.example.com/integracoes?shopee=error&reason=OAUTH_CALLBACK_INVALID',
      );
      expect(shopeeFetch).not.toHaveBeenCalled();

      const rows: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM oauth_authorization_requests WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(rows[0].status).toBe('PENDING');
    });
  });
});
