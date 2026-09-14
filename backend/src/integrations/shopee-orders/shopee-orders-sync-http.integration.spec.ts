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
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { SHOPEE_FETCH } from '../shopee-oauth/shopee-http.client';
import {
  jsonResponse,
  validOrderDetailOrder,
} from './shopee-orders-api.client.test-helpers';
import { ShopeeOrdersModule } from './shopee-orders.module';

const ORDER_SN = '2404098R48U37H';

function orderListBody(orderSns: string[] = [ORDER_SN]) {
  return {
    error: '',
    message: '',
    request_id: 'req-list-1',
    response: {
      more: false,
      next_cursor: '',
      order_list: orderSns.map((order_sn) => ({ order_sn })),
    },
  };
}

function orderDetailBody(orderSns: string[] = [ORDER_SN]) {
  return {
    error: '',
    message: '',
    request_id: 'req-detail-1',
    response: {
      order_list: orderSns.map((order_sn) =>
        validOrderDetailOrder({ order_sn }),
      ),
    },
  };
}

/**
 * Checkpoint CP2K-3B — fronteira HTTP REAL de
 * `POST /marketplace-accounts/:id/shopee/sync-orders`, via `INestApplication`
 * + `supertest` contra PostgreSQL 16 real. Mesmo padrão de
 * `shopee-shop-http.integration.spec.ts` (Checkpoint CP2J): `SHOPEE_FETCH` é
 * SEMPRE o mock injetado — nenhum teste aqui chama a Shopee real.
 */
