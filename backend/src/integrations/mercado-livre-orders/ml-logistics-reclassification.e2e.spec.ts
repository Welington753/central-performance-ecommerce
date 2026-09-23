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
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { MlLogisticsReclassificationController } from './ml-logistics-reclassification.controller';
import { MlLogisticsReclassificationJobsPersistenceService } from './ml-logistics-reclassification-jobs-persistence.service';
import { MlLogisticsReclassificationService } from './ml-logistics-reclassification.service';

/**
 * Fronteira HTTP REAL (revisão crítica pós-implementação, itens 4 e 5) —
 * `INestApplication` + `supertest` contra um Postgres real, não só metadata
 * de decorator. Módulo de teste MÍNIMO (não o `MercadoLivreOrdersModule`
 * inteiro): a orquestração testada aqui
 * (`MlLogisticsReclassificationService`) nunca depende de
 * `MercadoLivreLogisticsReclassificationService`/OAuth/HTTP — só o worker
 * (fora desta fronteira HTTP) depende disso. Evita toda a máquina de OAuth
 * só para provar guard/rotas/isolamento.
 *
 * Item 4 ("isolamento entre usuários"): este projeto NÃO tem ownership de
 * `marketplace_accounts` por usuário — confirmado por auditoria do código
 * (nenhum `userId`/`ownerId` em `marketplace_accounts`, nenhum
 * RBAC/`canAccess` em lugar nenhum do backend). É um sistema interno de UMA
 * organização (`AccessTokenGuard` = "usuário interno autenticado", igual a
 * TODOS os outros endpoints por conta já existentes, incluindo
 * `MarketplaceBackfillController`, nunca introduzido por esta correção). O
 * isolamento que EXISTE e É testado abaixo: (a) autenticação obrigatória,
 * (b) fronteira de marketplace (`:id` precisa ser uma conta Mercado Livre
 * real — uma conta Shopee/Amazon ou um UUID inexistente é sempre rejeitado),
 * (c) nenhuma resposta expõe token/shipment/pedido.
 */
