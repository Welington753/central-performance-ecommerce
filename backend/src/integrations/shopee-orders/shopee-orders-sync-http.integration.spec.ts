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
import { MarketplaceOrdersPersistenceService } from '../marketplace-orders/marketplace-orders-persistence.service';
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
  let persistence: MarketplaceOrdersPersistenceService;
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
    persistence = app.get(MarketplaceOrdersPersistenceService);
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

  /**
   * Checkpoint CP2K-5C-3 — fronteira HTTP real para PARTIAL via
   * `finalizeSyncRunPartial`, distinguindo os dois blocos de 15 dias da
   * janela inicial de 60 dias (`computeInitialSyncWindow`/
   * `splitShopeeSyncWindowIntoBlocks`) pelo `time_from`/`time_to` da query
   * string real enviada a `SHOPEE_FETCH` — nunca pela ordem de chamada.
   */
  function parseTimeRange(url: string): { timeFrom: number; timeTo: number } {
    const parsed = new URL(url);
    return {
      timeFrom: Number(parsed.searchParams.get('time_from')),
      timeTo: Number(parsed.searchParams.get('time_to')),
    };
  }

  it('cap SEM fronteira (primeiro bloco nunca termina): PARTIAL com covered_through NULL, resposta 200 INCOMPLETE, nenhum pedido persistido não coletado', async () => {
    await insertConnectedAccount();
    // `next_cursor` fixo e repetido em `more: true` — ciclo de cursor
    // detectado por `fetchShopeeOrderSns` (`shopee-orders-fetch.util.ts`)
    // após a 2ª chamada com o MESMO cursor, nunca reenvia a mesma página em
    // loop. Nenhum bloco termina naturalmente aqui, então nenhuma fronteira
    // é provada (`completedThroughSeconds: null`).
    shopeeFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v2/order/get_order_list')) {
        return Promise.resolve(
          jsonResponse(200, {
            error: '',
            message: '',
            request_id: 'req-list-1',
            response: {
              more: true,
              next_cursor: 'cursor-fixo',
              order_list: [{ order_sn: ORDER_SN }],
            },
          }),
        );
      }
      if (url.includes('/api/v2/order/get_order_detail')) {
        return Promise.resolve(jsonResponse(200, orderDetailBody()));
      }
      throw new Error(`SHOPEE_FETCH chamado com URL inesperada: ${url}`);
    });

    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    const body = response.body as { status: string; syncRunId: string };
    expect(body.status).toBe('INCOMPLETE');

    const syncRunRows = await dataSource.query<
      Array<{
        status: string;
        covered_through: Date | null;
        error_code: string;
      }>
    >(
      `SELECT status, covered_through, error_code FROM sync_runs WHERE id = $1`,
      [body.syncRunId],
    );
    expect(syncRunRows[0].status).toBe('PARTIAL');
    expect(syncRunRows[0].covered_through).toBeNull();
    expect(syncRunRows[0].error_code).toBe('SHOPEE_SAFETY_CAP_REACHED');

    const accountRows = await dataSource.query<
      Array<{ last_successful_sync_at: Date | null }>
    >(
      `SELECT last_successful_sync_at FROM marketplace_accounts WHERE id = $1`,
      [accountId],
    );
    expect(accountRows[0].last_successful_sync_at).toBeNull();
  });

  it('cap COM fronteira (primeiro bloco de 15 dias termina normalmente, segundo é capado): PARTIAL com covered_through = fim do primeiro bloco', async () => {
    await insertConnectedAccount();
    let firstBlockTimeTo: number | null = null;

    shopeeFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v2/order/get_order_list')) {
        const { timeFrom, timeTo } = parseTimeRange(url);
        if (firstBlockTimeTo === null) {
          firstBlockTimeTo = timeTo;
          return Promise.resolve(jsonResponse(200, orderListBody([ORDER_SN])));
        }
        if (timeFrom === firstBlockTimeTo - 1) {
          // Cursor fixo repetido no 2º bloco — mesmo mecanismo de detecção
          // de ciclo do teste anterior, nunca `next_cursor: ''` (rejeitado
          // como `invalid_response` pelo cliente quando `more: true`).
          return Promise.resolve(
            jsonResponse(200, {
              error: '',
              message: '',
              request_id: 'req-list-2',
              response: {
                more: true,
                next_cursor: 'cursor-fixo-bloco-2',
                order_list: [{ order_sn: '2404098R48U38X' }],
              },
            }),
          );
        }
        throw new Error(`bloco inesperado nesta janela: ${url}`);
      }
      if (url.includes('/api/v2/order/get_order_detail')) {
        return Promise.resolve(
          jsonResponse(200, {
            error: '',
            message: '',
            request_id: 'req-detail-1',
            response: {
              order_list: [
                validOrderDetailOrder({ order_sn: ORDER_SN }),
                validOrderDetailOrder({ order_sn: '2404098R48U38X' }),
              ],
            },
          }),
        );
      }
      throw new Error(`SHOPEE_FETCH chamado com URL inesperada: ${url}`);
    });

    const response = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    const body = response.body as { status: string; syncRunId: string };
    expect(body.status).toBe('INCOMPLETE');
    expect(firstBlockTimeTo).not.toBeNull();

    const syncRunRows = await dataSource.query<
      Array<{ status: string; covered_through: Date | null }>
    >(`SELECT status, covered_through FROM sync_runs WHERE id = $1`, [
      body.syncRunId,
    ]);
    expect(syncRunRows[0].status).toBe('PARTIAL');
    expect(syncRunRows[0].covered_through).not.toBeNull();
    expect(
      Math.floor((syncRunRows[0].covered_through as Date).getTime() / 1000),
    ).toBe(firstBlockTimeTo);

    const orderRows = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM marketplace_orders WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(orderRows).toHaveLength(2);
  });

  it('duas execuções PARTIAL sem fronteira consecutivas: periodFrom não avança, nenhuma cobertura falsa é criada', async () => {
    await insertConnectedAccount();
    shopeeFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v2/order/get_order_list')) {
        return Promise.resolve(
          jsonResponse(200, {
            error: '',
            message: '',
            request_id: 'req-list-1',
            response: {
              more: true,
              next_cursor: 'cursor-fixo',
              order_list: [{ order_sn: ORDER_SN }],
            },
          }),
        );
      }
      if (url.includes('/api/v2/order/get_order_detail')) {
        return Promise.resolve(jsonResponse(200, orderDetailBody()));
      }
      throw new Error(`SHOPEE_FETCH chamado com URL inesperada: ${url}`);
    });

    const first = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());
    expect(first.status).toBe(200);
    expect((first.body as { status: string }).status).toBe('INCOMPLETE');

    const second = await request(app.getHttpServer())
      .post(route())
      .set('Cookie', accessTokenCookie());
    expect(second.status).toBe(200);
    expect((second.body as { status: string }).status).toBe('INCOMPLETE');

    const syncRunRows = await dataSource.query<
      Array<{ status: string; date_from: Date; covered_through: Date | null }>
    >(
      `SELECT status, date_from, covered_through FROM sync_runs
         WHERE marketplace_account_id = $1 ORDER BY started_at ASC`,
      [accountId],
    );
    expect(syncRunRows).toHaveLength(2);
    expect(syncRunRows[0].status).toBe('PARTIAL');
    expect(syncRunRows[1].status).toBe('PARTIAL');
    expect(syncRunRows[0].covered_through).toBeNull();
    expect(syncRunRows[1].covered_through).toBeNull();
    // Nenhum run PARTIAL sem `covered_through` contribui cobertura, então a
    // segunda tentativa recalcula a MESMA janela inicial de 60 dias — o
    // `date_from` das duas execuções é o mesmo instante (a menos de
    // milissegundos de execução do teste).
    expect(
      Math.abs(
        syncRunRows[0].date_from.getTime() - syncRunRows[1].date_from.getTime(),
      ),
    ).toBeLessThan(5000);
  });

  /**
   * Checkpoint CP2K-5C-3-R1 — prova de CONVERGÊNCIA (não só um avanço
   * isolado): três execuções reais, relógio controlado via
   * `jest.useFakeTimers` (nunca `Date.now()` real — resultado determinístico
   * mesmo sob CI lento), cada uma completando o 1º bloco de 15 dias
   * (`more: false`) e capando no 2º via ciclo de cursor (nunca
   * `next_cursor: ''`, que o cliente rejeita como `invalid_response` quando
   * `more: true`). Só o timer `Date` é congelado — `setTimeout`/`setInterval`
   * etc. continuam reais, para não quebrar o driver `pg`/HTTP do Nest.
   */
  it('três execuções PARTIAL consecutivas convergem: periodFrom e covered_through avançam monotonicamente, cobertura funde num único intervalo contínuo, nunca SUCCESS sintético', async () => {
    await insertConnectedAccount();

    const CAP_ORDER_SN = '2404098R48U39Y';
    let sawFirstBlockThisRun = false;

    shopeeFetch.mockImplementation((url: string) => {
      if (url.includes('/api/v2/order/get_order_list')) {
        if (!sawFirstBlockThisRun) {
          sawFirstBlockThisRun = true;
          return Promise.resolve(jsonResponse(200, orderListBody([ORDER_SN])));
        }
        // Mesmo cursor fixo em toda chamada seguinte — a 2ª chamada com
        // este cursor já é reconhecida como ciclo por `fetchShopeeOrderSns`
        // e capa ali, então nunca importa quantas chamadas restantes
        // existiriam nesse bloco.
        return Promise.resolve(
          jsonResponse(200, {
            error: '',
            message: '',
            request_id: 'req-list-cap',
            response: {
              more: true,
              next_cursor: 'cursor-fixo',
              order_list: [{ order_sn: CAP_ORDER_SN }],
            },
          }),
        );
      }
      if (url.includes('/api/v2/order/get_order_detail')) {
        const parsed = new URL(url);
        const orderSnList = (parsed.searchParams.get('order_sn_list') ?? '')
          .split(',')
          .filter((sn) => sn !== '');
        return Promise.resolve(
          jsonResponse(200, {
            error: '',
            message: '',
            request_id: 'req-detail-cap',
            response: {
              order_list: orderSnList.map((order_sn) =>
                validOrderDetailOrder({ order_sn }),
              ),
            },
          }),
        );
      }
      throw new Error(`SHOPEE_FETCH chamado com URL inesperada: ${url}`);
    });

    const BASE_TIME = Date.UTC(2024, 0, 1, 0, 0, 0);
    const DAY_MS = 24 * 60 * 60 * 1000;

    jest.useFakeTimers({
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    try {
      jest.setSystemTime(BASE_TIME);
      sawFirstBlockThisRun = false;
      const first = await request(app.getHttpServer())
        .post(route())
        .set('Cookie', accessTokenCookie());
      expect(first.status).toBe(200);
      expect((first.body as { status: string }).status).toBe('INCOMPLETE');

      // Salto grande o suficiente para garantir uma janela incremental com
      // mais de 15 dias em toda execução seguinte — nunca depende do valor
      // exato de `covered_through` da execução anterior.
      jest.setSystemTime(BASE_TIME + 200 * DAY_MS);
      sawFirstBlockThisRun = false;
      const second = await request(app.getHttpServer())
        .post(route())
        .set('Cookie', accessTokenCookie());
      expect(second.status).toBe(200);
      expect((second.body as { status: string }).status).toBe('INCOMPLETE');

      jest.setSystemTime(BASE_TIME + 400 * DAY_MS);
      sawFirstBlockThisRun = false;
      const third = await request(app.getHttpServer())
        .post(route())
        .set('Cookie', accessTokenCookie());
      expect(third.status).toBe(200);
      expect((third.body as { status: string }).status).toBe('INCOMPLETE');
    } finally {
      jest.useRealTimers();
    }

    const syncRunRows = await dataSource.query<
      Array<{
        status: string;
        date_from: Date;
        date_to: Date;
        covered_through: Date | null;
      }>
    >(
      `SELECT status, date_from, date_to, covered_through FROM sync_runs
         WHERE marketplace_account_id = $1 ORDER BY started_at ASC`,
      [accountId],
    );

    // Exatamente uma linha por execução — nunca uma linha SUCCESS sintética
    // adicional (decisão explícita do Checkpoint CP2K-5C-R1).
    expect(syncRunRows).toHaveLength(3);
    for (const row of syncRunRows) {
      expect(row.status).toBe('PARTIAL');
      expect(row.covered_through).not.toBeNull();
    }

    const [run1, run2, run3] = syncRunRows;

    expect(run2.date_from.getTime()).toBeGreaterThan(run1.date_from.getTime());
    expect(run3.date_from.getTime()).toBeGreaterThan(run2.date_from.getTime());

    const coveredThrough1 = (run1.covered_through as Date).getTime();
    const coveredThrough2 = (run2.covered_through as Date).getTime();
    const coveredThrough3 = (run3.covered_through as Date).getTime();
    expect(coveredThrough2).toBeGreaterThan(coveredThrough1);
    expect(coveredThrough3).toBeGreaterThan(coveredThrough2);

    // Nenhum `covered_through` alcança a janela REQUISITADA (`date_to`) da
    // própria execução — o bloco interrompido nunca é contado como coberto.
    for (const row of syncRunRows) {
      expect((row.covered_through as Date).getTime()).toBeLessThan(
        row.date_to.getTime(),
      );
    }

    const coverage = await persistence.getAccountSyncCoverage(accountId);
    // As três execuções PARTIAL se fundem num ÚNICO intervalo contínuo — a
    // sobreposição de 1 dia entre o `covered_through` de uma execução e o
    // `periodFrom` (`date_from`) da seguinte (`computeIncrementalSyncWindow`)
    // garante que nunca há buraco.
    expect(coverage.intervals).toHaveLength(1);
    expect(coverage.intervals[0].from.getTime()).toBe(run1.date_from.getTime());
    expect(coverage.intervals[0].to.getTime()).toBe(coveredThrough3);
    // `oldestRunRecordsRead` continua exclusivo de SUCCESS — nenhum PARTIAL
    // (mesmo com 3 delas) o preenche.
    expect(coverage.oldestRunRecordsRead).toBeNull();

    const orderRows = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM marketplace_orders WHERE marketplace_account_id = $1`,
      [accountId],
    );
    // Cada execução persiste o pedido do bloco 1 completo + o pedido
    // coletado antes do cap no bloco 2 — 2 pedidos por execução, mas o
    // `order_sn` do bloco 1 é sempre o mesmo (`ORDER_SN`), então atualiza em
    // vez de duplicar; só o `order_sn` de cap muda a cada execução (mesmo
    // texto fixo aqui, sobrescrito) — nunca mais que 2 linhas distintas.
    expect(orderRows.length).toBeLessThanOrEqual(2);
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
