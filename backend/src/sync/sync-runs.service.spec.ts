import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { Marketplace } from '../integrations/contracts/marketplace.enum';
import { MarketplaceAccount } from '../integrations/marketplace-accounts/marketplace-account.entity';
import { SyncRun, SyncRunStatus, SyncRunType } from './sync-run.entity';
import { SyncRunsService } from './sync-runs.service';

function buildSyncRun(overrides: Partial<SyncRun>): SyncRun {
  return {
    id: randomUUID(),
    marketplaceAccountId: null,
    marketplace: Marketplace.MERCADO_LIVRE,
    type: SyncRunType.MANUAL,
    status: SyncRunStatus.SUCCESS,
    startedAt: new Date(),
    finishedAt: null,
    dateFrom: null,
    dateTo: null,
    coveredThrough: null,
    recordsRead: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsFailed: 0,
    errorCode: null,
    errorSummary: null,
    pagesFetched: 0,
    itemsPersisted: 0,
    logisticsDiagnostics: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('SyncRunsService', () => {
  describe('with a mocked repository (asserts the query filter used)', () => {
    it('filters by marketplaceAccountId when provided', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SyncRunsService,
          { provide: getRepositoryToken(SyncRun), useValue: { find } },
        ],
      }).compile();
      const service = moduleRef.get(SyncRunsService);

      await service.findAll({ marketplaceAccountId: 'account-a' });

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { marketplaceAccountId: 'account-a' },
        }),
      );
    });

    it('filters by marketplace when provided', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SyncRunsService,
          { provide: getRepositoryToken(SyncRun), useValue: { find } },
        ],
      }).compile();
      const service = moduleRef.get(SyncRunsService);

      await service.findAll({ marketplace: Marketplace.AMAZON });

      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { marketplace: Marketplace.AMAZON } }),
      );
    });

    it('does not filter when no query params are given', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SyncRunsService,
          { provide: getRepositoryToken(SyncRun), useValue: { find } },
        ],
      }).compile();
      const service = moduleRef.get(SyncRunsService);

      await service.findAll({});

      expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  describe('with an in-memory fake repository (asserts real isolation of results)', () => {
    it('only returns sync runs belonging to the requested marketplaceAccountId', async () => {
      const accountA = randomUUID();
      const accountB = randomUUID();
      const rows = [
        buildSyncRun({ marketplaceAccountId: accountA }),
        buildSyncRun({ marketplaceAccountId: accountA }),
        buildSyncRun({ marketplaceAccountId: accountB }),
      ];

      const fakeRepository = {
        find: (options: { where: Partial<SyncRun> }) =>
          Promise.resolve(
            rows.filter((row) =>
              Object.entries(options.where).every(
                ([key, value]) => row[key as keyof SyncRun] === value,
              ),
            ),
          ),
      };

      const moduleRef = await Test.createTestingModule({
        providers: [
          SyncRunsService,
          { provide: getRepositoryToken(SyncRun), useValue: fakeRepository },
        ],
      }).compile();
      const service = moduleRef.get(SyncRunsService);

      const result = await service.findAll({ marketplaceAccountId: accountA });

      expect(result).toHaveLength(2);
      expect(result.every((row) => row.marketplaceAccountId === accountA)).toBe(
        true,
      );
    });
  });

  describe('findAllForScope (Checkpoint 5A — shape da query, repositório mockado)', () => {
    async function buildServiceWithMockFind() {
      const find = jest.fn().mockResolvedValue([]);
      const moduleRef = await Test.createTestingModule({
        providers: [
          SyncRunsService,
          { provide: getRepositoryToken(SyncRun), useValue: { find } },
        ],
      }).compile();
      return { service: moduleRef.get(SyncRunsService), find };
    }

    it('ALL: mesmo comportamento de findAll (sem filtro de conta)', async () => {
      const { service, find } = await buildServiceWithMockFind();
      await service.findAllForScope({}, { mode: 'ALL' });
      expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('SELECTED: usa In(accountIds) quando o filtro não pede uma conta específica', async () => {
      const { service, find } = await buildServiceWithMockFind();
      await service.findAllForScope(
        {},
        { mode: 'SELECTED', accountIds: ['a1', 'a2'] },
      );
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { marketplaceAccountId: In(['a1', 'a2']) },
        }),
      );
    });

    it('SELECTED: interseção — filtro pede conta FORA do escopo → [] sem consultar', async () => {
      const { service, find } = await buildServiceWithMockFind();
      const result = await service.findAllForScope(
        { marketplaceAccountId: 'fora-do-escopo' },
        { mode: 'SELECTED', accountIds: ['a1'] },
      );
      expect(result).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });

    it('SELECTED: interseção — filtro pede conta DENTRO do escopo → consulta só essa conta', async () => {
      const { service, find } = await buildServiceWithMockFind();
      await service.findAllForScope(
        { marketplaceAccountId: 'a1' },
        { mode: 'SELECTED', accountIds: ['a1', 'a2'] },
      );
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { marketplaceAccountId: 'a1' } }),
      );
    });

    it('SELECTED com accountIds vazio: [] sem consultar (nunca "buscar todas")', async () => {
      const { service, find } = await buildServiceWithMockFind();
      const result = await service.findAllForScope(
        {},
        { mode: 'SELECTED', accountIds: [] },
      );
      expect(result).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });

    it('NONE: [] sem consultar', async () => {
      const { service, find } = await buildServiceWithMockFind();
      const result = await service.findAllForScope({}, { mode: 'NONE' });
      expect(result).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });
  });
});

describe('SyncRunsService.findAllForScope (Checkpoint 5A — filtro SQL real, Postgres descartável)', () => {
  let dataSource: DataSource;
  let service: SyncRunsService;

  beforeAll(async () => {
    dataSource = await createTestDataSource([SyncRun, MarketplaceAccount]);
    service = new SyncRunsService(dataSource.getRepository(SyncRun));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE sync_runs CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
  });

  async function seedAccount(): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status, token_version)
       VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED', 0)`,
      [id],
    );
    return id;
  }

  async function seedRun(accountId: string): Promise<string> {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO sync_runs (id, marketplace_account_id, marketplace, type, status, started_at)
       VALUES ($1, $2, 'MERCADO_LIVRE', 'MANUAL', 'SUCCESS', now())`,
      [id, accountId],
    );
    return id;
  }

  it('SELECTED devolve só as execuções das contas permitidas — via IN() real', async () => {
    const allowed = await seedAccount();
    const forbidden = await seedAccount();
    await seedRun(allowed);
    await seedRun(forbidden);

    const result = await service.findAllForScope(
      {},
      { mode: 'SELECTED', accountIds: [allowed] },
    );

    expect(result).toHaveLength(1);
    expect(result[0].marketplaceAccountId).toBe(allowed);
  });

  it('NONE devolve lista vazia mesmo com execuções existentes', async () => {
    const accountId = await seedAccount();
    await seedRun(accountId);

    const result = await service.findAllForScope({}, { mode: 'NONE' });

    expect(result).toEqual([]);
  });

  it('ALL devolve todas as execuções, igual a findAll()', async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    await seedRun(accountA);
    await seedRun(accountB);

    const result = await service.findAllForScope({}, { mode: 'ALL' });

    expect(result).toHaveLength(2);
  });
});
