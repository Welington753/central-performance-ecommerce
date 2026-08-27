import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Marketplace } from '../integrations/contracts/marketplace.enum';
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
    recordsRead: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsFailed: 0,
    errorCode: null,
    errorSummary: null,
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
});
