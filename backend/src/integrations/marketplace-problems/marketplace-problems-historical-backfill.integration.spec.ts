import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import { MarketplaceProblemsSyncJobsPersistenceService } from './marketplace-problems-sync-jobs-persistence.service';
import { buildProblemsSyncServices } from './marketplace-problems-sync-test-wiring';
import { MarketplaceProblemsSyncWorkerService } from './marketplace-problems-sync-worker.service';

const TOKEN = 'fake-token-historical-backfill';
const DAY = 24 * 60 * 60 * 1000;

interface FakeClaim {
  id: string;
  status: 'opened' | 'closed';
  dateCreated: string;
  /** Status HTTP do `fetch_core` deste claim (padrão 200). */
  coreStatus?: number;
  /** `fetch_core` responde 200 com corpo inválido (`invalid_response`). */
  coreInvalid?: boolean;
}

interface SearchCall {
  status: string;
  after: number;
  before: number;
}

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  }) as unknown as Response;

const rawClaim = (claim: FakeClaim) => ({
  id: claim.id,
  resource_id: `order-${claim.id}`,
  resource: 'order',
  status: claim.status,
  type: 'mediations',
  stage: 'claim',
  site_id: 'MLB',
  reason_id: 'PDD9999',
  parent_id: null,
  fulfilled: null,
  quantity_type: null,
  date_created: claim.dateCreated,
  last_updated: claim.dateCreated,
  players: [],
  resolution: null,
});

