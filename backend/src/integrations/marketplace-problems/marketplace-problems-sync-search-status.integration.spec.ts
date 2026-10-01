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

const TOKEN = 'fake-token-xyz';
const SELLER = '424242';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Estado mutável de um claim no fake (o teste pode fechá-lo entre ticks). */
interface FakeClaim {
  id: string;
  status: 'opened' | 'closed';
  dateCreated: string;
  lastUpdated: string;
}

function rawClaim(claim: FakeClaim) {
  return {
    id: claim.id,
    resource_id: `order-${claim.id}`,
    resource: 'order',
    status: claim.status,
    type: 'mediations',
    stage: 'claim',
    site_id: 'MLB',
    reason_id: null,
    parent_id: null,
    fulfilled: null,
    quantity_type: null,
    date_created: claim.dateCreated,
    last_updated: claim.lastUpdated,
    players: [],
    resolution:
      claim.status === 'closed'
        ? { reason: 'x', date_created: claim.lastUpdated }
        : null,
  };
}

type SearchFailure = 'none' | `${'closed' | 'opened'}_${'400' | 'invalid'}`;

interface SearchCall {
  status: string | null;
  hasRange: boolean;
}

/**
 * Fake do Mercado Livre com o comportamento OBSERVADO em produção: busca SEM
 * `status` responde 400. Com `status`, devolve os claims daquele status
 * (filtrados por `date_created` quando há `range`). `failure` simula falha de
 * UMA das buscas (400 ou envelope fora do contrato).
 */
function buildFakeFetch(
  claims: FakeClaim[],
  failure: SearchFailure,
  searchCalls: SearchCall[],
) {
  const byId = (id: string) => claims.find((c) => c.id === id);
  return ((urlString: string) => {
    const url = new URL(urlString);
    if (url.pathname === '/post-purchase/v1/claims/search') {
      const status = url.searchParams.get('status');
      const range = url.searchParams.get('range');
      searchCalls.push({ status, hasRange: range !== null });
      if (status === null) return Promise.resolve(jsonResponse(400, {}));
      if (failure === `${status}_400`) {
        return Promise.resolve(jsonResponse(400, {}));
      }
      if (failure === `${status}_invalid`) {
        return Promise.resolve(jsonResponse(200, { results: [] }));
      }
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const match = /after:([^,]+),before:(.+)$/.exec(range ?? '');
      const after = match ? Date.parse(match[1]) : -Infinity;
      const before = match ? Date.parse(match[2]) : Infinity;
      const found = claims.filter((c) => {
        const at = Date.parse(c.dateCreated);
        return c.status === status && at >= after && at <= before;
      });
      return Promise.resolve(
        jsonResponse(200, {
          paging: { total: found.length, offset, limit },
          data: found.slice(offset, offset + limit).map(rawClaim),
        }),
      );
    }
    const match = url.pathname.match(
      /^\/post-purchase\/v1\/claims\/([^/]+)(\/detail|\/affects-reputation)?$/,
    );
    const claim = match ? byId(match[1]) : undefined;
    if (match && claim) {
      const suffix = match[2];
      if (suffix === '/affects-reputation') {
        return Promise.resolve(
          jsonResponse(200, { affects_reputation: 'not_applies' }),
        );
      }
      const body = { ...rawClaim(claim), claim_version: '1' };
      return Promise.resolve(
        jsonResponse(
          200,
          suffix === '/detail' ? { ...body, detail: null } : body,
        ),
      );
    }
    return Promise.resolve(jsonResponse(404, {}));
  }) as unknown as typeof fetch;
}

