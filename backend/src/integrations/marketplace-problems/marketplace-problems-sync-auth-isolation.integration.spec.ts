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
import { MarketplaceProblemsSyncManagementService } from './marketplace-problems-sync-management.service';
import { buildProblemsSyncServices } from './marketplace-problems-sync-test-wiring';
import { MarketplaceProblemClaimQuarantineRepository } from './marketplace-problem-claim-quarantine.repository';
import { MarketplaceProblemsSyncWorkerService } from './marketplace-problems-sync-worker.service';

const TOKEN = 'fake-token-auth-isolation';
const REASON_ID = 'PDD9999';

type Operation = 'search' | 'core' | 'detail' | 'reputation' | 'reason';

/** Regra de falha do fake: devolve o status HTTP a simular, ou `null` (sucesso). */
type FailureRule = (
  op: Operation,
  seller: string,
  claimId: string | null,
) => number | null;

interface FakeClaim {
  id: string;
  seller: string;
  dateCreated: string;
  lastUpdated: string;
  impact: 'affected' | 'not_affected';
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function rawClaim(claim: FakeClaim) {
  return {
    id: claim.id,
    resource_id: `order-${claim.id}`,
    resource: 'order',
    status: 'opened',
    type: 'mediations',
    stage: 'claim',
    site_id: 'MLB',
    reason_id: REASON_ID,
    parent_id: null,
    fulfilled: null,
    quantity_type: null,
    date_created: claim.dateCreated,
    last_updated: claim.lastUpdated,
    players: [],
    resolution: null,
  };
}

/** Fake do Mercado Livre por seller (`players.user_id`) com falha configurável por operação. */
function buildFakeFetch(
  claims: FakeClaim[],
  rule: () => FailureRule,
  calls: Array<{ op: Operation; seller: string; claimId: string | null }>,
) {
  return ((urlString: string) => {
    const url = new URL(urlString);
    const respond = (
      op: Operation,
      seller: string,
      claimId: string | null,
      body: () => unknown,
    ) => {
      calls.push({ op, seller, claimId });
      const status = rule()(op, seller, claimId);
      return Promise.resolve(
        status === null ? jsonResponse(200, body()) : jsonResponse(status, {}),
      );
    };

    if (url.pathname === '/post-purchase/v1/claims/search') {
      const seller = url.searchParams.get('players.user_id') ?? '';
      const status = url.searchParams.get('status');
      const range = url.searchParams.get('range');
      const match = /after:([^,]+),before:(.+)$/.exec(range ?? '');
      const after = match ? Date.parse(match[1]) : -Infinity;
      const before = match ? Date.parse(match[2]) : Infinity;
      const found = claims.filter((c) => {
        const at = Date.parse(c.dateCreated);
        return (
          c.seller === seller &&
          status === 'opened' &&
          at >= after &&
          at <= before
        );
      });
      return respond('search', seller, null, () => ({
        paging: { total: found.length, offset: 0, limit: 100 },
        data: found.map(rawClaim),
      }));
    }
    if (url.pathname === `/post-purchase/v1/claims/reasons/${REASON_ID}`) {
      return respond('reason', '', null, () => ({
        flow: 'mediations',
        name: 'Motivo',
        status: 'active',
      }));
    }
    const match = url.pathname.match(
      /^\/post-purchase\/v1\/claims\/([^/]+)(\/detail|\/affects-reputation)?$/,
    );
    const claim = match ? claims.find((c) => c.id === match[1]) : undefined;
    if (!match || !claim) return Promise.resolve(jsonResponse(404, {}));
    if (match[2] === '/affects-reputation') {
      return respond('reputation', claim.seller, claim.id, () => ({
        affects_reputation: claim.impact,
      }));
    }
    if (match[2] === '/detail') {
      return respond('detail', claim.seller, claim.id, () => ({
        ...rawClaim(claim),
        claim_version: '1',
        detail: { title: `Título ${claim.impact}` },
      }));
    }
    return respond('core', claim.seller, claim.id, () => ({
      ...rawClaim(claim),
      claim_version: '1',
    }));
  }) as unknown as typeof fetch;
}

const fakeConfig = (values: Record<string, unknown> = {}) =>
  ({
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('401/403 por operação no worker de Problemas (Postgres real + HTTP fake, duas contas)', () => {
  let dataSource: DataSource;
  let jobs: MarketplaceProblemsSyncJobsPersistenceService;
  let problems: MarketplaceProblemsPersistenceService;
  let reasonCache: MarketplaceProblemReasonsCacheRepository;
  let warn: jest.SpyInstance;
  let ml1: { id: string; seller: string };
  let ml2: { id: string; seller: string };
  let claims: FakeClaim[];
  let calls: Array<{ op: Operation; seller: string; claimId: string | null }>;
  let currentRule: FailureRule;

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

  async function newAccount() {
    const seller = String(Math.floor(Math.random() * 1e12));
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, status, external_seller_id,
         encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'CONNECTED', $2, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`, seller],
    );
    return { id: row.id, seller };
  }

  beforeEach(async () => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    await dataSource.query(`DELETE FROM marketplace_problems_sync_jobs`);
    // Cache de motivo sempre vazio: o reason é consultado em todo tick.
    await dataSource.query(`DELETE FROM marketplace_problem_reasons`);
    ml1 = await newAccount();
    ml2 = await newAccount();
    claims = [];
    calls = [];
    currentRule = () => null;
  });

  afterEach(() => warn.mockRestore());

  const minutesAgo = (m: number) =>
    new Date(Date.now() - m * 60_000).toISOString();

  function addClaim(
    account: { seller: string },
    impact: FakeClaim['impact'] = 'affected',
  ): FakeClaim {
    const at = minutesAgo(60);
    const claim = {
      id: String(Math.floor(Math.random() * 1e12)),
      seller: account.seller,
      dateCreated: at,
      lastUpdated: at,
      impact,
    };
    claims.push(claim);
    return claim;
  }

  function buildWorker() {
    const httpClient = new MercadoLivreClaimsHttpClient(
      fakeConfig(),
      buildFakeFetch(claims, () => currentRule, calls),
    );
    const sellerOf = (accountId: string) =>
      accountId === ml1.id ? ml1.seller : ml2.seller;
    const preflight = {
      resolveAccountAndToken: jest.fn((accountId: string) =>
        Promise.resolve({
          accessToken: TOKEN,
          externalSellerId: sellerOf(accountId),
        }),
      ),
    };
    const { tick } = buildProblemsSyncServices({
      dataSource,
      preflight,
      httpClient,
      reasonCache,
      problems,
      configService: fakeConfig(),
    });
    return new MarketplaceProblemsSyncWorkerService(
      fakeConfig({
        PROBLEMS_SYNC_WORKER_TICK_MAX_CLAIMS: 50,
        PROBLEMS_SYNC_WORKER_TICK_MAX_HTTP_CALLS: 300,
        PROBLEMS_SYNC_WORKER_MAX_CONCURRENT_JOBS: 2,
      }),
      jobs,
      tick,
    );
  }

  /** Job com cursor 2h atrás e censo em dia (o tick roda só criação + refresh). */
  async function newJob(accountId: string) {
    const created = await jobs.createIfAbsent(accountId, new Date());
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET window_cursor_at = now() - interval '2 hours', last_census_at = now()
        WHERE id = $1`,
      [created.id],
    );
    return (await jobs.findByAccountId(accountId))!;
  }

  async function makeDue(jobId: string) {
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET next_attempt_at = now() - interval '1 second'
        WHERE id = $1`,
      [jobId],
    );
  }

  async function rows(accountId: string) {
    return dataSource.query<
      Array<{
        external_claim_id: string;
        reputation_impact: string | null;
        detail_title: string | null;
        responsibility: string;
        responsibility_confidence: string;
      }>
    >(
      `SELECT external_claim_id, reputation_impact, detail_title,
              responsibility, responsibility_confidence
         FROM marketplace_problems
        WHERE marketplace_account_id = $1
        ORDER BY external_claim_id`,
      [accountId],
    );
  }

  async function quarantineRows(accountId: string) {
    return dataSource.query<
      Array<{
        external_claim_id: string;
        failure_code: string;
        attempt_count: number;
        resolved_at: Date | null;
      }>
    >(
      `SELECT external_claim_id, failure_code, attempt_count, resolved_at
         FROM marketplace_problem_claim_quarantine
        WHERE marketplace_account_id = $1 ORDER BY external_claim_id`,
      [accountId],
    );
  }

  async function accountStatus(accountId: string) {
    const [row] = await dataSource.query<Array<{ status: string }>>(
      `SELECT status FROM marketplace_accounts WHERE id = $1`,
      [accountId],
    );
    return row.status;
  }

  it.each([
    ['detail', 'detail_title'],
    ['reputation', 'reputation_impact'],
    ['reason', null],
  ] as const)(
    '403 em %s: core persiste, conta segue RUNNING, cursor avança e valor já persistido NÃO é apagado',
    async (failingOp, column) => {
      const job = await newJob(ml1.id);
      const a = addClaim(ml1, 'affected');
      const b = addClaim(ml1, 'not_affected');
      const worker = buildWorker();

      // Tick 1: tudo com sucesso — grava os enriquecimentos.
      await worker.runTickOnce();
      const before = await rows(ml1.id);
      expect(before.map((r) => r.external_claim_id).sort()).toEqual(
        [a.id, b.id].sort(),
      );

      // Tick 2: claim `a` atualizado no provedor; 403 só no enriquecimento de `a` (ou no reason).
      a.lastUpdated = new Date().toISOString();
      a.impact = 'not_affected';
      currentRule = (op, _seller, claimId) =>
        op === failingOp && (failingOp === 'reason' || claimId === a.id)
          ? 403
          : null;
      // Cache de motivo vencido: força a consulta do reason no tick 2.
      await dataSource.query(`DELETE FROM marketplace_problem_reasons`);
      await makeDue(job.id);
      const afterFirst = (await jobs.findByAccountId(ml1.id))!;
      calls.length = 0;
      await worker.runTickOnce();

      // O 403 realmente aconteceu na operação testada.
      expect(calls.some((c) => c.op === failingOp)).toBe(true);

      const after = (await jobs.findByAccountId(ml1.id))!;
      expect(after.status).toBe('RUNNING');
      expect(after.lastErrorCode).toBeNull();
      expect(after.windowCursorAt.getTime()).toBeGreaterThanOrEqual(
        afterFirst.windowCursorAt.getTime(),
      );
      expect(await accountStatus(ml1.id)).toBe('CONNECTED');
      const current = await rows(ml1.id);
      expect(current).toHaveLength(2);
      if (column !== null) {
        const rowA = current.find((r) => r.external_claim_id === a.id)!;
        const rowABefore = before.find((r) => r.external_claim_id === a.id)!;
        // Sem informação nova (fetched:false): nunca troca pelo valor atual do fake nem apaga.
        expect(rowA[column]).toBe(rowABefore[column]);
        expect(rowA[column]).not.toBeNull();
      }
    },
  );

  it('403 em fetch_core: quarentena durável, sem FAILED_AUTH, janela AVANÇA, retomável sem duplicar e sem perder a correção manual', async () => {
    const job = await newJob(ml1.id);
    const a = addClaim(ml1);
    const b = addClaim(ml1);
    currentRule = (op, _seller, claimId) =>
      op === 'core' && claimId === b.id ? 403 : null;
    const worker = buildWorker();

    await worker.runTickOnce();

    const first = (await jobs.findByAccountId(ml1.id))!;
    expect(first.status).toBe('RUNNING');
    expect(first.lastErrorCode).toBeNull();
    expect(first.attemptCount).toBe(0);
    // O claim bloqueado NÃO trava a janela: o cursor avança.
    expect(first.windowCursorAt.getTime()).toBeGreaterThan(
      job.windowCursorAt.getTime(),
    );
    expect(await accountStatus(ml1.id)).toBe('CONNECTED');
    expect((await rows(ml1.id)).map((r) => r.external_claim_id)).toEqual([
      a.id,
    ]);
    expect(await quarantineRows(ml1.id)).toEqual([
      expect.objectContaining({
        external_claim_id: b.id,
        failure_code: 'CORE_FORBIDDEN',
        attempt_count: 1,
        resolved_at: null,
      }),
    ]);

    // Correção manual de responsabilidade no claim já persistido.
    await dataSource.query(
      `UPDATE marketplace_problems
          SET responsibility = 'SELLER', responsibility_confidence = 'MANUAL',
              responsibility_source = 'manual', responsibility_overridden_at = now(),
              responsibility_override_reason = 'conferido'
        WHERE marketplace_account_id = $1 AND external_claim_id = $2`,
      [ml1.id, a.id],
    );

    // Provedor volta a liberar o claim: o retry da quarentena o persiste e a resolve.
    currentRule = () => null;
    await dataSource.query(
      `UPDATE marketplace_problem_claim_quarantine
          SET next_attempt_at = now() - interval '1 second'
        WHERE marketplace_account_id = $1`,
      [ml1.id],
    );
    await makeDue(job.id);
    await worker.runTickOnce();

    const recovered = (await jobs.findByAccountId(ml1.id))!;
    expect(recovered.status).toBe('RUNNING');
    expect(recovered.lastErrorCode).toBeNull();
    const final = await rows(ml1.id);
    expect(final.map((r) => r.external_claim_id)).toEqual([a.id, b.id].sort());
    const rowA = final.find((r) => r.external_claim_id === a.id)!;
    expect(rowA.responsibility).toBe('SELLER');
    expect(rowA.responsibility_confidence).toBe('MANUAL');
    const quarantined = await quarantineRows(ml1.id);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0].resolved_at).not.toBeNull();
  });

  it.each([
    [403, 'SEARCH_FORBIDDEN'],
    [401, 'SEARCH_UNAUTHORIZED'],
  ] as const)(
    'busca %i na ML1: FAILED_AUTH com %s, cursor parado, UMA chamada (sem retry); ML2 segue normal',
    async (httpStatus, code) => {
      const job1 = await newJob(ml1.id);
      const job2 = await newJob(ml2.id);
      addClaim(ml1);
      const c2 = addClaim(ml2);
      currentRule = (op, seller) =>
        op === 'search' && seller === ml1.seller ? httpStatus : null;
      const worker = buildWorker();

      await worker.runTickOnce();

      const after1 = (await jobs.findByAccountId(ml1.id))!;
      expect(after1.status).toBe('FAILED_AUTH');
      expect(after1.lastErrorCode).toBe(code);
      expect(after1.windowCursorAt.getTime()).toBe(
        job1.windowCursorAt.getTime(),
      );
      expect(await rows(ml1.id)).toEqual([]);
      expect(await accountStatus(ml1.id)).toBe('CONNECTED');

      const after2 = (await jobs.findByAccountId(ml2.id))!;
      expect(after2.status).toBe('RUNNING');
      expect(after2.lastErrorCode).toBeNull();
      expect(after2.windowCursorAt.getTime()).toBeGreaterThan(
        job2.windowCursorAt.getTime(),
      );
      expect((await rows(ml2.id)).map((r) => r.external_claim_id)).toEqual([
        c2.id,
      ]);
      // ML1: só a 1ª busca foi tentada (sem loop de retry, nada depois dela);
      // ML2: as 2 buscas da janela de criação (opened + closed).
      const searchesBySeller = (seller: string) =>
        calls.filter((c) => c.seller === seller && c.op === 'search');
      expect(calls.filter((c) => c.seller === ml1.seller)).toHaveLength(1);
      expect(searchesBySeller(ml1.seller)).toHaveLength(1);
      expect(searchesBySeller(ml2.seller)).toHaveLength(2);

      // Tick seguinte: FAILED_AUTH não é reivindicado sozinho.
      calls.length = 0;
      await worker.runTickOnce();
      expect(calls).toEqual([]);
    },
  );

  it('401 em enriquecimento (detail) continua terminal: FAILED_AUTH com DETAIL_UNAUTHORIZED e cursor parado', async () => {
    const job = await newJob(ml1.id);
    addClaim(ml1);
    currentRule = (op) => (op === 'detail' ? 401 : null);
    const worker = buildWorker();

    await worker.runTickOnce();

    const after = (await jobs.findByAccountId(ml1.id))!;
    expect(after.status).toBe('FAILED_AUTH');
    expect(after.lastErrorCode).toBe('DETAIL_UNAUTHORIZED');
    expect(after.windowCursorAt.getTime()).toBe(job.windowCursorAt.getTime());
    expect(calls.filter((c) => c.op === 'detail')).toHaveLength(1);
  });

  it('status exposto pela API e log de diagnóstico continuam sanitizados', async () => {
    await newJob(ml1.id);
    addClaim(ml1);
    currentRule = (op) => (op === 'core' ? 403 : null);
    const worker = buildWorker();

    await worker.runTickOnce();

    const account = { id: ml1.id, nickname: 'Conta 1' };
    const management = new MarketplaceProblemsSyncManagementService(
      jobs,
      new MarketplaceProblemClaimQuarantineRepository(dataSource),
      {} as never,
      {
        findAllForScope: () =>
          Promise.resolve([{ ...account, marketplace: 'MERCADO_LIVRE' }]),
      } as never,
      fakeConfig(),
    );
    const [status] = await management.status({ mode: 'ALL' } as never);
    // 403 isolado vira quarentena: o job não registra erro, a pendência é contada.
    expect(status.lastErrorCode).toBeNull();
    expect(status.quarantinedClaimsCount).toBe(1);
    expect(Object.keys(status).sort()).toEqual(
      [
        'accountId',
        'accountNickname',
        'attemptCount',
        'claimsProcessedCount',
        'historicalCompletedAt',
        'historicalCoveredFrom',
        'historicalLastErrorCode',
        'historicalStatus',
        'historicalTargetFrom',
        'incrementalCoveredThrough',
        'jobStatus',
        'lastActivityAt',
        'lastCompleteCensusAt',
        'lastErrorCode',
        'nextAttemptAt',
        'pauseRequested',
        'quarantinedClaimsCount',
        'windowCursorAt',
        'workerEnabled',
      ].sort(),
    );

    expect(warn).toHaveBeenCalledWith('ml_claims_http_failure', {
      operation: 'fetch_core',
      category: 'forbidden',
      httpStatus: 403,
      validatorStage: null,
    });
    const quarantineDump = await dataSource.query<unknown[]>(
      `SELECT * FROM marketplace_problem_claim_quarantine`,
    );
    const exposed = JSON.stringify([status, warn.mock.calls, quarantineDump]);
    for (const secret of [TOKEN, ml1.seller, 'api.mercadolibre.com']) {
      expect(exposed).not.toContain(secret);
    }
  });
});