const fakeConfig = (values: Record<string, unknown> = {}) =>
  ({
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('Backfill histórico de Problemas no worker (Postgres real + HTTP fake)', () => {
  let dataSource: DataSource;
  let jobs: MarketplaceProblemsSyncJobsPersistenceService;
  let problems: MarketplaceProblemsPersistenceService;
  let reasonCache: MarketplaceProblemReasonsCacheRepository;
  let warn: jest.SpyInstance;
  let claims: FakeClaim[];
  let searches: SearchCall[];
  let coreCalls: string[];
  let searchFailure: (call: SearchCall) => number | null;
  let beforeSearch: (call: SearchCall) => Promise<void>;
  let accountId: string;
  let seller: string;
  let now0: number;

  beforeAll(async () => {
    dataSource = new DataSource(
      buildDataSourceOptions({
        databaseUrl: requireTestDatabaseUrl(),
        nodeEnv: 'test',
      }),
    );
    await dataSource.initialize();
    await dataSource.runMigrations();
    jobs = new MarketplaceProblemsSyncJobsPersistenceService(dataSource);
    problems = new MarketplaceProblemsPersistenceService(dataSource);
    reasonCache = new MarketplaceProblemReasonsCacheRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await dataSource.query(`DELETE FROM marketplace_problems_sync_jobs`);
    await dataSource.query(`DELETE FROM marketplace_problem_reasons`);
    claims = [];
    searches = [];
    coreCalls = [];
    searchFailure = () => null;
    beforeSearch = () => Promise.resolve();
    seller = String(Math.floor(Math.random() * 1e12));
    now0 = Date.now();
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, status, external_seller_id,
         encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'CONNECTED', $2, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`, seller],
    );
    accountId = row.id;
  });

  afterEach(() => warn.mockRestore());

  const ago = (days: number) => new Date(now0 - days * DAY);

  function addClaim(
    daysAgo: number,
    status: FakeClaim['status'] = 'opened',
    coreStatus?: number,
  ): FakeClaim {
    const claim = {
      id: String(Math.floor(Math.random() * 1e12)),
      status,
      dateCreated: ago(daysAgo).toISOString(),
      coreStatus,
    };
    claims.push(claim);
    return claim;
  }

  async function addOrder(daysAgo: number) {
    await dataSource.query(
      `INSERT INTO marketplace_orders (marketplace_account_id, external_order_id,
         status, currency_id, total_amount, date_created)
       VALUES ($1, $2, 'paid', 'BRL', '10.00', $3)`,
      [accountId, `o-${randomUUID()}`, ago(daysAgo)],
    );
  }

  function fakeFetch() {
    return (async (urlString: string) => {
      const url = new URL(urlString);
      if (url.pathname === '/post-purchase/v1/claims/search') {
        const status = url.searchParams.get('status') ?? '';
        const match = /after:([^,]+),before:(.+)$/.exec(
          url.searchParams.get('range') ?? '',
        );
        const call = {
          status,
          after: match ? Date.parse(match[1]) : -Infinity,
          before: match ? Date.parse(match[2]) : Infinity,
        };
        searches.push(call);
        await beforeSearch(call);
        const failure = searchFailure(call);
        if (failure !== null) return jsonResponse(failure, {});
        const found = claims.filter((c) => {
          const at = Date.parse(c.dateCreated);
          return c.status === status && at >= call.after && at <= call.before;
        });
        return jsonResponse(200, {
          paging: { total: found.length, offset: 0, limit: 100 },
          data: found.map(rawClaim),
        });
      }
      const core = /^\/post-purchase\/v1\/claims\/([^/]+)$/.exec(url.pathname);
      const claim = core ? claims.find((c) => c.id === core[1]) : undefined;
      if (!claim) return jsonResponse(404, {});
      coreCalls.push(claim.id);
      if (claim.coreInvalid) return jsonResponse(200, { unexpected: true });
      if (claim.coreStatus && claim.coreStatus !== 200) {
        return jsonResponse(claim.coreStatus, {});
      }
      return jsonResponse(200, { ...rawClaim(claim), claim_version: '1' });
    }) as unknown as typeof fetch;
  }

  /** Pipeline REAL; uma nova chamada simula "reinício do processo" (estado só no banco). */
  function buildWorker(values: Record<string, unknown> = {}) {
    const config = fakeConfig({
      PROBLEMS_SYNC_WORKER_TICK_MAX_CLAIMS: 50,
      PROBLEMS_SYNC_WORKER_TICK_MAX_HTTP_CALLS: 300,
      ...values,
    });
    const httpClient = new MercadoLivreClaimsHttpClient(
      fakeConfig(),
      fakeFetch(),
    );
    const preflight = {
      resolveAccountAndToken: jest
        .fn()
        .mockResolvedValue({ accessToken: TOKEN, externalSellerId: seller }),
    };
    const { tick } = buildProblemsSyncServices({
      dataSource,
      preflight,
      httpClient,
      reasonCache,
      problems,
      configService: fakeConfig(),
    });
    return new MarketplaceProblemsSyncWorkerService(config, jobs, tick);
  }

  /** Job com cursor incremental em dia (1s atrás) e censo recente: o tick faz criação + histórico. */
  async function newJob() {
    const created = await jobs.createIfAbsent(accountId, new Date(now0));
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET window_cursor_at = now() - interval '1 second', last_census_at = now()
        WHERE id = $1`,
      [created.id],
    );
    return (await jobs.findByAccountId(accountId))!;
  }

  async function tickOnce(worker: MarketplaceProblemsSyncWorkerService) {
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET next_attempt_at = now() - interval '1 second'
        WHERE marketplace_account_id = $1`,
      [accountId],
    );
    searches = [];
    coreCalls = [];
    await worker.runTickOnce();
  }

  const problemIds = async () =>
    (
      await dataSource.query<Array<{ external_claim_id: string }>>(
        `SELECT external_claim_id FROM marketplace_problems
          WHERE marketplace_account_id = $1 ORDER BY external_claim_id`,
        [accountId],
      )
    ).map((r) => r.external_claim_id);

  /** Buscas da janela HISTÓRICA (as da criação terminam perto de `now`). */
  const historicalSearches = () =>
    searches.filter((s) => s.before < Date.now() - 30 * DAY);

  it('anda para trás a cada tick, consulta opened+closed em TODA janela e termina na data do pedido mais antigo', async () => {
    await addOrder(100);
    await addOrder(10);
    const h1 = addClaim(65, 'opened');
    const h2 = addClaim(80, 'closed');
    const h3 = addClaim(99, 'opened');
    const h4 = addClaim(100, 'closed'); // exatamente na data do pedido mais antigo
    const job = await newJob();
    const worker = buildWorker();
    const ordersBefore = await dataSource.query<unknown[]>(
      `SELECT id, date_created FROM marketplace_orders WHERE marketplace_account_id = $1 ORDER BY id`,
      [accountId],
    );

    await tickOnce(worker);
    let after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalStatus).toBe('RUNNING');
    expect(after.historicalTargetFrom).toEqual(ago(100));
    expect(after.historicalCoveredFrom.getTime()).toBeLessThan(
      job.historicalCoveredFrom.getTime(),
    );
    expect(after.historicalCoveredFrom.getTime()).toBe(
      job.historicalCoveredFrom.getTime() - 14 * DAY,
    );
    expect(await problemIds()).toEqual([h1.id]);
    // opened E closed na mesma janela histórica.
    expect(
      historicalSearches()
        .map((s) => s.status)
        .sort(),
    ).toEqual(['closed', 'opened']);

    await tickOnce(worker);
    after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalStatus).toBe('RUNNING');
    expect(after.historicalCompletedAt).toBeNull();
    expect(await problemIds()).toEqual([h1.id, h2.id].sort());

    await tickOnce(worker);
    after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalStatus).toBe('COMPLETED');
    expect(after.historicalCompletedAt).not.toBeNull();
    // Menor data efetivamente coberta = data do pedido mais antigo.
    expect(after.historicalCoveredFrom).toEqual(ago(100));
    expect(await problemIds()).toEqual([h1.id, h2.id, h3.id, h4.id].sort());

    // Concluído: nenhum tick seguinte volta a buscar no passado.
    await tickOnce(worker);
    expect(historicalSearches()).toEqual([]);
    expect(await problemIds()).toHaveLength(4);
    // O backfill nunca altera nem cria pedidos.
    expect(
      await dataSource.query<unknown[]>(
        `SELECT id, date_created FROM marketplace_orders WHERE marketplace_account_id = $1 ORDER BY id`,
        [accountId],
      ),
    ).toEqual(ordersBefore);
  });

  it('retoma pelo cursor SALVO depois de um "reinício" (nova instância) e nunca reinicia o progresso incremental', async () => {
    await addOrder(100);
    addClaim(65);
    await newJob();
    await tickOnce(buildWorker());
    const saved = (await jobs.findByAccountId(accountId))!;

    // Novo worker/serviços: nada em memória, só o que está no banco.
    await tickOnce(buildWorker());

    const [window] = historicalSearches();
    expect(window.before).toBe(saved.historicalCoveredFrom.getTime() + 1000);
    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalCoveredFrom.getTime()).toBeLessThan(
      saved.historicalCoveredFrom.getTime(),
    );
    // O cursor incremental só avança, nunca volta.
    expect(after.windowCursorAt.getTime()).toBeGreaterThanOrEqual(
      saved.windowCursorAt.getTime(),
    );
  });

  it('conta SEM pedidos: NO_TARGET, nenhuma data inventada, nenhuma busca no passado', async () => {
    addClaim(65);
    const job = await newJob();

    await tickOnce(buildWorker());

    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalStatus).toBe('NO_TARGET');
    expect(after.historicalTargetFrom).toBeNull();
    expect(after.historicalCompletedAt).toBeNull();
    expect(after.historicalCoveredFrom).toEqual(job.historicalCoveredFrom);
    expect(historicalSearches()).toEqual([]);
    expect(await problemIds()).toEqual([]);

    // Pedido persistido depois: o histórico é reavaliado e volta a andar.
    await addOrder(100);
    await tickOnce(buildWorker());
    expect((await jobs.findByAccountId(accountId))!.historicalStatus).toBe(
      'RUNNING',
    );
    expect(historicalSearches().length).toBeGreaterThan(0);
  });

  it('pedidos mais novos que o início da cobertura: conclui sem nenhuma busca histórica', async () => {
    await addOrder(30);
    const job = await newJob();

    await tickOnce(buildWorker());

    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalStatus).toBe('COMPLETED');
    expect(after.historicalCompletedAt).not.toBeNull();
    expect(after.historicalCoveredFrom).toEqual(job.historicalCoveredFrom);
    expect(historicalSearches()).toEqual([]);
  });

  it('falha de busca NÃO avança a cobertura histórica (código sanitizado), preserva o incremental e retoma depois', async () => {
    await addOrder(100);
    const h1 = addClaim(65, 'closed');
    const job = await newJob();
    searchFailure = (call) =>
      call.before < Date.now() - 30 * DAY && call.status === 'closed'
        ? 503
        : null;
    const worker = buildWorker();

    await tickOnce(worker);

    const failed = (await jobs.findByAccountId(accountId))!;
    expect(failed.historicalCoveredFrom).toEqual(job.historicalCoveredFrom);
    expect(failed.historicalStatus).toBe('RUNNING');
    expect(failed.historicalLastErrorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(failed.status).toBe('WAITING_RETRY');
    expect(failed.windowCursorAt.getTime()).toBeGreaterThan(
      job.windowCursorAt.getTime(),
    );
    expect(await problemIds()).toEqual([]);
    const exposed = JSON.stringify([failed, warn.mock.calls]);
    for (const secret of [TOKEN, seller, 'api.mercadolibre.com']) {
      expect(exposed).not.toContain(secret);
    }

    searchFailure = () => null;
    await tickOnce(worker);
    const recovered = (await jobs.findByAccountId(accountId))!;
    expect(recovered.historicalLastErrorCode).toBeNull();
    expect(recovered.historicalCoveredFrom.getTime()).toBeLessThan(
      job.historicalCoveredFrom.getTime(),
    );
    expect(await problemIds()).toEqual([h1.id]);
  });

  it('REABERTURA: COMPLETED -> pedido mais antigo persistido -> o próximo tick reabre, preserva problemas/incremental e conclui de novo no novo alvo', async () => {
    await addOrder(70);
    const h1 = addClaim(65);
    await newJob();
    const worker = buildWorker();

    await tickOnce(worker);
    const first = (await jobs.findByAccountId(accountId))!;
    expect(first.historicalStatus).toBe('COMPLETED');
    expect(first.historicalTargetFrom).toEqual(ago(70));
    expect(first.historicalCoveredFrom).toEqual(ago(70));
    const firstCompletedAt = first.historicalCompletedAt!;
    expect(await problemIds()).toEqual([h1.id]);

    // Tick sem pedido novo: continua COMPLETED e não busca no passado.
    await tickOnce(worker);
    expect((await jobs.findByAccountId(accountId))!.historicalStatus).toBe(
      'COMPLETED',
    );
    expect(historicalSearches()).toEqual([]);

    // Chega um pedido mais antigo (e um claim dessa época).
    await addOrder(80);
    const h2 = addClaim(78, 'closed');
    const cursorBefore = (await jobs.findByAccountId(accountId))!
      .windowCursorAt;
    await tickOnce(worker);

    const reopened = (await jobs.findByAccountId(accountId))!;
    expect(reopened.historicalTargetFrom).toEqual(ago(80));
    // Preserva o progresso: continuou do cursor salvo (-70d), não do início.
    expect(historicalSearches()[0].before).toBe(ago(70).getTime() + 1000);
    expect(reopened.historicalCoveredFrom).toEqual(ago(80));
    expect(reopened.historicalStatus).toBe('COMPLETED');
    expect(reopened.historicalCompletedAt!.getTime()).toBeGreaterThan(
      firstCompletedAt.getTime(),
    );
    // Nada apagado, claim novo persistido, incremental nunca regride.
    expect(await problemIds()).toEqual([h1.id, h2.id].sort());
    expect(reopened.windowCursorAt.getTime()).toBeGreaterThanOrEqual(
      cursorBefore.getTime(),
    );
  });

  it('REABERTURA em várias passadas: reabre como RUNNING (sem data de conclusão) enquanto o novo alvo não é alcançado', async () => {
    await addOrder(70);
    await newJob();
    const worker = buildWorker();
    await tickOnce(worker);
    expect((await jobs.findByAccountId(accountId))!.historicalStatus).toBe(
      'COMPLETED',
    );

    await addOrder(120);
    await tickOnce(worker);

    const mid = (await jobs.findByAccountId(accountId))!;
    expect(mid.historicalStatus).toBe('RUNNING');
    expect(mid.historicalCompletedAt).toBeNull();
    expect(mid.historicalTargetFrom).toEqual(ago(120));
    expect(mid.historicalCoveredFrom).toEqual(ago(84));

    for (let i = 0; i < 4; i += 1) await tickOnce(worker);
    const done = (await jobs.findByAccountId(accountId))!;
    expect(done.historicalStatus).toBe('COMPLETED');
    expect(done.historicalCoveredFrom).toEqual(ago(120));
    expect(done.historicalCompletedAt).not.toBeNull();
  });

  it('404 em fetch_core: CORE_NOT_FOUND com a data da BUSCA, janela avança, sem hot loop e persiste uma única vez quando o core passa a funcionar', async () => {
    const claim = addClaim(1 / 24, 'opened', 404);
    const job = await newJob();
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET window_cursor_at = now() - interval '2 hours' WHERE id = $1`,
      [job.id],
    );
    const pending = () =>
      dataSource.query<
        Array<{
          failure_code: string;
          attempt_count: number;
          claim_date_created: Date;
          resolved_at: Date | null;
        }>
      >(
        `SELECT failure_code, attempt_count, claim_date_created, resolved_at
           FROM marketplace_problem_claim_quarantine WHERE marketplace_account_id = $1`,
        [accountId],
      );
    const worker = buildWorker();

    await tickOnce(worker);
    const [row] = await pending();
    expect(row).toMatchObject({
      failure_code: 'CORE_NOT_FOUND',
      attempt_count: 1,
      resolved_at: null,
    });
    expect(row.claim_date_created).toEqual(new Date(claim.dateCreated));
    const advanced = (await jobs.findByAccountId(accountId))!;
    expect(advanced.status).toBe('RUNNING');
    expect(advanced.lastErrorCode).toBeNull();
    expect(advanced.windowCursorAt.getTime()).toBeGreaterThan(
      job.windowCursorAt.getTime(),
    );
    expect(await problemIds()).toEqual([]);

    // Ticks seguintes não chamam o core de novo antes do backoff vencer.
    await tickOnce(worker);
    await tickOnce(worker);
    expect(coreCalls).toEqual([]);
    expect((await pending())[0].attempt_count).toBe(1);

    claim.coreStatus = 200;
    await dataSource.query(
      `UPDATE marketplace_problem_claim_quarantine
          SET next_attempt_at = now() - interval '1 second'`,
    );
    await tickOnce(worker);
    expect(await problemIds()).toEqual([claim.id]);
    expect((await pending())[0].resolved_at).not.toBeNull();
    await tickOnce(worker);
    expect(await problemIds()).toEqual([claim.id]);
  });

  it('invalid_response no core de uma janela HISTÓRICA: não vira quarentena, o cursor não avança e há espera durável (sem retry a cada tick)', async () => {
    await addOrder(100);
    const bad = addClaim(65);
    bad.coreInvalid = true;
    const job = await newJob();
    const worker = buildWorker();

    await tickOnce(worker);

    const first = (await jobs.findByAccountId(accountId))!;
    expect(first.historicalCoveredFrom).toEqual(job.historicalCoveredFrom);
    expect(first.historicalStatus).toBe('RUNNING');
    expect(first.historicalAttemptCount).toBe(1);
    expect(first.historicalLastErrorCode).toBe('CORE_COVERAGE_INCOMPLETE');
    expect(first.historicalNextAttemptAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    // O incremental não é afetado.
    expect(first.status).toBe('RUNNING');
    expect(first.attemptCount).toBe(0);
    expect(coreCalls).toContain(bad.id);
    expect(
      await dataSource.query<unknown[]>(
        `SELECT 1 FROM marketplace_problem_claim_quarantine WHERE marketplace_account_id = $1`,
        [accountId],
      ),
    ).toEqual([]);

    // Sem hot loop: com a espera ativa, nem busca nem core no passado.
    await tickOnce(worker);
    await tickOnce(worker);
    expect(historicalSearches()).toEqual([]);
    expect(coreCalls).toEqual([]);
    expect(
      (await jobs.findByAccountId(accountId))!.historicalAttemptCount,
    ).toBe(1);

    // Espera vencida e ainda inválido: nova tentativa, backoff maior.
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs SET historical_next_attempt_at = now() - interval '1 second'`,
    );
    await tickOnce(worker);
    const second = (await jobs.findByAccountId(accountId))!;
    expect(second.historicalAttemptCount).toBe(2);
    expect(second.historicalCoveredFrom).toEqual(job.historicalCoveredFrom);

    // Core volta ao normal: a janela avança e a espera é limpa.
    bad.coreInvalid = false;
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs SET historical_next_attempt_at = now() - interval '1 second'`,
    );
    await tickOnce(worker);
    const recovered = (await jobs.findByAccountId(accountId))!;
    expect(recovered.historicalCoveredFrom.getTime()).toBeLessThan(
      job.historicalCoveredFrom.getTime(),
    );
    expect(recovered.historicalAttemptCount).toBe(0);
    expect(recovered.historicalNextAttemptAt).toBeNull();
    expect(recovered.historicalLastErrorCode).toBeNull();
    expect(await problemIds()).toEqual([bad.id]);
  });

  it('403 em fetch_core dentro da janela histórica: quarentena única, a janela AVANÇA e o problema não vira linha sincronizada', async () => {
    await addOrder(100);
    const ok = addClaim(65);
    const blocked = addClaim(66, 'opened', 403);
    const job = await newJob();
    const worker = buildWorker();

    await tickOnce(worker);

    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalCoveredFrom.getTime()).toBeLessThan(
      job.historicalCoveredFrom.getTime(),
    );
    expect(after.status).toBe('RUNNING');
    expect(after.lastErrorCode).toBeNull();
    expect(await problemIds()).toEqual([ok.id]);
    const quarantine = await dataSource.query<
      Array<{ external_claim_id: string; attempt_count: number }>
    >(
      `SELECT external_claim_id, attempt_count
         FROM marketplace_problem_claim_quarantine
        WHERE marketplace_account_id = $1`,
      [accountId],
    );
    expect(quarantine).toEqual([
      { external_claim_id: blocked.id, attempt_count: 1 },
    ]);
  });

  it('INCREMENTAL PRIORITÁRIO: sem orçamento restante no tick, o histórico não faz nenhuma busca nem avança', async () => {
    await addOrder(100);
    addClaim(65);
    const job = await newJob();

    // 2 chamadas: só a sondagem opened+closed da criação cabe.
    await tickOnce(
      buildWorker({ PROBLEMS_SYNC_WORKER_TICK_MAX_HTTP_CALLS: 2 }),
    );

    expect(historicalSearches()).toEqual([]);
    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.historicalCoveredFrom).toEqual(job.historicalCoveredFrom);
    expect(after.windowCursorAt.getTime()).toBeGreaterThan(
      job.windowCursorAt.getTime(),
    );
  });

  it('PERDA de lease/CAS no meio do tick: o progresso histórico NÃO é gravado; a janela é refeita depois sem duplicar', async () => {
    await addOrder(100);
    const h1 = addClaim(65);
    const job = await newJob();
    let stolen = false;
    beforeSearch = async (call) => {
      if (stolen || call.before > Date.now() - 30 * DAY) return;
      stolen = true;
      // Outro worker assume o job (version muda) enquanto este busca.
      await dataSource.query(
        `UPDATE marketplace_problems_sync_jobs
            SET version = version + 1, lease_owner = 'outro-worker'
          WHERE id = $1`,
        [job.id],
      );
    };
    const worker = buildWorker();

    await tickOnce(worker);

    const lost = (await jobs.findByAccountId(accountId))!;
    expect(stolen).toBe(true);
    expect(lost.leaseOwner).toBe('outro-worker');
    expect(lost.historicalCoveredFrom).toEqual(job.historicalCoveredFrom);
    expect(lost.historicalStatus).toBe('RUNNING');
    // O upsert é idempotente: o problema pode existir, mas a cobertura não andou.
    expect(await problemIds()).toEqual([h1.id]);

    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs SET lease_owner = NULL, lease_expires_at = NULL`,
    );
    await tickOnce(worker);
    const redone = (await jobs.findByAccountId(accountId))!;
    expect(redone.historicalCoveredFrom.getTime()).toBeLessThan(
      job.historicalCoveredFrom.getTime(),
    );
    expect(await problemIds()).toEqual([h1.id]);
  });

  it('pausar/retomar o histórico: pausado não busca no passado (o incremental segue); retoma do cursor salvo', async () => {
    await addOrder(100);
    addClaim(65);
    await newJob();
    const worker = buildWorker();
    await tickOnce(worker);
    const saved = (await jobs.findByAccountId(accountId))!;

    await jobs.pauseHistorical(accountId);
    await tickOnce(worker);
    expect(historicalSearches()).toEqual([]);
    // O incremental continuou rodando (2 buscas da criação).
    expect(searches).toHaveLength(2);
    const paused = (await jobs.findByAccountId(accountId))!;
    expect(paused.historicalStatus).toBe('PAUSED');
    expect(paused.historicalCoveredFrom).toEqual(saved.historicalCoveredFrom);

    await jobs.resumeHistorical(accountId);
    await tickOnce(worker);
    const resumed = (await jobs.findByAccountId(accountId))!;
    expect(historicalSearches()[0].before).toBe(
      saved.historicalCoveredFrom.getTime() + 1000,
    );
    expect(resumed.historicalCoveredFrom.getTime()).toBeLessThan(
      saved.historicalCoveredFrom.getTime(),
    );
  });

  it('quarentena no worker: retry periódico incrementa tentativas SEM duplicar; sucesso futuro resolve e cria um ÚNICO problema', async () => {
    const claim = addClaim(1 / 24, 'opened', 403);
    const job = await newJob();
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET window_cursor_at = now() - interval '2 hours' WHERE id = $1`,
      [job.id],
    );
    const quarantineOf = () =>
      dataSource.query<
        Array<{ attempt_count: number; resolved_at: Date | null }>
      >(
        `SELECT attempt_count, resolved_at FROM marketplace_problem_claim_quarantine
          WHERE marketplace_account_id = $1 AND external_claim_id = $2`,
        [accountId, claim.id],
      );
    const makeQuarantineDue = () =>
      dataSource.query(
        `UPDATE marketplace_problem_claim_quarantine
            SET next_attempt_at = now() - interval '1 second'
          WHERE marketplace_account_id = $1`,
        [accountId],
      );
    const worker = buildWorker();

    await tickOnce(worker);
    expect(await quarantineOf()).toEqual([
      { attempt_count: 1, resolved_at: null },
    ]);
    expect(await problemIds()).toEqual([]);

    // Retry ainda não vencido: nada é reprocessado.
    await tickOnce(worker);
    expect(await quarantineOf()).toEqual([
      { attempt_count: 1, resolved_at: null },
    ]);

    // Vencido e ainda 403: incrementa tentativa, nunca duplica.
    await makeQuarantineDue();
    await tickOnce(worker);
    expect(await quarantineOf()).toEqual([
      { attempt_count: 2, resolved_at: null },
    ]);
    expect(await problemIds()).toEqual([]);

    // Provedor libera o claim: persiste UMA vez e resolve a quarentena.
    claim.coreStatus = 200;
    await makeQuarantineDue();
    await tickOnce(worker);
    const [resolved] = await quarantineOf();
    expect(resolved.resolved_at).not.toBeNull();
    expect(await problemIds()).toEqual([claim.id]);

    // Resolvida: nunca mais reprocessada, e o problema segue único.
    await tickOnce(worker);
    expect(await problemIds()).toEqual([claim.id]);
    expect(await quarantineOf()).toHaveLength(1);
  });

  it('divide a janela automaticamente quando o volume não cabe no orçamento, sem perder nenhum claim das fronteiras', async () => {
    await addOrder(100);
    // 30 claims em ~2 dias dentro da MESMA janela de 14 dias (orçamento de 12 por tick).
    const created = Array.from({ length: 30 }, (_, i) => addClaim(70 + i / 15));
    await newJob();
    const worker = buildWorker({
      PROBLEMS_SYNC_WORKER_TICK_MAX_CLAIMS: 12,
      PROBLEMS_SYNC_WORKER_REFRESH_BATCH_SIZE: 1,
      PROBLEMS_SYNC_WORKER_TICK_MAX_HTTP_CALLS: 300,
    });

    for (let i = 0; i < 25 && (await problemIds()).length < 30; i += 1) {
      await tickOnce(worker);
    }

    const after = (await jobs.findByAccountId(accountId))!;
    expect(await problemIds()).toEqual(created.map((c) => c.id).sort());
    // A cobertura chegou (no mínimo) ao claim mais antigo.
    expect(after.historicalCoveredFrom.getTime()).toBeLessThanOrEqual(
      Date.parse(created[created.length - 1].dateCreated),
    );
  });
});