describe('MlLogisticsReclassificationController — fronteira HTTP real (Postgres real)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let mlAccountId: string;
  let shopeeAccountId: string;
  let userId: string;

  const FRONTEND_URL = 'https://app.example.com';
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
              FRONTEND_URL,
              ACCESS_TOKEN_SECRET,
              ACCESS_TOKEN_TTL_SECONDS: 900,
              CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
              // Item 6 (revisão crítica): a maioria destes testes exercita o
              // caminho normal (worker ligado) — o caminho "desligado" tem
              // sua PRÓPRIA instância de app abaixo (`describe('workerEnabled
              // = false ...')`), nunca misturado com este.
              ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'true',
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
      ],
      controllers: [MlLogisticsReclassificationController],
      providers: [
        MlLogisticsReclassificationJobsPersistenceService,
        MlLogisticsReclassificationService,
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
    await dataSource.query(
      'TRUNCATE TABLE ml_logistics_reclassification_jobs CASCADE',
    );
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    mlAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status, nickname) VALUES ($1, 'MERCADO_LIVRE', 'CONNECTED', 'Meli 1')`,
      [mlAccountId],
    );

    shopeeAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status, nickname) VALUES ($1, 'SHOPEE', 'CONNECTED', 'Shopee 1')`,
      [shopeeAccountId],
    );
  });

  function accessTokenCookie(): string {
    const token = jwtService.sign(
      { sub: userId, email: `test-${userId}@example.com` },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    );
    return `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
  }

  describe('autenticação obrigatória', () => {
    it('GET status sem autenticação → 401', async () => {
      const response = await request(app.getHttpServer()).get(
        `/marketplace-accounts/${mlAccountId}/logistics-reclassification/status`,
      );
      expect(response.status).toBe(401);
    });

    it('POST start sem autenticação → 401, nenhum job criado', async () => {
      const response = await request(app.getHttpServer()).post(
        `/marketplace-accounts/${mlAccountId}/logistics-reclassification/start`,
      );
      expect(response.status).toBe(401);
      const rows: Array<{ count: number }> = await dataSource.query(
        'SELECT count(*)::int AS count FROM ml_logistics_reclassification_jobs',
      );
      expect(rows[0].count).toBe(0);
    });

    it('rotas "todas as contas" também exigem autenticação', async () => {
      const response = await request(app.getHttpServer()).get(
        '/marketplace-accounts/mercado-livre/logistics-reclassification/status',
      );
      expect(response.status).toBe(401);
    });
  });

  describe('fronteira de marketplace (isolamento — item 4)', () => {
    it('uma conta Shopee é rejeitada em :id (nunca processa/expõe estado de outro marketplace)', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/marketplace-accounts/${shopeeAccountId}/logistics-reclassification/status`,
        )
        .set('Cookie', accessTokenCookie());
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain(
        'ACCOUNT_NOT_MERCADO_LIVRE',
      );
    });

    it('um accountId inexistente (UUID válido, nenhuma conta) → 404, nunca um estado inventado', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/marketplace-accounts/${randomUUID()}/logistics-reclassification/status`,
        )
        .set('Cookie', accessTokenCookie());
      expect(response.status).toBe(404);
    });

    it('um accountId que não é UUID → 400 de validação, nunca cai na rota "todas as contas"', async () => {
      const response = await request(app.getHttpServer())
        .get(
          '/marketplace-accounts/not-a-uuid/logistics-reclassification/status',
        )
        .set('Cookie', accessTokenCookie());
      expect(response.status).toBe(400);
    });
  });

  describe('resolução de rotas — /mercado-livre/logistics-reclassification/* nunca é capturada por /:id/logistics-reclassification/* (item 5)', () => {
    it('GET .../mercado-livre/logistics-reclassification/status devolve uma LISTA (statusAll), nunca um erro de validação de UUID', async () => {
      const response = await request(app.getHttpServer())
        .get(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/status',
        )
        .set('Cookie', accessTokenCookie());

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      // Só a conta Mercado Livre aparece — a Shopee nunca entra na lista.
      const accountIds = (response.body as Array<{ accountId: string }>).map(
        (s) => s.accountId,
      );
      expect(accountIds).toContain(mlAccountId);
      expect(accountIds).not.toContain(shopeeAccountId);
    });

    it('POST .../mercado-livre/logistics-reclassification/start devolve uma LISTA (startAll), nunca tenta criar um job para o literal "mercado-livre" como accountId', async () => {
      const response = await request(app.getHttpServer())
        .post(
          '/marketplace-accounts/mercado-livre/logistics-reclassification/start',
        )
        .set('Cookie', accessTokenCookie());

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      const rows = await dataSource.query<
        Array<{ marketplace_account_id: string }>
      >(
        'SELECT marketplace_account_id FROM ml_logistics_reclassification_jobs',
      );
      // Exatamente um job foi criado — para a conta ML real, nunca para
      // "mercado-livre" (que nem é um UUID válido).
      expect(rows).toHaveLength(1);
      expect(rows[0].marketplace_account_id).toBe(mlAccountId);
    });

    it('GET .../:id/logistics-reclassification/status para a conta ML real continua funcionando normalmente', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/marketplace-accounts/${mlAccountId}/logistics-reclassification/status`,
        )
        .set('Cookie', accessTokenCookie());
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        accountId: mlAccountId,
        status: 'IDLE',
      });
    });
  });

  describe('nenhuma resposta expõe segredo/identificador interno', () => {
    it('status/start nunca incluem token, shipment id, order id ou qualquer campo bruto do provedor', async () => {
      const startResponse = await request(app.getHttpServer())
        .post(
          `/marketplace-accounts/${mlAccountId}/logistics-reclassification/start`,
        )
        .set('Cookie', accessTokenCookie());
      expect(startResponse.status).toBe(200);

      const statusResponse = await request(app.getHttpServer())
        .get(
          `/marketplace-accounts/${mlAccountId}/logistics-reclassification/status`,
        )
        .set('Cookie', accessTokenCookie());

      for (const body of [startResponse.body, statusResponse.body]) {
        const serialized = JSON.stringify(body);
        expect(serialized).not.toMatch(
          /token|shipment|external_order|externalOrderId|externalShipmentId/i,
        );
      }
    });

    it('status sempre devolve workerEnabled — o frontend nunca precisa adivinhar', async () => {
      const response = await request(app.getHttpServer())
        .get(
          `/marketplace-accounts/${mlAccountId}/logistics-reclassification/status`,
        )
        .set('Cookie', accessTokenCookie());
      expect(response.body).toMatchObject({ workerEnabled: true });
    });
  });
});

