import { buildProblemsSyncServices } from './marketplace-problems-sync-test-wiring';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { buildDataSourceOptions } from '../../database/typeorm-options.factory';
import { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';

function fakeConfigService(): ConfigService {
  return {
    get: (_key: string, def: unknown) => def,
  } as unknown as ConfigService;
}

interface FakeFetchConfig {
  searchBody: unknown;
  claimById: Record<string, unknown>;
  detailById?: Record<string, unknown>;
  reputationById?: Record<string, unknown>;
  reasonById?: Record<string, unknown>;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function buildFakeFetch(config: FakeFetchConfig): typeof fetch {
  const handler = (urlString: string): Response => {
    const url = new URL(urlString);
    if (url.pathname === '/post-purchase/v1/claims/search') {
      return jsonResponse(200, config.searchBody);
    }
    const claimMatch = url.pathname.match(
      /^\/post-purchase\/v1\/claims\/([^/]+)(\/detail|\/affects-reputation)?$/,
    );
    if (claimMatch) {
      const [, id, suffix] = claimMatch;
      if (suffix === '/detail') {
        return jsonResponse(
          200,
          config.detailById?.[id] ??
            Object.assign({}, config.claimById[id], { detail: null }),
        );
      }
      if (suffix === '/affects-reputation') {
        return jsonResponse(
          200,
          config.reputationById?.[id] ?? { affects_reputation: 'not_applies' },
        );
      }
      return jsonResponse(200, config.claimById[id]);
    }
    const reasonMatch = url.pathname.match(
      /^\/post-purchase\/v1\/claims\/reasons\/([^/]+)$/,
    );
    if (reasonMatch) {
      const [, reasonId] = reasonMatch;
      return jsonResponse(
        200,
        config.reasonById?.[reasonId] ?? {
          flow: 'mediations',
          name: 'x',
          status: 'active',
        },
      );
    }
    return jsonResponse(404, {});
  };
  return ((urlString: string) =>
    Promise.resolve(handler(urlString))) as unknown as typeof fetch;
}

function rawSearchSummary(id: string, overrides: Record<string, unknown> = {}) {
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
    date_created: '2026-01-10T12:00:00.000Z',
    last_updated: '2026-01-10T12:00:00.000Z',
    players: [],
    resolution: null,
    ...overrides,
  };
}

describe('MercadoLivreProblemsSyncService (Postgres real + HTTP mockado)', () => {
  let dataSource: DataSource;
  let persistence: MarketplaceProblemsPersistenceService;
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
    persistence = new MarketplaceProblemsPersistenceService(dataSource);
    reasonCache = new MarketplaceProblemReasonsCacheRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    const [account] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_accounts (marketplace, nickname, encrypted_access_token, encrypted_refresh_token, encrypted_credential_metadata)
       VALUES ('MERCADO_LIVRE', $1, 'x', 'x', 'x') RETURNING id`,
      [`conta-${randomUUID()}`],
    );
    accountId = account.id;
  });

  function buildService(fetchImpl: typeof fetch) {
    const httpClient = new MercadoLivreClaimsHttpClient(
      fakeConfigService(),
      fetchImpl,
    );
    const preflight = {
      resolveAccountAndToken: jest.fn().mockResolvedValue({
        accessToken: 'fake-token',
        externalSellerId: 'seller-1',
      }),
    };
    return buildProblemsSyncServices({
      dataSource,
      preflight,
      httpClient,
      reasonCache,
      problems: persistence,
      configService: fakeConfigService(),
    }).sync;
  }

  it('syncCreationWindow de 1 claim novo grava marketplace_problems + marketplace_problem_actions + marketplace_problem_reasons reais', async () => {
    const claimId = `claim-${randomUUID()}`;
    const fetchImpl = buildFakeFetch({
      searchBody: {
        paging: { total: 1, offset: 0, limit: 100 },
        data: [rawSearchSummary(claimId, { reason_id: 'PDD1' })],
      },
      claimById: {
        [claimId]: {
          ...rawSearchSummary(claimId, { reason_id: 'PDD1' }),
          claim_version: '1',
        },
      },
      detailById: {
        [claimId]: {
          ...rawSearchSummary(claimId, { reason_id: 'PDD1' }),
          claim_version: '1',
          players: [
            {
              user_id: 'u1',
              role: 'complainant',
              type: 'customer',
              available_actions: [
                { action: 'refund', mandatory: true, due_date: null },
              ],
            },
          ],
          detail: {
            title: 'Produto não recebido',
            description: null,
            problem: null,
            responsible: null,
            due_date: null,
          },
        },
      },
      reasonById: {
        PDD1: {
          flow: 'mediations',
          name: 'Produto não recebido',
          status: 'active',
        },
      },
    });
    const service = buildService(fetchImpl);

    const result = await service.syncCreationWindow(accountId, {
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-02T00:00:00.000Z'),
    });

    expect(result.complete).toBe(true);
    expect(result.claimsPersisted).toBe(1);

    const rows = await dataSource.query<
      Array<{ external_claim_id: string; last_checked_at: Date | null }>
    >(
      `SELECT external_claim_id, last_checked_at FROM marketplace_problems WHERE external_claim_id = $1`,
      [claimId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].last_checked_at).not.toBeNull();

    const actions = await dataSource.query<Array<{ action_code: string }>>(
      `SELECT mpa.action_code FROM marketplace_problem_actions mpa
         JOIN marketplace_problems mp ON mp.id = mpa.marketplace_problem_id
        WHERE mp.external_claim_id = $1`,
      [claimId],
    );
    expect(actions).toHaveLength(1);
    expect(actions[0].action_code).toBe('refund');

    const reasons = await dataSource.query<Array<{ reason_id: string }>>(
      `SELECT reason_id FROM marketplace_problem_reasons WHERE reason_id = 'PDD1'`,
    );
    expect(reasons).toHaveLength(1);
  });

  it('refreshNonTerminalBatch lê a fila real do CP2-A e a esvazia progressivamente', async () => {
    const externalClaimId = `claim-${randomUUID()}`;
    await persistence.upsertProblem({
      marketplaceAccountId: accountId,
      externalClaimId,
      resource: 'order',
      resourceId: 'r1',
      status: 'opened',
      type: 'mediations',
      stage: 'claim',
      siteId: 'MLB',
      reasonId: null,
      parentClaimId: null,
      fulfilled: false,
      quantityType: 'total',
      claimVersion: '1.0',
      resolutionReason: null,
      resolutionBenefitedRoles: [],
      resolutionClosedBy: null,
      resolutionAppliedCoverage: null,
      resolutionDate: null,
      dateCreated: new Date('2026-01-10T00:00:00.000Z'),
      lastUpdated: new Date('2026-01-10T00:00:00.000Z'),
      detail: { fetched: false },
      reputation: { fetched: false },
    });

    const before = await persistence.findProblemsNeedingRefresh(accountId, 100);
    expect(before.map((r) => r.externalClaimId)).toContain(externalClaimId);

    const fetchImpl = buildFakeFetch({
      searchBody: { paging: { total: 0, offset: 0, limit: 100 }, data: [] },
      claimById: {
        [externalClaimId]: rawSearchSummary(externalClaimId, {
          last_updated: '2026-01-11T00:00:00.000Z',
        }),
      },
    });
    const preflight = {
      resolveAccountAndToken: jest.fn().mockResolvedValue({
        accessToken: 'fake-token',
        externalSellerId: 'seller-1',
      }),
    };
    const httpClient = new MercadoLivreClaimsHttpClient(
      fakeConfigService(),
      fetchImpl,
    );
    const { sync: service } = buildProblemsSyncServices({
      dataSource,
      preflight,
      httpClient,
      reasonCache,
      problems: persistence,
      configService: fakeConfigService(),
    });

    const result = await service.refreshNonTerminalBatch(accountId, 10);
    expect(result.complete).toBe(true);
    expect(result.claimsPersisted).toBe(1);

    const after = await dataSource.query<Array<{ last_checked_at: Date }>>(
      `SELECT last_checked_at FROM marketplace_problems WHERE external_claim_id = $1`,
      [externalClaimId],
    );
    const afterQueue = await persistence.findProblemsNeedingRefresh(
      accountId,
      100,
    );
    // O registro processado ganhou um last_checked_at novo (mais recente
    // que qualquer outro NULL/antigo) — na fila real (ordenada por
    // last_checked_at ASC NULLS FIRST), ele sai do topo.
    expect(after[0].last_checked_at).not.toBeNull();
    expect(afterQueue[0]?.externalClaimId).toBe(externalClaimId);
  });
});
