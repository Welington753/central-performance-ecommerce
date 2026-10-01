import { randomUUID } from 'crypto';
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function rawClaim(id: string, dateCreated: string) {
  return {
    id,
    resource_id: `order-${id}`,
    resource: 'order',
    status: 'opened',
    type: 'mediations',
    stage: 'claim',
    site_id: 'MLB',
    reason_id: null,
    parent_id: null,
    fulfilled: null,
    quantity_type: null,
    date_created: dateCreated,
    last_updated: dateCreated,
    players: [],
    resolution: null,
  };
}

/**
 * Fake HTTP do Mercado Livre: a busca COM `range` (janela de criação) devolve
 * vazio; a busca SEM `range` (censo de abertos) pagina `censusIds`. Registra
 * todo caminho chamado.
 */
function buildFakeFetch(censusIds: string[], calledPaths: string[]) {
  const claimBody = (id: string) => ({
    ...rawClaim(id, '2025-01-10T12:00:00.000Z'),
    claim_version: '1',
  });
  return ((urlString: string) => {
    const url = new URL(urlString);
    calledPaths.push(
      `${url.pathname}${url.search.includes('range=') ? '?range' : ''}`,
    );
    if (url.pathname === '/post-purchase/v1/claims/search') {
      const isWindow = url.searchParams.has('range');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const ids = isWindow ? [] : censusIds;
      return Promise.resolve(
        jsonResponse(200, {
          paging: { total: ids.length, offset, limit },
          data: ids
            .slice(offset, offset + limit)
            .map((id) => rawClaim(id, '2025-01-10T12:00:00.000Z')),
        }),
      );
    }
    const match = url.pathname.match(
      /^\/post-purchase\/v1\/claims\/([^/]+)(\/detail|\/affects-reputation)?$/,
    );
    if (match) {
      const [, id, suffix] = match;
      if (suffix === '/affects-reputation') {
        return Promise.resolve(
          jsonResponse(200, { affects_reputation: 'not_applies' }),
        );
      }
      if (suffix === '/detail') {
        return Promise.resolve(
          jsonResponse(200, { ...claimBody(id), detail: null }),
        );
      }
      return Promise.resolve(jsonResponse(200, claimBody(id)));
    }
    return Promise.resolve(jsonResponse(404, {}));
  }) as unknown as typeof fetch;
}

const fakeConfig = (values: Record<string, unknown> = {}) =>
  ({
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('Censo de claims abertos no tick (Postgres real + HTTP mockado)', () => {
  let dataSource: DataSource;
  let jobs: MarketplaceProblemsSyncJobsPersistenceService;
  let problems: MarketplaceProblemsPersistenceService;
  let reasonCache: MarketplaceProblemReasonsCacheRepository;
  let accountId: string;

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
    await dataSource.query(`DELETE FROM marketplace_problems_sync_jobs`);
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`],
    );
    accountId = account.id;
  });

  function buildWorker(
    censusIds: string[],
    calledPaths: string[],
    workerConfig: Record<string, unknown>,
  ) {
    const httpClient = new MercadoLivreClaimsHttpClient(
      fakeConfig(),
      buildFakeFetch(censusIds, calledPaths),
    );
    const preflight = {
      resolveAccountAndToken: jest.fn().mockResolvedValue({
        accessToken: 'fake-token',
        externalSellerId: 'seller-1',
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
      fakeConfig(workerConfig),
      jobs,
      tick,
    );
  }

  async function newJobWithRecentCursor() {
    const created = await jobs.createIfAbsent(accountId, new Date());
    // Cursor recente: o claim antigo do censo é ANTERIOR ao window_cursor_at.
    await dataSource.query(
      `UPDATE marketplace_problems_sync_jobs SET window_cursor_at = now() - interval '1 hour' WHERE id = $1`,
      [created.id],
    );
    return (await jobs.findByAccountId(accountId))!;
  }

  async function persistedIds(ids: string[]): Promise<string[]> {
    const rows = await dataSource.query<Array<{ external_claim_id: string }>>(
      `SELECT external_claim_id FROM marketplace_problems
        WHERE marketplace_account_id = $1 AND external_claim_id = ANY($2)`,
      [accountId, ids],
    );
    return rows.map((r) => r.external_claim_id).sort();
  }

  it('claim aberto ANTIGO, ausente do banco e anterior ao window_cursor_at, é encontrado quando o censo cabe; last_census_at é gravado', async () => {
    const job = await newJobWithRecentCursor();
    const oldClaim = `old-${randomUUID()}`;
    expect(await persistedIds([oldClaim])).toEqual([]);

    const worker = buildWorker([oldClaim], [], {
      PROBLEMS_SYNC_WORKER_TICK_MAX_CLAIMS: 10,
      PROBLEMS_SYNC_WORKER_TICK_MAX_HTTP_CALLS: 100,
    });
    await worker.runTickOnce();

    expect(await persistedIds([oldClaim])).toEqual([oldClaim]);
    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.status).toBe('RUNNING');
    expect(after.attemptCount).toBe(0);
    expect(after.lastErrorCode).toBeNull();
    expect(after.lastCompleteCensusAt).not.toBeNull();
    expect(after.claimsPersistedCount).toBeGreaterThanOrEqual(1);
    // Nada disso mexeu no cursor de criação além do avanço normal da janela.
    expect(after.windowCursorAt.getTime()).toBeGreaterThanOrEqual(
      job.windowCursorAt.getTime(),
    );
  });

  it('censo acima do orçamento processa ZERO claims, não grava last_census_at, o refresh ainda roda e o próximo tick NÃO é imediato', async () => {
    await newJobWithRecentCursor();
    const ids = [1, 2, 3].map((n) => `big-${n}-${randomUUID()}`);
    // Problema já conhecido e não-terminal: alvo do refresh.
    const known = `known-${randomUUID()}`;
    await dataSource.query(
      `INSERT INTO marketplace_problems
         (marketplace_account_id, external_claim_id, resource, resource_id, status, type, stage, site_id, date_created, last_updated)
       VALUES ($1, $2, 'order', 'r1', 'opened', 'mediations', 'claim', 'MLB', now(), now())`,
      [accountId, known],
    );
    const calledPaths: string[] = [];
    const worker = buildWorker(ids, calledPaths, {
      // Censo de 3 claims não cabe em 2 — all-or-nothing, sem processar os 2 primeiros.
      PROBLEMS_SYNC_WORKER_TICK_MAX_CLAIMS: 2,
      PROBLEMS_SYNC_WORKER_TICK_MAX_HTTP_CALLS: 100,
    });
    const before = Date.now();
    await worker.runTickOnce();

    expect(await persistedIds(ids)).toEqual([]);
    for (const id of ids) {
      expect(calledPaths).not.toContain(`/post-purchase/v1/claims/${id}`);
    }
    const after = (await jobs.findByAccountId(accountId))!;
    expect(after.lastCompleteCensusAt).toBeNull();
    expect(after.status).toBe('RUNNING');
    expect(after.attemptCount).toBe(0);
    expect(after.lastErrorCode).toBeNull();
    // Refresh rodou com o orçamento restante e entrou no commit.
    expect(calledPaths).toContain(`/post-purchase/v1/claims/${known}`);
    expect(after.claimsProcessedCount).toBeGreaterThanOrEqual(1);
    // Sem hot loop: próximo tick só no intervalo normal (default 60s).
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(before + 30_000);
    // E o censo continua elegível (nunca foi declarado completo).
    expect(after.lastCompleteCensusAt).toBeNull();
  });
});
