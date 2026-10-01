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
import { MarketplaceProblemsModule } from './marketplace-problems.module';
import type {
  ProblemsMonthlyDto,
  ProblemsMonthlyItemDto,
} from './marketplace-problems.types';

const ACCESS_TOKEN_SECRET = 'x'.repeat(32);

/**
 * `GET /problems/monthly` com HTTP REAL (guards, permissões, account scope) e
 * queries REAIS em PostgreSQL descartável. Nenhuma chamada externa.
 */
describe('GET /problems/monthly — HTTP real (Postgres)', () => {
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
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await app.close();
  });

  let ml1: string;
  let ml2: string;
  let shopee: string;
  let admin: string;
  let analystMl1: string;
  let analystNone: string;
  let analystSelectedEmpty: string;
  let viewer: string;

  async function createUser(
    roleKey: string,
    scope: 'ALL' | 'SELECTED' | 'NONE',
    accountIds: string[] = [],
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
    return id;
  }

  async function account(marketplace: string, nickname: string) {
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, status, token_version)
       VALUES ($1, $2, 'CONNECTED', 0) RETURNING id`,
      [marketplace, nickname],
    );
    return row.id;
  }

  async function problem(
    accountId: string,
    claim: string,
    created: string,
    fields: {
      reason?: string | null;
      resolvedAfterHours?: number;
      impact?: string | null;
      responsibility?: string;
    } = {},
  ) {
    await dataSource.query(
      `INSERT INTO marketplace_problems
         (marketplace_account_id, external_claim_id, resource, resource_id, status, type, stage,
          site_id, reason_id, date_created, last_updated, resolution_date, reputation_impact,
          responsibility, detail_title, detail_description)
       VALUES ($1, $2, 'order', $3, 'opened', 'mediations', 'claim', 'MLB', $4,
               $5::timestamptz, $5::timestamptz,
               CASE WHEN $6::int IS NULL THEN NULL
                    ELSE $5::timestamptz + ($6::int * interval '1 hour') END,
               $7, $8, 'Título', 'DESCRIÇÃO COM DADO PESSOAL')`,
      [
        accountId,
        claim,
        `res-${claim}`,
        fields.reason ?? null,
        created,
        fields.resolvedAfterHours ?? null,
        fields.impact ?? null,
        fields.responsibility ?? 'UNKNOWN',
      ],
    );
  }

  async function orders(accountId: string, ...createdAt: string[]) {
    for (const created of createdAt) {
      await dataSource.query(
        `INSERT INTO marketplace_orders (marketplace_account_id, external_order_id, status, currency_id, total_amount, date_created)
         VALUES ($1, $2, 'paid', 'BRL', 10, $3::timestamptz)`,
        [accountId, `o-${randomUUID()}`, created],
      );
    }
  }

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE user_account_scope CASCADE');
    await dataSource.query('TRUNCATE TABLE user_permission_overrides CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');
    await dataSource.query('DELETE FROM marketplace_problem_reasons');
    fetchMock.mockClear();

    ml1 = await account('MERCADO_LIVRE', 'ML1');
    ml2 = await account('MERCADO_LIVRE', 'ML2');
    shopee = await account('SHOPEE', 'Loja S');
    await dataSource.query(
      `INSERT INTO marketplace_problem_reasons (marketplace, site_id, reason_id, flow, name, status, fetched_at)
       VALUES ('MERCADO_LIVRE', 'MLB', 'PNR1', 'mediations', 'repentant_buyer', 'active', now()),
              ('MERCADO_LIVRE', 'MLB', 'PNR2', 'mediations', 'broken_item', 'active', now()),
              ('MERCADO_LIVRE', 'MLB', 'PNR3', 'mediations', 'undelivered_other', 'active', now()),
              ('MERCADO_LIVRE', 'MLB', 'PNRX', 'mediations', 'some_new_code', 'active', now())`,
    );

    // ML1: cobertura contínua de 01/06 00:00 (SP) até 15/09; ML2 nunca iniciou (sem job).
    await dataSource.query(
      `INSERT INTO marketplace_problems_sync_jobs
         (marketplace_account_id, window_cursor_at, historical_covered_from, historical_status)
       VALUES ($1, '2026-09-15T12:00:00Z', '2026-06-01T00:00:00-03:00', 'COMPLETED')`,
      [ml1],
    );

    // --- ML1 — fronteira de fuso: 30/06 23:30 (SP) ainda é JUNHO (já é 01/07 em UTC).
    await problem(ml1, 'c-jun-late', '2026-06-30T23:30:00-03:00', {
      reason: 'PNR1',
    });
    await problem(ml1, 'c-jul-early', '2026-07-01T00:30:00-03:00', {
      reason: 'PNR1',
    });
    await problem(ml1, 'c-jul-resolved', '2026-07-15T12:00:00Z', {
      reason: 'PNR2',
      resolvedAfterHours: 48,
      impact: 'affected',
    });
    await problem(ml1, 'c-jul-open', '2026-07-20T12:00:00Z', {
      reason: 'PNR1',
      responsibility: 'SELLER',
    });
    // Pedidos: 5 em junho (1 na última fração de 30/06 SP), 8 em julho (1 em 01/07 00:00 SP), 4 em agosto.
    await orders(
      ml1,
      '2026-06-05T12:00:00Z',
      '2026-06-10T12:00:00Z',
      '2026-06-15T12:00:00Z',
      '2026-06-20T12:00:00Z',
      '2026-06-30T23:59:59-03:00',
      '2026-07-01T00:00:00-03:00',
      '2026-07-05T12:00:00Z',
      '2026-07-06T12:00:00Z',
      '2026-07-07T12:00:00Z',
      '2026-07-08T12:00:00Z',
      '2026-07-09T12:00:00Z',
      '2026-07-10T12:00:00Z',
      '2026-07-11T12:00:00Z',
      '2026-08-05T12:00:00Z',
      '2026-08-06T12:00:00Z',
      '2026-08-07T12:00:00Z',
      '2026-08-08T12:00:00Z',
    );

    // --- ML2: problemas em julho SEM nenhum pedido persistido no mês.
    await problem(ml2, 'm2-jul-1', '2026-07-10T12:00:00Z', { reason: 'PNR3' });
    await problem(ml2, 'm2-jul-2', '2026-07-11T12:00:00Z', {
      reason: 'SEM_CACHE',
    });
    await orders(ml2, '2026-08-10T12:00:00Z');

    // --- Shopee: pedidos que NUNCA entram na análise de problemas.
    await orders(shopee, '2026-07-12T12:00:00Z');

    admin = await createUser('ADMIN', 'ALL');
    analystMl1 = await createUser('ANALYST', 'SELECTED', [ml1]);
    analystNone = await createUser('ANALYST', 'NONE');
    analystSelectedEmpty = await createUser('ANALYST', 'SELECTED', []);
    viewer = await createUser('VIEWER', 'ALL');
  });

  const cookieFor = (userId: string): string =>
    `${ACCESS_TOKEN_COOKIE_NAME}=${jwtService.sign(
      { sub: userId, email: `t-${userId}@example.com` },
      { secret: ACCESS_TOKEN_SECRET, expiresIn: '15m' },
    )}`;
  const monthly = async (
    user: string,
    query = '',
    expected = 200,
  ): Promise<ProblemsMonthlyDto> =>
    (
      await request(http())
        .get(`/problems/monthly${query}`)
        .set('Cookie', cookieFor(user))
        .expect(expected)
    ).body as ProblemsMonthlyDto;
  const row = (
    body: ProblemsMonthlyDto,
    accountId: string,
    yearMonth: string,
  ): ProblemsMonthlyItemDto => {
    const item = body.items.find(
      (i) => i.accountId === accountId && i.yearMonth === yearMonth,
    );
    if (!item) throw new Error(`linha ${yearMonth} da conta não encontrada`);
    return item;
  };

  it('401 sem sessão e 403 sem problems.view', async () => {
    await request(http()).get('/problems/monthly').expect(401);
    await monthly(viewer, '', 403);
  });

  it('separa ML1 e ML2 (por conta e por mês) e devolve o fuso fixo America/Sao_Paulo', async () => {
    const body = await monthly(admin);

    expect(body.timezone).toBe('America/Sao_Paulo');
    expect(new Set(body.items.map((i) => i.accountId))).toEqual(
      new Set([ml1, ml2]),
    );
    expect(row(body, ml1, '2026-07')).toMatchObject({
      accountNickname: 'ML1',
      marketplace: 'MERCADO_LIVRE',
      totalProblems: 3,
    });
    expect(row(body, ml2, '2026-07')).toMatchObject({
      accountNickname: 'ML2',
      totalProblems: 2,
    });
    // Ordenado por mês e depois por conta.
    const months = body.items.map((i) => i.yearMonth);
    expect(months).toEqual([...months].sort());
  });

  it('taxa por 100 pedidos = problemas / pedidos * 100 (2 casas), pedidos do MESMO mês e conta', async () => {
    const body = await monthly(admin);

    const jul = row(body, ml1, '2026-07');
    expect(jul.totalOrders).toBe(8);
    expect(jul.problemsPer100Orders).toBe(37.5);
    const jun = row(body, ml1, '2026-06');
    expect(jun.totalOrders).toBe(5);
    expect(jun.totalProblems).toBe(1);
    expect(jun.problemsPer100Orders).toBe(20);
  });

  it('mês SEM pedidos nunca divide por zero (taxa null) e a taxa não é definitiva', async () => {
    const jul = row(await monthly(admin), ml2, '2026-07');

    expect(jul.totalOrders).toBe(0);
    expect(jul.totalProblems).toBe(2);
    expect(jul.problemsPer100Orders).toBeNull();
    expect(jul.rateDefinitive).toBe(false);
  });

  it('mês só com pedidos aparece com 0 problemas, taxa 0 e sem métricas de resolução', async () => {
    const aug = row(await monthly(admin), ml1, '2026-08');

    expect(aug).toMatchObject({
      totalProblems: 0,
      totalOrders: 4,
      problemsPer100Orders: 0,
      resolutionRate: null,
      averageResolutionHours: null,
      topReasons: [],
    });
  });

  it('fronteiras do mês em America/Sao_Paulo (30/06 23:30 SP é junho; 01/07 00:30 SP é julho; idem para pedidos)', async () => {
    const body = await monthly(admin);

    expect(row(body, ml1, '2026-06').totalProblems).toBe(1);
    // 30/06 23:59:59 (SP) conta em junho; 01/07 00:00:00 (SP) conta em julho.
    expect(row(body, ml1, '2026-06').totalOrders).toBe(5);
    expect(row(body, ml1, '2026-07').totalOrders).toBe(8);
    expect(row(body, ml1, '2026-07').totalProblems).toBe(3);
  });

  it('aberto/resolvido, impacto na reputação, taxa e tempo médio de resolução', async () => {
    const jul = row(await monthly(admin), ml1, '2026-07');

    expect(jul.openProblems).toBe(2);
    expect(jul.resolvedProblems).toBe(1);
    expect(jul.reputationImpactCount).toBe(1);
    expect(jul.resolutionRate).toBe(33.33);
    expect(jul.averageResolutionHours).toBe(48);
  });

  it('principais motivos com código original e rótulo PT-BR; código desconhecido e sem cache aparecem de forma segura', async () => {
    const body = await monthly(admin);

    expect(row(body, ml1, '2026-07').topReasons).toEqual([
      {
        code: 'repentant_buyer',
        label: 'Arrependimento do comprador',
        count: 2,
      },
      {
        code: 'broken_item',
        label: 'Produto quebrado ou com defeito',
        count: 1,
      },
    ]);
    // ML2: `PNR3` (undelivered_other) e `SEM_CACHE` (sem entrada no cache => usa o reason_id).
    expect(row(body, ml2, '2026-07').topReasons).toEqual([
      { code: 'SEM_CACHE', label: 'SEM CACHE', count: 1 },
      {
        code: 'undelivered_other',
        label: 'Não entregue — outro motivo',
        count: 1,
      },
    ]);
  });

  it('motivo desconhecido do cache vira texto legível, mantendo o código para diagnóstico', async () => {
    await problem(ml1, 'c-novo', '2026-08-15T12:00:00Z', { reason: 'PNRX' });

    const aug = row(await monthly(admin), ml1, '2026-08');

    expect(aug.topReasons).toEqual([
      { code: 'some_new_code', label: 'Some new code', count: 1 },
    ]);
  });

  it('cobertura: COMPLETE só com o mês inteiro dentro do intervalo varrido; PARTIAL no mês corrente do cursor; UNKNOWN sem job', async () => {
    await problem(ml1, 'c-set', '2026-09-05T12:00:00Z');
    const body = await monthly(admin);

    // 01/06 00:00 SP é exatamente o início da cobertura contínua: junho inteiro dentro.
    expect(row(body, ml1, '2026-06').coverage).toBe('COMPLETE');
    expect(row(body, ml1, '2026-07').coverage).toBe('COMPLETE');
    expect(row(body, ml1, '2026-07').rateDefinitive).toBe(true);
    // Setembro termina depois do cursor (15/09): parcial; taxa não definitiva.
    expect(row(body, ml1, '2026-09').coverage).toBe('PARTIAL');
    expect(row(body, ml1, '2026-09').rateDefinitive).toBe(false);
    // ML2 nunca iniciou a sincronização: cobertura desconhecida.
    expect(row(body, ml2, '2026-07').coverage).toBe('UNKNOWN');
  });

  /** Quarentena pendente do claim (a data, quando conhecida, vem da busca). */
  async function quarantine(
    accountId: string,
    claim: string,
    claimDateCreated: string | null,
    failureCode = 'CORE_FORBIDDEN',
  ) {
    await dataSource.query(
      `INSERT INTO marketplace_problem_claim_quarantine
         (marketplace_account_id, external_claim_id, failure_code, claim_date_created,
          first_seen_at, last_seen_at, next_attempt_at)
       VALUES ($1, $2, $3, $4::timestamptz, now(), now(), now())`,
      [accountId, claim, failureCode, claimDateCreated],
    );
  }

  it('mês fora do intervalo histórico é PARTIAL (nunca UNKNOWN quando há job); taxa só é definitiva em mês COMPLETE', async () => {
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET historical_covered_from = '2026-07-10T12:00:00Z', historical_status = 'RUNNING'
        WHERE marketplace_account_id = $1`,
      [ml1],
    );
    const body = await monthly(admin);

    // Junho está inteiro antes do cursor histórico; julho atravessa o cursor.
    expect(row(body, ml1, '2026-06').coverage).toBe('PARTIAL');
    expect(row(body, ml1, '2026-07').coverage).toBe('PARTIAL');
    expect(row(body, ml1, '2026-08').coverage).toBe('COMPLETE');
    expect(row(body, ml1, '2026-06').totalOrders).toBeGreaterThan(0);
    expect(row(body, ml1, '2026-06').rateDefinitive).toBe(false);
    expect(row(body, ml1, '2026-07').rateDefinitive).toBe(false);
    expect(row(body, ml1, '2026-08').rateDefinitive).toBe(true);
  });

  it('quarentena COM data conhecida afeta SÓ o mês dela (America/Sao_Paulo) e fica fora dos KPIs; quando resolvida deixa de afetar', async () => {
    const before = await monthly(admin);
    // 30/06 23:30 em SP já é 01/07 em UTC, mas pertence a JUNHO.
    await quarantine(ml1, 'bloqueado-jun', '2026-06-30T23:30:00-03:00');
    await quarantine(ml1, 'resolvido-jul', '2026-07-10T12:00:00Z');
    await dataSource.query(
      `UPDATE marketplace_problem_claim_quarantine SET resolved_at = now()
        WHERE external_claim_id = 'resolvido-jul'`,
    );

    const after = await monthly(admin);

    const jun = row(after, ml1, '2026-06');
    expect(jun.coverage).toBe('PARTIAL');
    expect(jun.rateDefinitive).toBe(false);
    expect(jun.quarantinedClaimsInMonthCount).toBe(1);
    expect(jun.quarantinedClaimsCount).toBe(1);
    // Os demais meses da conta NÃO ficam parciais.
    for (const month of ['2026-07', '2026-08']) {
      const item = row(after, ml1, month);
      expect(item.coverage).toBe('COMPLETE');
      expect(item.quarantinedClaimsInMonthCount).toBe(0);
      expect(item.quarantinedUnknownDateCount).toBe(0);
    }
    expect(row(after, ml1, '2026-07').rateDefinitive).toBe(true);
    // KPIs idênticos: quarentena não é problema sincronizado.
    for (const month of ['2026-06', '2026-07', '2026-08']) {
      const b = row(before, ml1, month);
      const a = row(after, ml1, month);
      expect(a.totalProblems).toBe(b.totalProblems);
      expect(a.openProblems).toBe(b.openProblems);
      expect(a.problemsPer100Orders).toBe(b.problemsPer100Orders);
    }
    const summary = await request(http())
      .get('/problems/summary')
      .set('Cookie', cookieFor(admin))
      .expect(200);
    expect((summary.body as { total: number }).total).toBe(6);

    // Resolvida a pendência de junho, o mês volta a COMPLETE.
    await dataSource.query(
      `UPDATE marketplace_problem_claim_quarantine SET resolved_at = now()
        WHERE external_claim_id = 'bloqueado-jun'`,
    );
    const resolved = await monthly(admin);
    expect(row(resolved, ml1, '2026-06').coverage).toBe('COMPLETE');
    expect(row(resolved, ml1, '2026-06').quarantinedClaimsCount).toBe(0);
  });

  it('CORE_NOT_FOUND datado se comporta como CORE_FORBIDDEN: afeta só o mês do claim', async () => {
    await quarantine(
      ml1,
      'sumiu-ago',
      '2026-08-05T12:00:00Z',
      'CORE_NOT_FOUND',
    );

    const body = await monthly(admin);

    expect(row(body, ml1, '2026-08').coverage).toBe('PARTIAL');
    expect(row(body, ml1, '2026-07').coverage).toBe('COMPLETE');
  });

  it('quarentena LEGADA sem data conhecida: cobertura INDETERMINADA (UNKNOWN) nos meses que seriam completos; meses já PARTIAL continuam PARTIAL', async () => {
    await problem(ml1, 'c-set', '2026-09-05T12:00:00Z');
    await quarantine(ml1, 'legado', null);

    const body = await monthly(admin);

    for (const month of ['2026-06', '2026-07', '2026-08']) {
      const item = row(body, ml1, month);
      expect(item.coverage).toBe('UNKNOWN');
      expect(item.rateDefinitive).toBe(false);
      expect(item.quarantinedUnknownDateCount).toBe(1);
      expect(item.quarantinedClaimsInMonthCount).toBe(0);
      expect(item.quarantinedClaimsCount).toBe(1);
    }
    // Setembro já é PARTIAL (cursor no meio do mês).
    expect(row(body, ml1, '2026-09').coverage).toBe('PARTIAL');
  });

  it('ML1 e ML2 são avaliadas separadamente: a quarentena e a cobertura de uma nunca contaminam a outra', async () => {
    await dataSource.query(
      `INSERT INTO marketplace_problems_sync_jobs
         (marketplace_account_id, window_cursor_at, historical_covered_from, historical_status)
       VALUES ($1, '2026-09-15T12:00:00Z', '2026-06-01T00:00:00-03:00', 'COMPLETED')`,
      [ml2],
    );
    await quarantine(ml1, 'so-ml1', '2026-07-10T12:00:00Z');

    const body = await monthly(admin);

    expect(row(body, ml1, '2026-07').coverage).toBe('PARTIAL');
    expect(row(body, ml1, '2026-07').quarantinedClaimsInMonthCount).toBe(1);
    expect(row(body, ml2, '2026-07').coverage).toBe('COMPLETE');
    expect(row(body, ml2, '2026-07').quarantinedClaimsCount).toBe(0);
    // ML2 sem pedidos em julho: taxa null mesmo com cobertura completa; ML2 em agosto tem pedido.
    expect(row(body, ml2, '2026-07').problemsPer100Orders).toBeNull();
    expect(row(body, ml2, '2026-07').rateDefinitive).toBe(false);
    expect(row(body, ml2, '2026-08').rateDefinitive).toBe(true);

    // Escopo: quem só vê ML2 nunca enxerga a pendência da ML1.
    const analystMl2 = await createUser('ANALYST', 'SELECTED', [ml2]);
    const onlyMl2 = await monthly(analystMl2);
    expect(new Set(onlyMl2.items.map((i) => i.accountId))).toEqual(
      new Set([ml2]),
    );
    expect(onlyMl2.items.every((i) => i.quarantinedClaimsCount === 0)).toBe(
      true,
    );
  });

  it('account scope: ALL vê tudo; SELECTED só as contas permitidas; NONE e SELECTED vazio recebem lista vazia', async () => {
    const all = await monthly(admin);
    expect(new Set(all.items.map((i) => i.accountId))).toEqual(
      new Set([ml1, ml2]),
    );

    const selected = await monthly(analystMl1);
    expect(new Set(selected.items.map((i) => i.accountId))).toEqual(
      new Set([ml1]),
    );
    expect(row(selected, ml1, '2026-07').totalProblems).toBe(3);

    expect((await monthly(analystNone)).items).toEqual([]);
    expect((await monthly(analystSelectedEmpty)).items).toEqual([]);
  });

  it('accountId fora do escopo devolve vazio (sem revelar a existência); dentro do escopo filtra', async () => {
    expect((await monthly(analystMl1, `?accountId=${ml2}`)).items).toEqual([]);
    expect((await monthly(analystMl1, `?accountId=${shopee}`)).items).toEqual(
      [],
    );
    const own = await monthly(analystMl1, `?accountId=${ml1}`);
    expect(new Set(own.items.map((i) => i.accountId))).toEqual(new Set([ml1]));
    const onlyMl2 = await monthly(admin, `?accountId=${ml2}`);
    expect(new Set(onlyMl2.items.map((i) => i.accountId))).toEqual(
      new Set([ml2]),
    );
  });

  it('filtros: dateFrom/dateTo (dias em America/Sao_Paulo) e marketplace; só Mercado Livre tem problemas', async () => {
    const july = await monthly(admin, '?dateFrom=2026-07-01&dateTo=2026-07-31');
    expect(new Set(july.items.map((i) => i.yearMonth))).toEqual(
      new Set(['2026-07']),
    );
    expect(row(july, ml1, '2026-07').totalProblems).toBe(3);

    // dateTo inclusivo no fuso: 30/06 já cobre 30/06 23:30 (SP) e nada de julho.
    const june = await monthly(admin, '?dateTo=2026-06-30');
    expect(new Set(june.items.map((i) => i.yearMonth))).toEqual(
      new Set(['2026-06']),
    );

    expect(
      (await monthly(admin, '?marketplace=MERCADO_LIVRE')).items.length,
    ).toBeGreaterThan(0);
    expect((await monthly(admin, '?marketplace=SHOPEE')).items).toEqual([]);
  });

  it.each([
    '?dateFrom=2026-13-01',
    '?dateTo=2026-02-30',
    '?dateFrom=2026-08-01&dateTo=2026-07-01',
    '?dateFrom=01/07/2026',
    '?accountId=nao-e-uuid',
    '?marketplace=INEXISTENTE',
    '?timezone=UTC',
    '?from=2026-07-01',
  ])('400 para filtro inválido %s', async (query) => {
    await monthly(admin, query, 400);
  });

  it('resposta sem dado pessoal, token ou texto livre do provedor; só os campos documentados', async () => {
    const body = await monthly(admin);
    const json = JSON.stringify(body);

    expect(json).not.toContain('DESCRIÇÃO COM DADO PESSOAL');
    expect(json).not.toContain('Título');
    expect(json).not.toContain('res-c-');
    expect(Object.keys(row(body, ml1, '2026-07')).sort()).toEqual(
      [
        'accountId',
        'accountNickname',
        'averageResolutionHours',
        'coverage',
        'marketplace',
        'openProblems',
        'problemsPer100Orders',
        'quarantinedClaimsCount',
        'quarantinedClaimsInMonthCount',
        'quarantinedUnknownDateCount',
        'rateDefinitive',
        'reputationImpactCount',
        'resolutionRate',
        'resolvedProblems',
        'topReasons',
        'totalOrders',
        'totalProblems',
        'yearMonth',
      ].sort(),
    );
  });

  it('somente leitura: a responsabilidade manual e as linhas existentes ficam intactas', async () => {
    await dataSource.query(
      `UPDATE marketplace_problems
          SET responsibility = 'BUYER', responsibility_confidence = 'MANUAL',
              responsibility_source = 'manual'
        WHERE external_claim_id = 'c-jul-open'`,
    );
    const snapshot = () =>
      dataSource.query<unknown[]>(
        `SELECT external_claim_id, responsibility, responsibility_confidence, updated_at
           FROM marketplace_problems ORDER BY external_claim_id`,
      );
    const before = await snapshot();

    await monthly(admin);
    await monthly(analystMl1);

    expect(await snapshot()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
