import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
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
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import { MarketplaceProblemsModule } from './marketplace-problems.module';
import type { UpsertProblemInput } from './mercado-livre-claim-to-problem.mapper';

type Row = Record<string, unknown>;
const ACCESS_TOKEN_SECRET = 'x'.repeat(32);

/**
 * HTTP REAL de ponta a ponta de "Problemas": `AccessTokenGuard`,
 * `PermissionGuard`, resolução de permissões/escopo e queries REAIS contra
 * PostgreSQL 16 descartável, com JWT real por usuário. Nenhuma chamada
 * externa: `ML_FETCH` e o `fetch` global falham o teste se forem chamados.
 */
describe('MarketplaceProblemsController — HTTP real (Postgres)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwtService: JwtService;
  const fetchMock = jest.fn(() => {
    throw new Error('Chamada externa proibida neste teste.');
  });
  const http = () => app.getHttpServer() as Parameters<typeof request>[0];

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
              CREDENTIAL_ENCRYPTION_KEY:
                '3132333435363738393031323334353637383930313233343536373839303a3b',
              ML_CLIENT_ID: 'app-id',
              ML_CLIENT_SECRET: 'app-secret',
              ML_REDIRECT_URI: 'https://api.example.com/cb',
            }),
          ],
        }),
        ScheduleModule.forRoot(),
        TypeOrmModule.forRootAsync({
          useFactory: () =>
            buildDataSourceOptions({
              databaseUrl: requireTestDatabaseUrl(),
              nodeEnv: 'test',
            }),
        }),
        CommonModule,
        AuthModule,
        MarketplaceProblemsModule,
      ],
    })
      .overrideProvider(ML_FETCH)
      .useValue(fetchMock)
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
    await dataSource.runMigrations();
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    // Não deixa usuários/contas para trás: outras suítes (ex.: proteção do último
    // administrador) assumem um banco sem admins ativos preexistentes.
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await app.close();
  });

  // ---------------------------------------------------------------- seed
  let accA: string;
  let accB: string;
  let accShopee: string;
  let p1: string;
  let p2: string;
  let p3: string;
  let p4: string;
  let admin: string;
  let analystA: string;
  let analystNone: string;
  let analystSelectedEmpty: string;
  let viewer: string;
  let manager: string;

  async function createUser(
    roleKey: string,
    scope: 'ALL' | 'SELECTED' | 'NONE',
    accountIds: string[] = [],
    grants: string[] = [],
  ): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active, is_admin, role_id, account_scope_mode, must_change_password)
       VALUES ($1, 'Test', $2, 'x', true, false, (SELECT id FROM roles WHERE key = $3), $4, false)`,
      [id, `t-${id}@example.com`, roleKey, scope],
    );
    for (const accountId of accountIds) {
      await dataSource.query(
        `INSERT INTO user_account_scope (user_id, marketplace_account_id) VALUES ($1, $2)`,
        [id, accountId],
      );
    }
    for (const key of grants) {
      await dataSource.query(
        `INSERT INTO user_permission_overrides (user_id, permission_key, granted) VALUES ($1, $2, true)`,
        [id, key],
      );
    }
    return id;
  }

  async function account(
    marketplace: string,
    nickname: string,
  ): Promise<string> {
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, status, token_version)
       VALUES ($1, $2, 'CONNECTED', 0) RETURNING id`,
      [marketplace, nickname],
    );
    return row.id;
  }

  async function problem(
    accountId: string,
    fields: {
      claim: string;
      status?: string;
      reason?: string | null;
      created: string;
      resolved?: boolean;
      impact?: string | null;
      responsibility?: string;
      orderId?: string | null;
      resourceId?: string;
    },
  ): Promise<string> {
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_problems
         (marketplace_account_id, marketplace_order_id, external_claim_id, resource, resource_id, status, type, stage,
          site_id, reason_id, date_created, last_updated, resolution_date, reputation_impact, responsibility,
          detail_title, detail_description)
       VALUES ($1, $2, $3, 'order', $4, $5, 'mediations', 'claim', 'MLB', $6, $7, $7,
               $8, $9, $10, 'Título', 'DESCRIÇÃO COM DADO PESSOAL')
       RETURNING id`,
      [
        accountId,
        fields.orderId ?? null,
        fields.claim,
        fields.resourceId ?? `res-${fields.claim}`,
        fields.status ?? 'opened',
        fields.reason ?? null,
        fields.created,
        fields.resolved ? new Date(fields.created) : null,
        fields.impact ?? null,
        fields.responsibility ?? 'UNKNOWN',
      ],
    );
    return row.id;
  }

  async function action(
    problemId: string,
    role: string,
    code: string,
    dueSql: string,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO marketplace_problem_actions (marketplace_problem_id, player_role, player_type, action_code, mandatory, due_date)
       VALUES ($1, $2, 'seller', $3, true, ${dueSql})`,
      [problemId, role, code],
    );
  }

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('DELETE FROM marketplace_problem_reasons');
    fetchMock.mockClear();

    accA = await account('MERCADO_LIVRE', 'Conta A');
    accB = await account('MERCADO_LIVRE', 'Conta B');
    accShopee = await account('SHOPEE', 'Loja S');
    await dataSource.query(
      `INSERT INTO marketplace_problem_reasons (marketplace, site_id, reason_id, flow, name, status, fetched_at)
       VALUES ('MERCADO_LIVRE', 'MLB', 'R1', 'mediations', 'Produto não recebido', 'active', now()),
              ('MERCADO_LIVRE', 'MLB', 'R2', 'mediations', 'Produto com defeito', 'active', now())`,
    );
    const [order] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_orders (marketplace_account_id, external_order_id, status, currency_id, total_amount, date_created)
       VALUES ($1, 'ORD-A1', 'paid', 'BRL', 100, now()) RETURNING id`,
      [accA],
    );
    p1 = await problem(accA, {
      claim: 'c1',
      reason: 'R1',
      created: '2026-05-10T15:00:00Z',
      impact: 'affected',
      orderId: order.id,
    });
    await action(p1, 'respondent', 'send_proof', `now() - interval '2 days'`);
    p2 = await problem(accA, {
      claim: 'c2',
      status: 'closed',
      reason: 'R2',
      created: '2026-05-20T15:00:00Z',
      resolved: true,
      impact: 'not_affected',
    });
    p3 = await problem(accA, {
      claim: 'c3',
      reason: 'R1',
      created: '2026-06-05T15:00:00Z',
      impact: 'not_applies',
      responsibility: 'SELLER',
    });
    await action(p3, 'respondent', 'refund', `now() + interval '3 days'`);
    p4 = await problem(accB, {
      claim: 'c4',
      reason: 'R1',
      created: '2026-06-01T15:00:00Z',
    });
    await action(p4, 'complainant', 'open_dispute', `now() + interval '1 day'`);

    admin = await createUser('ADMIN', 'ALL');
    analystA = await createUser('ANALYST', 'SELECTED', [accA]);
    analystNone = await createUser('ANALYST', 'NONE');
    analystSelectedEmpty = await createUser('ANALYST', 'SELECTED', []);
    viewer = await createUser('VIEWER', 'ALL');
    manager = await createUser(
      'ANALYST',
      'SELECTED',
      [accA],
      ['problems.manage', 'problems.sync'],
    );
  });

  const cookieFor = (userId: string): string =>
    `${ACCESS_TOKEN_COOKIE_NAME}=${jwtService.sign(
      { sub: userId, email: `t-${userId}@example.com` },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    )}`;
  const get = (path: string, user: string) =>
    request(http()).get(path).set('Cookie', cookieFor(user));

  // ------------------------------------------------------ 401 / 403
  it('401 sem sessão em todas as rotas', async () => {
    const id = p1;
    const calls: Array<() => request.Test> = [
      () => request(http()).get('/problems'),
      () => request(http()).get('/problems/summary'),
      () => request(http()).get('/problems/reasons'),
      () => request(http()).get('/problems/monthly'),
      () => request(http()).get('/problems/sync/status'),
      () => request(http()).get(`/problems/${id}`),
      () => request(http()).patch(`/problems/${id}/responsibility`).send({}),
      () => request(http()).post(`/problems/sync/accounts/${accA}/start`),
      () => request(http()).post(`/problems/sync/accounts/${accA}/pause`),
      () => request(http()).post(`/problems/sync/accounts/${accA}/resume`),
      () =>
        request(http()).post(
          `/problems/sync/accounts/${accA}/historical/pause`,
        ),
      () =>
        request(http()).post(
          `/problems/sync/accounts/${accA}/historical/resume`,
        ),
    ];
    for (const call of calls) {
      expect((await call()).status).toBe(401);
    }
  });

  it('403: VIEWER sem problems.view; ANALYST sem manage/sync', async () => {
    for (const path of [
      '/problems',
      '/problems/summary',
      '/problems/reasons',
      '/problems/monthly',
      '/problems/sync/status',
      `/problems/${p1}`,
    ]) {
      await get(path, viewer).expect(403);
    }
    await request(http())
      .patch(`/problems/${p1}/responsibility`)
      .set('Cookie', cookieFor(analystA))
      .send({ responsibility: 'SELLER', reason: 'motivo' })
      .expect(403);
    await request(http())
      .post(`/problems/sync/accounts/${accA}/start`)
      .set('Cookie', cookieFor(analystA))
      .expect(403);
  });

  // ------------------------------------------------------ escopo
  it('account scope ALL / SELECTED / NONE / SELECTED vazio aplicado nas queries (lista, resumo, motivos, status)', async () => {
    const total = async (user: string) =>
      (await get('/problems', user).expect(200)).body as {
        total: number;
        items: Array<{ accountId: string }>;
      };
    expect((await total(admin)).total).toBe(4);
    const selected = await total(analystA);
    expect(selected.total).toBe(3);
    expect(new Set(selected.items.map((i) => i.accountId))).toEqual(
      new Set([accA]),
    );
    expect((await total(analystNone)).total).toBe(0);
    expect((await total(analystSelectedEmpty)).total).toBe(0);

    const summary = (u: string) => get('/problems/summary', u).expect(200);
    expect(((await summary(admin)).body as { total: number }).total).toBe(4);
    expect(((await summary(analystA)).body as { total: number }).total).toBe(3);
    expect(((await summary(analystNone)).body as { total: number }).total).toBe(
      0,
    );

    const reasons = async (u: string) =>
      (await get('/problems/reasons', u).expect(200)).body as Array<{
        reasonId: string;
        count: number;
      }>;
    expect((await reasons(admin)).find((r) => r.reasonId === 'R1')?.count).toBe(
      3,
    );
    expect(
      (await reasons(analystA)).find((r) => r.reasonId === 'R1')?.count,
    ).toBe(2);
    expect(await reasons(analystNone)).toEqual([]);

    // accountId de outra conta NÃO fura o escopo (vazio, nunca 403/404 revelador).
    const other = await get(`/problems?accountId=${accB}`, analystA).expect(
      200,
    );
    expect((other.body as { total: number }).total).toBe(0);
  });

  it('detalhe: 404 idêntico para inexistente e para fora do escopo (mesmo status e corpo)', async () => {
    const missing = await get(`/problems/${randomUUID()}`, analystA);
    const outside = await get(`/problems/${p4}`, analystA);
    const none = await get(`/problems/${p1}`, analystNone);
    expect(missing.status).toBe(404);
    expect(outside.status).toBe(404);
    expect(none.status).toBe(404);
    expect(outside.body).toEqual(missing.body);
    expect(none.body).toEqual(missing.body);
    await get('/problems/nao-e-uuid', admin).expect(400);
  });

  // ------------------------------------------------------ filtros
  it('filtros, paginação e ordenação com allowlist', async () => {
    const ids = async (qs: string) =>
      (
        (await get(`/problems?${qs}`, admin).expect(200)).body as {
          items: Array<{ id: string }>;
        }
      ).items.map((i) => i.id);

    expect(await ids('status=closed')).toEqual([p2]);
    expect(await ids('reasonId=R2')).toEqual([p2]);
    expect(await ids('responsibility=SELLER')).toEqual([p3]);
    expect(await ids('reputationImpact=affected')).toEqual([p1]);
    expect(await ids('orderId=ORD-A1')).toEqual([p1]);
    expect(await ids('marketplace=MERCADO_LIVRE&accountId=' + accB)).toEqual([
      p4,
    ]);
    expect(await ids('marketplace=SHOPEE')).toEqual([]);
    expect(await ids('pendingAction=true')).toEqual(
      expect.arrayContaining([p1, p3]),
    );
    expect((await ids('pendingAction=true')).length).toBe(2);
    expect(await ids('actionDue=overdue')).toEqual([p1]);
    expect(await ids('actionDue=next7days')).toEqual([p3]);
    // Período por date_created (dia inclusivo, America/Sao_Paulo).
    expect(await ids('from=2026-05-20&to=2026-06-01')).toEqual(
      expect.arrayContaining([p2, p4]),
    );
    expect((await ids('from=2026-05-20&to=2026-06-01')).length).toBe(2);
    // Ordenação e paginação.
    expect(await ids('sortBy=dateCreated&sortDir=asc')).toEqual([
      p1,
      p2,
      p4,
      p3,
    ]);
    expect(
      await ids('sortBy=dateCreated&sortDir=desc&pageSize=2&page=2'),
    ).toEqual([p2, p1]);
    const page = (await get('/problems?pageSize=2&page=2', admin).expect(200))
      .body as { total: number; totalPages: number; page: number };
    expect(page).toMatchObject({ total: 4, totalPages: 2, page: 2 });
    // Inválidos: 400.
    for (const qs of [
      'sortBy=password',
      'sortDir=sideways',
      'pageSize=101',
      'page=0',
      'from=2026-02-31',
      'accountId=abc',
      'marketplace=OUTRO',
      'segredo=1',
    ]) {
      await get(`/problems?${qs}`, admin).expect(400);
    }
  });

  it('resumo, motivos e lista respeitam EXATAMENTE os mesmos filtros', async () => {
    for (const qs of [
      '',
      'reasonId=R1',
      'status=opened',
      `accountId=${accA}`,
      'from=2026-05-15&to=2026-06-03',
      'pendingAction=true',
    ]) {
      const list = (await get(`/problems?${qs}`, admin).expect(200)).body as {
        total: number;
      };
      const summary = (await get(`/problems/summary?${qs}`, admin).expect(200))
        .body as { total: number; open: number; resolved: number };
      const reasons = (await get(`/problems/reasons?${qs}`, admin).expect(200))
        .body as Array<{ count: number }>;
      expect(summary.total).toBe(list.total);
      expect(summary.open + summary.resolved).toBe(list.total);
      // Todo problema do fixture tem motivo: a soma dos motivos == total.
      expect(reasons.reduce((sum, r) => sum + r.count, 0)).toBe(list.total);
    }
  });

  it('resumo: contagens, responsabilidade, motivos e cobertura por conta', async () => {
    const body = (await get('/problems/summary', admin).expect(200)).body as {
      total: number;
      open: number;
      resolved: number;
      reputationAffected: number;
      pendingAction: number;
      overdueAction: number;
      unknownResponsibility: number;
      byResponsibility: Array<{ responsibility: string; count: number }>;
      topReasons: Array<{ reasonId: string; name: string; count: number }>;
      coverage: Array<{
        accountNickname: string;
        jobStatus: string;
        problemsTotal: number;
      }>;
    };
    expect(body).toMatchObject({
      total: 4,
      open: 3,
      resolved: 1,
      reputationAffected: 1,
      pendingAction: 2,
      overdueAction: 1,
      unknownResponsibility: 3,
    });
    expect(body.byResponsibility).toEqual(
      expect.arrayContaining([
        { responsibility: 'UNKNOWN', count: 3 },
        { responsibility: 'SELLER', count: 1 },
      ]),
    );
    expect(body.topReasons[0]).toMatchObject({
      reasonId: 'R1',
      name: 'Produto não recebido',
      count: 3,
    });
    // Cobertura só de contas Mercado Livre (Shopee fora), job nunca iniciado.
    expect(body.coverage.map((c) => c.accountNickname).sort()).toEqual([
      'Conta A',
      'Conta B',
    ]);
    expect(body.coverage.every((c) => c.jobStatus === 'NOT_STARTED')).toBe(
      true,
    );
  });

  // ------------------------------------------------------ conteúdo
  it('lista: só campos necessários (sem token, payload bruto ou PII)', async () => {
    const res = await get('/problems', admin).expect(200);
    const item = (res.body as { items: Row[] }).items[0];
    expect(Object.keys(item).sort()).toEqual(
      [
        'id',
        'marketplace',
        'accountId',
        'accountNickname',
        'orderExternalId',
        'status',
        'stage',
        'type',
        'reasonId',
        'reasonName',
        'reasonLabel',
        'dateCreated',
        'lastUpdated',
        'resolutionDate',
        'reputationImpact',
        'nextActionCode',
        'nextActionDueDate',
        'pendingActionsCount',
        'responsibility',
        'responsibilityConfidence',
      ].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain(
      'DESCRIÇÃO COM DADO PESSOAL',
    );
  });

  it('motivos: 205+ reasonIds distintos voltam TODOS (sem limite), ordem determinística, % corretos e account scope', async () => {
    // 205 motivos distintos, 1 problema cada, na conta A.
    await dataSource.query(
      `INSERT INTO marketplace_problems
         (marketplace_account_id, external_claim_id, resource, resource_id, status, type, stage,
          site_id, reason_id, date_created, last_updated)
       SELECT $1::uuid, 'ba-' || g, 'order', 'ba-' || g, 'opened', 'mediations', 'claim', 'MLB',
              'bulk_' || lpad(g::text, 3, '0'), now(), now()
         FROM generate_series(0, 204) g`,
      [accA],
    );
    await dataSource.query(
      `INSERT INTO marketplace_problems
         (marketplace_account_id, external_claim_id, resource, resource_id, status, type, stage,
          site_id, reason_id, date_created, last_updated)
       SELECT $1::uuid, 'bb-' || g, 'order', 'bb-' || g, 'opened', 'mediations', 'claim', 'MLB',
              'bulk_000', now(), now()
         FROM generate_series(1, 2) g`,
      [accB],
    );

    type Reason = {
      reasonId: string;
      count: number;
      percentage: number | null;
      byAccount: Array<{ accountId: string; count: number }>;
    };
    const check = (reasons: Reason[], total: number) => {
      const bulkIds = reasons.filter((r) => r.reasonId.startsWith('bulk_'));
      expect(bulkIds).toHaveLength(205);
      expect(new Set(reasons.map((r) => r.reasonId)).size).toBe(reasons.length);
      expect(reasons.map((r) => [r.count, r.reasonId])).toEqual(
        [...reasons]
          .sort(
            (a, b) => b.count - a.count || (a.reasonId < b.reasonId ? -1 : 1),
          )
          .map((r) => [r.count, r.reasonId]),
      );
      for (const r of reasons) {
        expect(r.percentage).toBe(Math.round((r.count / total) * 10000) / 100);
        expect(r.byAccount.reduce((sum, b) => sum + b.count, 0)).toBe(r.count);
      }
    };

    // Admin (ALL): 4 do seed + 205 + 2 = 211 problemas; 207 motivos distintos.
    const all = (await get('/problems/reasons', admin).expect(200))
      .body as Reason[];
    expect(all).toHaveLength(207);
    check(all, 211);
    expect(all.find((r) => r.reasonId === 'bulk_000')).toMatchObject({
      count: 3,
      percentage: 1.42,
    });
    // Resposta idêntica em chamadas repetidas (determinística).
    expect((await get('/problems/reasons', admin).expect(200)).body).toEqual(
      all,
    );

    // Analista da conta A: só enxerga a própria conta (208 problemas, 207 motivos).
    const scoped = (await get('/problems/reasons', analystA).expect(200))
      .body as Reason[];
    expect(scoped).toHaveLength(207);
    check(scoped, 208);
    expect(
      scoped.flatMap((r) => r.byAccount.map((b) => b.accountId)),
    ).not.toContain(accB);
    expect(scoped.find((r) => r.reasonId === 'bulk_000')?.count).toBe(1);
    const none = await get('/problems/reasons', analystNone).expect(200);
    expect(none.body).toEqual([]);
  });

  it('reasonLabel: catálogo central para código conhecido, fallback seguro para desconhecido, null sem motivo; sem top 5', async () => {
    await dataSource.query(
      `INSERT INTO marketplace_problem_reasons (marketplace, site_id, reason_id, flow, name, status, fetched_at)
       VALUES ('MERCADO_LIVRE', 'MLB', 'R3', 'mediations', 'repentant_buyer', 'active', now())`,
    );
    // R3 conhecido (catálogo), 'wei<rd>_code!' sem cache (fallback seguro), sem motivo.
    const known = await problem(accA, {
      claim: 'c5',
      reason: 'R3',
      created: '2026-06-10T15:00:00Z',
    });
    const unknown = await problem(accA, {
      claim: 'c6',
      reason: 'wei<rd>_code!',
      created: '2026-06-11T15:00:00Z',
    });
    const none = await problem(accA, {
      claim: 'c7',
      created: '2026-06-12T15:00:00Z',
    });

    const list = (await get('/problems?pageSize=100', admin).expect(200))
      .body as {
      items: Array<{
        id: string;
        reasonId: string | null;
        reasonLabel: string | null;
      }>;
    };
    const byId = new Map(list.items.map((item) => [item.id, item]));
    expect(byId.get(known)?.reasonLabel).toBe('Arrependimento do comprador');
    expect(byId.get(known)?.reasonId).toBe('R3');
    expect(byId.get(unknown)?.reasonLabel).toBe('Weird code');
    expect(byId.get(none)?.reasonLabel).toBeNull();
    // Detalhe usa o mesmo mapeamento e o escopo continua valendo.
    const detail = (await get(`/problems/${known}`, admin).expect(200))
      .body as { reasonLabel: string };
    expect(detail.reasonLabel).toBe('Arrependimento do comprador');
    await get(`/problems/${known}`, analystNone).expect(404);

    // Distribuição completa (mais de 5 motivos, sem truncar), ordenada por count desc e reasonId.
    for (let i = 0; i < 6; i += 1) {
      await problem(accB, {
        claim: `x${i}`,
        reason: `extra_${i}`,
        created: '2026-06-15T15:00:00Z',
      });
    }
    type Reason = {
      reasonId: string;
      reasonLabel: string;
      count: number;
      percentage: number | null;
      byAccount: Array<{
        accountId: string;
        accountNickname: string | null;
        count: number;
      }>;
    };
    const reasons = (await get('/problems/reasons', admin).expect(200))
      .body as Reason[];
    expect(reasons.length).toBeGreaterThan(5);
    expect(reasons.map((r) => [r.count, r.reasonId])).toEqual(
      [...reasons]
        .sort((a, b) => b.count - a.count || (a.reasonId < b.reasonId ? -1 : 1))
        .map((r) => [r.count, r.reasonId]),
    );
    // 4 do seed + 3 novos + 6 extras = 13 problemas (1 sem motivo): percentual sobre os 13.
    const r1 = reasons.find((r) => r.reasonId === 'R1')!;
    expect(r1.count).toBe(3);
    expect(r1.percentage).toBe(23.08);
    expect(r1.reasonLabel).toMatch(/^[A-Za-z0-9 _-]+$/);
    expect(r1.byAccount).toEqual([
      { accountId: accA, accountNickname: 'Conta A', count: 2 },
      { accountId: accB, accountNickname: 'Conta B', count: 1 },
    ]);
    expect(reasons.find((r) => r.reasonId === 'R3')?.reasonLabel).toBe(
      'Arrependimento do comprador',
    );
    // Account scope: analista A só enxerga a própria conta no breakdown.
    const scoped = (await get('/problems/reasons', analystA).expect(200))
      .body as Reason[];
    expect(
      scoped.flatMap((r) => r.byAccount.map((b) => b.accountId)),
    ).not.toContain(accB);
    expect(scoped.find((r) => r.reasonId.startsWith('extra_'))).toBeUndefined();
    // Retrocompatível: os filtros from/to (America/Sao_Paulo) continuam valendo.
    const june = (
      await get(
        '/problems/reasons?from=2026-06-15&to=2026-06-15',
        admin,
      ).expect(200)
    ).body as Reason[];
    expect(june).toHaveLength(6);
    expect(june.every((r) => r.percentage === 16.67)).toBe(true);
  });

  it('detalhe: core, motivo, detail, impacto, actions e pedido; sem detail_description', async () => {
    const res = await get(`/problems/${p1}`, analystA).expect(200);
    const body = res.body as Row & { actions: Row[]; order: Row | null };
    expect(body).toMatchObject({
      id: p1,
      externalClaimId: 'c1',
      accountNickname: 'Conta A',
      reasonName: 'Produto não recebido',
      reasonFlow: 'mediations',
      detailTitle: 'Título',
      reputationImpact: 'affected',
      orderExternalId: 'ORD-A1',
      order: { externalOrderId: 'ORD-A1', status: 'paid' },
      nextActionCode: 'send_proof',
      pendingActionsCount: 1,
    });
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({
      playerRole: 'respondent',
      actionCode: 'send_proof',
      mandatory: true,
    });
    expect(JSON.stringify(body)).not.toContain('DESCRIÇÃO COM DADO PESSOAL');
    expect(
      (await get(`/problems/${p2}`, admin).expect(200)).body,
    ).toMatchObject({ order: null });
  });

  // ------------------------------------------------------ responsabilidade manual
  describe('PATCH /problems/:id/responsibility', () => {
    const patch = (id: string, user: string, body: unknown) =>
      request(http())
        .patch(`/problems/${id}/responsibility`)
        .set('Cookie', cookieFor(user))
        .send(body as object);

    it('grava atomicamente as 6 colunas e não altera nenhum dado do Mercado Livre', async () => {
      const before = (
        await dataSource.query<Row[]>(
          `SELECT * FROM marketplace_problems WHERE id = $1`,
          [p1],
        )
      )[0];
      const res = await patch(p1, manager, {
        responsibility: 'MARKETPLACE',
        reason: 'Falha da transportadora do ML',
      }).expect(200);
      expect(res.body).toMatchObject({
        responsibility: 'MARKETPLACE',
        responsibilityConfidence: 'MANUAL',
        responsibilitySource: 'MANUAL_USER',
        responsibilityOverrideReason: 'Falha da transportadora do ML',
      });
      const after = (
        await dataSource.query<Row[]>(
          `SELECT * FROM marketplace_problems WHERE id = $1`,
          [p1],
        )
      )[0];
      expect(after).toMatchObject({
        responsibility: 'MARKETPLACE',
        responsibility_confidence: 'MANUAL',
        responsibility_source: 'MANUAL_USER',
        responsibility_overridden_by_user_id: manager,
        responsibility_override_reason: 'Falha da transportadora do ML',
      });
      expect(after.responsibility_overridden_at).toBeInstanceOf(Date);
      const changed = Object.keys(after).filter(
        (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
      );
      expect(changed.sort()).toEqual(
        [
          'responsibility',
          'responsibility_confidence',
          'responsibility_source',
          'responsibility_overridden_by_user_id',
          'responsibility_overridden_at',
          'responsibility_override_reason',
          'updated_at',
        ].sort(),
      );
    });

    it('validação: motivo obrigatório, categoria fechada (UNKNOWN e inválidas rejeitadas), campos extras', async () => {
      for (const body of [
        { responsibility: 'SELLER' },
        { responsibility: 'SELLER', reason: '  ' },
        { responsibility: 'SELLER', reason: 'x'.repeat(501) },
        { responsibility: 'UNKNOWN', reason: 'motivo válido' },
        { responsibility: 'NINGUEM', reason: 'motivo válido' },
        { responsibility: 'SELLER', reason: 'motivo válido', extra: 1 },
      ]) {
        await patch(p1, manager, body).expect(400);
      }
      const row = (
        await dataSource.query<Row[]>(
          `SELECT responsibility FROM marketplace_problems WHERE id = $1`,
          [p1],
        )
      )[0];
      expect(row.responsibility).toBe('UNKNOWN');
    });

    it('account scope aplicado antes da escrita: fora do escopo/inexistente = mesmo 404 e nada é escrito', async () => {
      const outside = await patch(p4, manager, {
        responsibility: 'SELLER',
        reason: 'motivo',
      });
      const missing = await patch(randomUUID(), manager, {
        responsibility: 'SELLER',
        reason: 'motivo',
      });
      expect(outside.status).toBe(404);
      expect(outside.body).toEqual(missing.body);
      const row = (
        await dataSource.query<Row[]>(
          `SELECT responsibility, responsibility_source FROM marketplace_problems WHERE id = $1`,
          [p4],
        )
      )[0];
      expect(row).toEqual({
        responsibility: 'UNKNOWN',
        responsibility_source: null,
      });
      const noneUser = await createUser(
        'ANALYST',
        'NONE',
        [],
        ['problems.manage'],
      );
      await patch(p1, noneUser, {
        responsibility: 'SELLER',
        reason: 'motivo',
      }).expect(404);
    });

    it('sincronização futura NUNCA sobrescreve a correção manual', async () => {
      await patch(p1, manager, {
        responsibility: 'BUYER',
        reason: 'Cliente devolveu errado',
      }).expect(200);
      const persistence = new MarketplaceProblemsPersistenceService(dataSource);
      const input: UpsertProblemInput = {
        marketplaceAccountId: accA,
        externalClaimId: 'c1',
        resource: 'order',
        resourceId: 'res-c1',
        status: 'closed',
        type: 'mediations',
        stage: 'claim',
        siteId: 'MLB',
        reasonId: 'R1',
        parentClaimId: null,
        fulfilled: null,
        quantityType: null,
        claimVersion: '2',
        resolutionReason: 'refunded',
        resolutionBenefitedRoles: [],
        resolutionClosedBy: null,
        resolutionAppliedCoverage: null,
        resolutionDate: new Date('2026-07-01T00:00:00Z'),
        dateCreated: new Date('2026-05-10T15:00:00Z'),
        lastUpdated: new Date('2026-07-01T00:00:00Z'),
        detail: { fetched: false },
        reputation: { fetched: false },
      };
      const result = await persistence.upsertProblem(input);
      expect(result.accepted).toBe(true);
      const row = (
        await dataSource.query<Row[]>(
          `SELECT status, responsibility, responsibility_confidence, responsibility_override_reason FROM marketplace_problems WHERE id = $1`,
          [p1],
        )
      )[0];
      expect(row).toEqual({
        status: 'closed',
        responsibility: 'BUYER',
        responsibility_confidence: 'MANUAL',
        responsibility_override_reason: 'Cliente devolveu errado',
      });
    });
  });

  // ------------------------------------------------------ controles do job
  describe('controles do job (problems.sync)', () => {
    const post = (path: string, user: string) =>
      request(http())
        .post(`/problems/sync/accounts/${path}`)
        .set('Cookie', cookieFor(user));

    it('start cria o job de forma idempotente e informa workerEnabled=false', async () => {
      const first = await post(`${accA}/start`, manager).expect(200);
      expect(first.body).toMatchObject({
        accountId: accA,
        accountNickname: 'Conta A',
        jobStatus: 'RUNNING',
        workerEnabled: false,
      });
      const second = await post(`${accA}/start`, manager).expect(200);
      expect((second.body as Row).windowCursorAt).toBe(
        (first.body as Row).windowCursorAt,
      );
      const [{ count }] = await dataSource.query<Array<{ count: string }>>(
        `SELECT count(*) FROM marketplace_problems_sync_jobs WHERE marketplace_account_id = $1`,
        [accA],
      );
      expect(count).toBe('1');
      // Nenhum job criado automaticamente para as outras contas.
      const [{ total }] = await dataSource.query<Array<{ total: string }>>(
        `SELECT count(*) AS total FROM marketplace_problems_sync_jobs`,
      );
      expect(total).toBe('1');
    });

    it('status: contas ML do escopo, NOT_STARTED antes do start, job depois', async () => {
      const before = (await get('/problems/sync/status', analystA).expect(200))
        .body as Row[];
      expect(before).toHaveLength(1);
      expect(before[0]).toMatchObject({
        accountId: accA,
        jobStatus: 'NOT_STARTED',
        workerEnabled: false,
      });
      await post(`${accA}/start`, manager).expect(200);
      const after = (await get('/problems/sync/status', analystA).expect(200))
        .body as Row[];
      expect(after[0]).toMatchObject({ jobStatus: 'RUNNING' });
      const all = (await get('/problems/sync/status', admin).expect(200))
        .body as Row[];
      expect(all.map((s) => s.accountNickname).sort()).toEqual([
        'Conta A',
        'Conta B',
      ]);
    });

    it('pause e resume; resume limpa tentativas/erro e agenda execução', async () => {
      await post(`${accA}/start`, manager).expect(200);
      const paused = await post(`${accA}/pause`, manager).expect(200);
      expect((paused.body as Row).jobStatus).toBe('PAUSED');
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs SET status = 'FAILED', attempt_count = 5, last_error_code = 'PROVIDER_UNAVAILABLE', next_attempt_at = now() + interval '1 hour' WHERE marketplace_account_id = $1`,
        [accA],
      );
      const resumed = await post(`${accA}/resume`, manager).expect(200);
      expect(resumed.body).toMatchObject({
        jobStatus: 'RUNNING',
        attemptCount: 0,
        lastErrorCode: null,
      });
      expect(
        new Date(
          (resumed.body as { nextAttemptAt: string }).nextAttemptAt,
        ).getTime(),
      ).toBeLessThanOrEqual(Date.now() + 1000);
      // Já ativo: resume só devolve o status.
      await post(`${accA}/resume`, manager).expect(200);
    });

    it('status e resumo expõem a cobertura por conta (incremental, histórico e quarentena pendente)', async () => {
      await post(`${accA}/start`, manager).expect(200);
      await dataSource.query(
        `INSERT INTO marketplace_problem_claim_quarantine
           (marketplace_account_id, external_claim_id, failure_code, first_seen_at, last_seen_at, next_attempt_at)
         VALUES ($1, 'q-1', 'CORE_FORBIDDEN', now(), now(), now()),
                ($1, 'q-2', 'CORE_FORBIDDEN', now(), now(), now())`,
        [accA],
      );
      await dataSource.query(
        `UPDATE marketplace_problem_claim_quarantine SET resolved_at = now() WHERE external_claim_id = 'q-2'`,
      );

      const [status] = (
        await get('/problems/sync/status', analystA).expect(200)
      ).body as Row[];
      expect(status).toMatchObject({
        accountId: accA,
        historicalStatus: 'RUNNING',
        historicalTargetFrom: null,
        historicalCompletedAt: null,
        historicalLastErrorCode: null,
        quarantinedClaimsCount: 1,
        lastErrorCode: null,
      });
      expect(status.incrementalCoveredThrough).toBe(status.windowCursorAt);
      expect(status.historicalCoveredFrom).toBe(status.windowCursorAt);

      const summary = (await get('/problems/summary', analystA).expect(200))
        .body as { total: number; coverage: Row[] };
      expect(summary.coverage[0]).toMatchObject({
        accountId: accA,
        historicalStatus: 'RUNNING',
        quarantinedClaimsCount: 1,
        lastErrorCode: null,
      });
      expect(summary.coverage[0].lastActivityAt).toBeNull();
      // Quarentena nunca entra nos KPIs.
      expect(summary.total).toBe(3);

      // Conta sem job: NOT_STARTED e sem cobertura inventada.
      const admins = (await get('/problems/sync/status', admin).expect(200))
        .body as Row[];
      expect(admins.find((a) => a.accountId === accB)).toMatchObject({
        historicalStatus: 'NOT_STARTED',
        historicalCoveredFrom: null,
        quarantinedClaimsCount: 0,
      });
    });

    it('histórico: pausar e retomar só o backfill (o job incremental segue RUNNING); idempotente', async () => {
      await post(`${accA}/start`, manager).expect(200);
      const paused = await post(`${accA}/historical/pause`, manager).expect(
        200,
      );
      expect(paused.body).toMatchObject({
        jobStatus: 'RUNNING',
        historicalStatus: 'PAUSED',
      });
      // Repetir é idempotente.
      expect(
        (await post(`${accA}/historical/pause`, manager).expect(200)).body,
      ).toMatchObject({ historicalStatus: 'PAUSED' });

      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs
            SET historical_status = 'FAILED', historical_last_error_code = 'SAFETY_LIMIT_REACHED'
          WHERE marketplace_account_id = $1`,
        [accA],
      );
      const resumed = await post(`${accA}/historical/resume`, manager).expect(
        200,
      );
      expect(resumed.body).toMatchObject({
        jobStatus: 'RUNNING',
        historicalStatus: 'RUNNING',
        historicalLastErrorCode: null,
      });
    });

    it('histórico: sem job iniciado 404; fora do escopo 404 genérico; conta não-ML 400; sem problems.sync 403', async () => {
      await post(`${accA}/historical/pause`, manager).expect(404);
      await post(`${accA}/historical/resume`, manager).expect(404);
      const missing = await post(`${randomUUID()}/historical/pause`, manager);
      const outside = await post(`${accB}/historical/pause`, manager);
      expect(missing.status).toBe(404);
      expect(outside.body).toEqual(missing.body);
      const shopeeManager = await createUser(
        'ANALYST',
        'ALL',
        [],
        ['problems.sync'],
      );
      await post(`${accShopee}/historical/pause`, shopeeManager).expect(400);
      await post(`${accA}/historical/pause`, analystA).expect(403);
      await post(`${accA}/historical/resume`, analystA).expect(403);
    });

    it('pause/resume sem job iniciado: 404; conta não-ML: 400', async () => {
      await post(`${accA}/pause`, manager).expect(404);
      await post(`${accA}/resume`, manager).expect(404);
      const shopeeManager = await createUser(
        'ANALYST',
        'ALL',
        [],
        ['problems.sync'],
      );
      await post(`${accShopee}/start`, shopeeManager).expect(400);
    });

    it('conta inexistente e conta fora do escopo: mesmo 404 genérico, sem criar job', async () => {
      const missing = await post(`${randomUUID()}/start`, manager);
      const outside = await post(`${accB}/start`, manager);
      expect(missing.status).toBe(404);
      expect(outside.status).toBe(404);
      expect(outside.body).toEqual(missing.body);
      const [{ total }] = await dataSource.query<Array<{ total: string }>>(
        `SELECT count(*) AS total FROM marketplace_problems_sync_jobs`,
      );
      expect(total).toBe('0');
    });
  });

  it('nenhuma chamada externa em nenhuma rota (ML_FETCH e fetch global intactos)', async () => {
    const globalFetch = jest.spyOn(global, 'fetch');
    await get('/problems', admin).expect(200);
    await get('/problems/summary', admin).expect(200);
    await request(http())
      .post(`/problems/sync/accounts/${accA}/start`)
      .set('Cookie', cookieFor(manager))
      .expect(200);
    await request(http())
      .post(`/problems/sync/accounts/${accA}/resume`)
      .set('Cookie', cookieFor(manager))
      .expect(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });
});