/**
 * Item 6 (revisão crítica) — instância de app SEPARADA, com
 * `ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED=false`: prova end-to-end
 * que `start`/`resume` FALHAM com um erro de domínio claro (nunca criam uma
 * linha que o worker nunca reivindicaria) e que `status` reflete
 * `workerEnabled: false` para o frontend desabilitar os botões.
 */
describe('MlLogisticsReclassificationController — workerEnabled = false (Postgres real)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let mlAccountId: string;
  let userId: string;

  const FRONTEND_URL = 'https://app.example.com';
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
              FRONTEND_URL,
              ACCESS_TOKEN_SECRET,
              ACCESS_TOKEN_TTL_SECONDS: 900,
              CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
              ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'false',
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
      ],
      controllers: [MlLogisticsReclassificationController],
      providers: [
        MlLogisticsReclassificationJobsPersistenceService,
        MlLogisticsReclassificationService,
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
    await dataSource.query(
      'TRUNCATE TABLE ml_logistics_reclassification_jobs CASCADE',
    );
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    mlAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status, nickname) VALUES ($1, 'MERCADO_LIVRE', 'CONNECTED', 'Meli 1')`,
      [mlAccountId],
    );
  });

  function accessTokenCookie(): string {
    const token = jwtService.sign(
      { sub: userId, email: `test-${userId}@example.com` },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    );
    return `${ACCESS_TOKEN_COOKIE_NAME}=${token}`;
  }

  it('status devolve workerEnabled: false', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/marketplace-accounts/${mlAccountId}/logistics-reclassification/status`,
      )
      .set('Cookie', accessTokenCookie());
    expect(response.body).toMatchObject({
      workerEnabled: false,
      status: 'IDLE',
    });
  });

  it('start FALHA com WORKER_DISABLED — nunca cria uma linha que o worker nunca reivindicaria', async () => {
    const response = await request(app.getHttpServer())
      .post(
        `/marketplace-accounts/${mlAccountId}/logistics-reclassification/start`,
      )
      .set('Cookie', accessTokenCookie());
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('WORKER_DISABLED');

    const rows: Array<{ count: number }> = await dataSource.query(
      'SELECT count(*)::int AS count FROM ml_logistics_reclassification_jobs',
    );
    expect(rows[0].count).toBe(0);
  });

  it('resume FALHA com WORKER_DISABLED sobre um job PAUSED existente', async () => {
    await dataSource.query(
      `INSERT INTO ml_logistics_reclassification_jobs
          (marketplace_account_id, status, initial_unknown_count, remaining_unknown_count)
        VALUES ($1, 'PAUSED', 10, 10)`,
      [mlAccountId],
    );
    const response = await request(app.getHttpServer())
      .post(
        `/marketplace-accounts/${mlAccountId}/logistics-reclassification/resume`,
      )
      .set('Cookie', accessTokenCookie());
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('WORKER_DISABLED');

    const rows = await dataSource.query<Array<{ status: string }>>(
      'SELECT status FROM ml_logistics_reclassification_jobs WHERE marketplace_account_id = $1',
      [mlAccountId],
    );
    expect(rows[0].status).toBe('PAUSED');
  });

  it('pause NUNCA é bloqueada por workerEnabled = false — pausar é sempre seguro', async () => {
    await dataSource.query(
      `INSERT INTO ml_logistics_reclassification_jobs
          (marketplace_account_id, status, initial_unknown_count, remaining_unknown_count)
        VALUES ($1, 'RUNNING', 10, 10)`,
      [mlAccountId],
    );
    const response = await request(app.getHttpServer())
      .post(
        `/marketplace-accounts/${mlAccountId}/logistics-reclassification/pause`,
      )
      .set('Cookie', accessTokenCookie());
    expect(response.status).toBe(200);
  });
});