const fakeConfig = (values: Record<string, unknown> = {}) =>
  ({
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('Janela de criação com opened + closed no tick (Postgres real + HTTP mockado com o 400 de produção)', () => {
  let dataSource: DataSource;
  let jobs: MarketplaceProblemsSyncJobsPersistenceService;
  let problems: MarketplaceProblemsPersistenceService;
  let reasonCache: MarketplaceProblemReasonsCacheRepository;
  let accountId: string;
  let warn: jest.SpyInstance;

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
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`],
    );
    accountId = account.id;
  });

  afterEach(() => warn.mockRestore());

  function buildWorker(
    claims: FakeClaim[],
    failure: SearchFailure,
    searchCalls: SearchCall[],
  ) {
    const httpClient = new MercadoLivreClaimsHttpClient(
      fakeConfig(),
      buildFakeFetch(claims, failure, searchCalls),
    );
    const preflight = {
      resolveAccountAndToken: jest.fn().mockResolvedValue({
        accessToken: TOKEN,
        externalSellerId: SELLER,
      }),
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
      }),
      jobs,
      tick,
    );
  }

  /** Job com cursor 2h atrás (janela curta: uma única página por status). */
  async function newJob(censusDue = true) {
    const created = await jobs.createIfAbsent(accountId, new Date());
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs
          SET window_cursor_at = now() - interval '2 hours',
              last_census_at = CASE WHEN $2 THEN NULL ELSE now() END
        WHERE id = $1`,
      [created.id, censusDue],
    );
    return (await jobs.findByAccountId(accountId))!;
  }

  async function persisted(): Promise<Array<{ id: string; status: string }>> {
    const rows = await dataSource.query<
      Array<{ external_claim_id: string; status: string }>
    >(
      `SELECT external_claim_id, status FROM marketplace_problems
        WHERE marketplace_account_id = $1 ORDER BY external_claim_id`,
      [accountId],
    );
    return rows.map((r) => ({ id: r.external_claim_id, status: r.status }));
  }

  const minutesAgo = (m: number) =>
    new Date(Date.now() - m * 60_000).toISOString();

  function claim(
    prefix: string,
    status: FakeClaim['status'],
    createdMinutesAgo = 60,
  ): FakeClaim {
    const at = minutesAgo(createdMinutesAgo);
    return {
      id: `${prefix}-${randomUUID()}`,
      status,
      dateCreated: at,
      lastUpdated: at,
    };
  }

  it('sucesso: criação consulta opened E closed com range, persiste os dois e avança o cursor; censo só opened sem range; nenhuma busca sem status', async () => {
    const job = await newJob();
    const closed = claim('closed', 'closed');
    const opened = claim('opened', 'opened');
    const searchCalls: SearchCall[] = [];
    const worker = buildWorker([closed, opened], 'none', searchCalls);

    await worker.runTickOnce();

    expect(searchCalls.filter((c) => c.status === null)).toEqual([]);
    expect(searchCalls).toEqual([
      { status: 'opened', hasRange: true },
      { status: 'closed', hasRange: true },
      { status: 'opened', hasRange: false },
    ]);
    expect(await persisted()).toEqual(
      [
        { id: closed.id, status: 'closed' },
        { id: opened.id, status: 'opened' },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.status).toBe('RUNNING');
    expect(after.lastErrorCode).toBeNull();
    expect(after.windowCursorAt.getTime()).toBeGreaterThan(
      job.windowCursorAt.getTime(),
    );
    expect(after.lastCompleteCensusAt).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('lacuna fechada: claim opened na janela, SEM censo no tick, é persistido antes do cursor avançar; fechado depois, o refresh o atualiza sem duplicar', async () => {
    const job = await newJob(false);
    const target = claim('target', 'opened');
    const searchCalls: SearchCall[] = [];
    const worker = buildWorker([target], 'none', searchCalls);

    await worker.runTickOnce();

    // Censo não venceu: só as buscas da janela de criação rodaram.
    expect(searchCalls.every((c) => c.hasRange)).toBe(true);
    expect(await persisted()).toEqual([{ id: target.id, status: 'opened' }]);
    const afterFirst = (await jobs.findByAccountId(accountId))!;
    expect(afterFirst.windowCursorAt.getTime()).toBeGreaterThan(
      job.windowCursorAt.getTime(),
    );

    // Fecha no provedor antes de qualquer censo; o cursor já passou da data_created.
    target.status = 'closed';
    target.lastUpdated = new Date().toISOString();
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1`,
      [job.id],
    );
    await worker.runTickOnce();

    expect(await persisted()).toEqual([{ id: target.id, status: 'closed' }]);
    const afterSecond = (await jobs.findByAccountId(accountId))!;
    expect(afterSecond.lastErrorCode).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['closed', '400', 400, null],
    ['closed', 'invalid', 200, 'data'],
    ['opened', '400', 400, null],
    ['opened', 'invalid', 200, 'data'],
  ] as const)(
    'falha SÓ na busca %s (%s): cursor NÃO avança, nada persiste, censo/refresh não rodam, retry transitório e diagnóstico sanitizado com o status',
    async (failingStatus, kind, httpStatus, validatorStage) => {
      const job = await newJob();
      const closed = claim('closed', 'closed');
      const opened = claim('opened', 'opened');
      const searchCalls: SearchCall[] = [];
      const worker = buildWorker(
        [closed, opened],
        `${failingStatus}_${kind}`,
        searchCalls,
      );

      await worker.runTickOnce();

      // Ordem fixa opened -> closed; nada depois da busca que falhou.
      expect(searchCalls).toEqual(
        failingStatus === 'opened'
          ? [{ status: 'opened', hasRange: true }]
          : [
              { status: 'opened', hasRange: true },
              { status: 'closed', hasRange: true },
            ],
      );
      expect(await persisted()).toEqual([]);
      const after = (await jobs.findByAccountId(accountId))!;
      expect(after.windowCursorAt.getTime()).toBe(job.windowCursorAt.getTime());
      expect(after.status).toBe('WAITING_RETRY');
      expect(after.lastErrorCode).toBe('SEARCH_CONTRACT_ERROR');
      expect(after.attemptCount).toBe(1);
      expect(after.lastCompleteCensusAt).toBeNull();
      expect(after.claimsPersistedCount).toBe(0);

      expect(warn).toHaveBeenCalledWith('ml_claims_http_failure', {
        operation: `search_creation_${failingStatus}`,
        category: kind === '400' ? 'invalid_request' : 'invalid_response',
        httpStatus,
        validatorStage,
      });
      const logged = JSON.stringify(warn.mock.calls);
      for (const forbidden of [
        TOKEN,
        SELLER,
        closed.id,
        opened.id,
        accountId,
        job.id,
        'api.mercadolibre.com',
      ]) {
        expect(logged).not.toContain(forbidden);
      }
    },
  );
});