describe('POST /marketplace-accounts/:id/shopee/sync-orders — fronteira HTTP real (Postgres real, Checkpoint CP2K-3B)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let encryptionService: EncryptionService;
  let shopeeFetch: jest.Mock;
  let accountId: string;
  let userId: string;

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
              FRONTEND_URL: 'https://app.example.com',
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
        MarketplaceAccountsModule,
        MarketplaceOrdersModule,
        ShopeeOrdersModule,
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
    await dataSource.query(
      'TRUNCATE TABLE marketplace_order_items, marketplace_orders, sync_runs CASCADE',
    );
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    shopeeFetch.mockReset();
    shopeeFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v2/order/get_order_list')) {
        return Promise.resolve(jsonResponse(200, orderListBody()));
      }
      if (url.includes('/api/v2/order/get_order_detail')) {
        return Promise.resolve(jsonResponse(200, orderDetailBody()));
      }
      throw new Error(`SHOPEE_FETCH chamado com URL inesperada: ${url}`);
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

  async function insertConnectedAccount(): Promise<void> {
    await dataSource.query(
      `INSERT INTO marketplace_accounts
         (id, marketplace, status, external_seller_id, encrypted_access_token,
          encrypted_refresh_token, token_expires_at, token_version)
       VALUES ($1, 'SHOPEE', 'CONNECTED', $2, $3, $4, $5, 0)`,
      [
        accountId,
        '555444333',
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

  async function insertRunningSyncRun(): Promise<void> {
    await dataSource.query(
      `INSERT INTO sync_runs
         (marketplace_account_id, marketplace, type, status, started_at, date_from, date_to)
       VALUES ($1, 'SHOPEE', 'MANUAL', 'RUNNING', now(), now(), now())`,
      [accountId],
    );
  }

  function route(id: string = accountId): string {
    return `/marketplace-accounts/${id}/shopee/sync-orders`;
  }

  it('sem cookie → 401, nenhuma chamada externa', async () => {
    await insertConnectedAccount();
    const response = await request(app.getHttpServer()).post(route());

    expect(response.status).toBe(401);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('UUID inválido → 400, nenhuma chamada externa', async () => {
    const response = await request(app.getHttpServer())
      .post(route('not-a-uuid'))
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(400);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('UUID v1 (sintaticamente válido, versão errada) → 400', async () => {
    const uuidV1 = '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d';
    const response = await request(app.getHttpServer())
      .post(route(uuidV1))
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(400);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('conta inexistente → 404, nenhuma chamada externa', async () => {
    const response = await request(app.getHttpServer())
      .post(route(randomUUID()))
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(404);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('conta de outro marketplace → 404 (mesmo padrão de shop-info)', async () => {
    await insertAccount('MERCADO_LIVRE', 'DISCONNECTED');
    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(404);
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('conta Shopee desconectada → 409 NOT_CONNECTED, nenhuma chamada externa', async () => {
    await insertAccount('SHOPEE', 'DISCONNECTED');
    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(409);
    expect((response.body as { message: string }).message).toBe(
      'NOT_CONNECTED',
    );
    expect(shopeeFetch).not.toHaveBeenCalled();
  });

  it('execução já em andamento (RUNNING) → 409 SYNC_ALREADY_RUNNING', async () => {
    await insertConnectedAccount();
    await insertRunningSyncRun();

    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(409);
    expect((response.body as { message: string }).message).toBe(
      'SYNC_ALREADY_RUNNING',
    );
  });

  it('sucesso: 200, status SUCCESS, contagens corretas, pedido e item persistidos no Postgres', async () => {
    await insertConnectedAccount();

    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    const body = response.body as {
      status: string;
      ordersFetched: number;
      ordersCreated: number;
      itemsPersisted: number;
      syncRunId: string;
    };
    expect(body.status).toBe('SUCCESS');
    expect(body.ordersFetched).toBe(1);
    expect(body.ordersCreated).toBe(1);
    expect(body.itemsPersisted).toBe(1);

    const orderRows = await dataSource.query<
      Array<{ external_order_id: string; status: string }>
    >(
      `SELECT external_order_id, status FROM marketplace_orders WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].external_order_id).toBe(ORDER_SN);

    const syncRunRows = await dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM sync_runs WHERE id = $1`,
      [body.syncRunId],
    );
    expect(syncRunRows[0].status).toBe('SUCCESS');

    const accountRows = await dataSource.query<
      Array<{ last_successful_sync_at: Date | null }>
    >(
      `SELECT last_successful_sync_at FROM marketplace_accounts WHERE id = $1`,
      [accountId],
    );
    expect(accountRows[0].last_successful_sync_at).not.toBeNull();
  });

  it('repetição idempotente: segunda chamada atualiza o mesmo pedido, nunca duplica', async () => {
    await insertConnectedAccount();

    const first = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());
    expect(second.status).toBe(200);
    expect((second.body as { ordersUpdated: number }).ordersUpdated).toBe(1);

    const orderRows = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM marketplace_orders WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(orderRows).toHaveLength(1);
  });

  it('falha externa (rede) → 503, SyncRun termina em estado terminal (FAILED), nenhum pedido persistido', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v2/order/get_order_list')) {
        return Promise.reject(new Error('ECONNRESET'));
      }
      throw new Error(`inesperado: ${url}`);
    });

    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(503);
    expect((response.body as { message: string }).message).toBe(
      'TEMPORARILY_UNAVAILABLE',
    );

    const syncRunRows = await dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM sync_runs WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(syncRunRows).toHaveLength(1);
    expect(syncRunRows[0].status).not.toBe('RUNNING');

    const orderRows = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM marketplace_orders WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(orderRows).toHaveLength(0);
  });

  it('resposta pública nunca contém credenciais, Partner Key ou PII', async () => {
    await insertConnectedAccount();
    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(PARTNER_KEY);
    expect(serialized).not.toContain('current-access-token');
    expect(serialized).not.toContain('current-refresh-token');
    expect(serialized).not.toMatch(/[0-9a-f]{64}/);
  });

  it('mensagem maliciosa/bruta do mock nunca aparece na resposta de erro', async () => {
    await insertConnectedAccount();
    const maliciousMessage = '<script>alert(document.cookie)</script>';
    shopeeFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v2/order/get_order_list')) {
        return Promise.resolve(
          jsonResponse(200, {
            error: 'error_server',
            message: maliciousMessage,
          }),
        );
      }
      throw new Error(`inesperado: ${url}`);
    });

    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(JSON.stringify(response.body)).not.toContain(maliciousMessage);
    expect(JSON.stringify(response.body)).not.toContain('<script>');
  });
});
