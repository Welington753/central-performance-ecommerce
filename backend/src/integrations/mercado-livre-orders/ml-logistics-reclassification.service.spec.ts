import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import type { MlLogisticsReclassificationJobRow } from './ml-logistics-reclassification-jobs-persistence.service';
import {
  MlLogisticsReclassificationError,
  MlLogisticsReclassificationService,
} from './ml-logistics-reclassification.service';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    nickname: 'Meli 1',
    status: MarketplaceAccountStatus.CONNECTED,
    ...overrides,
  };
}

function jobRow(
  overrides: Partial<MlLogisticsReclassificationJobRow> = {},
): MlLogisticsReclassificationJobRow {
  return {
    id: 'job-1',
    marketplaceAccountId: 'acc-1',
    status: 'RUNNING',
    initialUnknownCount: 100,
    remainingUnknownCount: 80,
    resolvedFullCount: 10,
    resolvedNotFullCount: 10,
    callsMadeCount: 30,
    queue1CursorId: null,
    queue2CursorId: null,
    passResolvedCount: 0,
    lastActivityAt: new Date('2026-09-01T00:00:00.000Z'),
    nextAttemptAt: new Date('2026-09-01T00:01:00.000Z'),
    lastErrorCode: null,
    pauseRequested: false,
    leaseOwner: null,
    leaseExpiresAt: null,
    version: 1,
    startedAt: new Date('2026-09-01T00:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function fakeConfigService(
  overrides: Record<string, string> = {},
): ConfigService {
  const values: Record<string, string> = {
    NODE_ENV: 'production',
    ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'true',
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
  } as unknown as ConfigService;
}

function buildService(options: {
  accountsService?: Record<string, jest.Mock>;
  jobsPersistence?: Record<string, jest.Mock>;
  repository?: Record<string, jest.Mock>;
  configOverrides?: Record<string, string>;
}) {
  const accountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    findAll: jest.fn().mockResolvedValue([account()]),
    ...options.accountsService,
  };
  const jobsPersistence = {
    findByAccountId: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    createIfAbsent: jest.fn().mockResolvedValue(jobRow()),
    restart: jest.fn().mockResolvedValue(jobRow()),
    requestPause: jest.fn().mockResolvedValue(jobRow({ status: 'PAUSED' })),
    resume: jest.fn().mockResolvedValue(jobRow({ status: 'RUNNING' })),
    ...options.jobsPersistence,
  };
  const repository = {
    countPendingByAccount: jest
      .fn()
      .mockResolvedValue([
        { pendingWithShipmentId: 5, pendingWithoutShipmentId: 3 },
      ]),
    ...options.repository,
  };
  const service = new MlLogisticsReclassificationService(
    accountsService as never,
    jobsPersistence as never,
    repository as never,
    fakeConfigService(options.configOverrides),
  );
  return { service, accountsService, jobsPersistence, repository };
}

describe('MlLogisticsReclassificationService', () => {
  describe('getStatus', () => {
    it('synthesizes IDLE with the live remaining count when no job row exists yet', async () => {
      const { service } = buildService({});
      const status = await service.getStatus('acc-1');
      expect(status.status).toBe('IDLE');
      expect(status.remainingUnknownCount).toBe(8);
      expect(status.initialUnknownCount).toBe(8);
      expect(status.resolvedFullCount).toBe(0);
    });

    it('reflects the persisted job when one exists, but always the FRESH remaining count from the repository', async () => {
      const { service } = buildService({
        jobsPersistence: {
          findByAccountId: jest
            .fn()
            .mockResolvedValue(jobRow({ remainingUnknownCount: 999 })),
        },
      });
      const status = await service.getStatus('acc-1');
      expect(status.status).toBe('RUNNING');
      expect(status.remainingUnknownCount).toBe(8);
      expect(status.resolvedFullCount).toBe(10);
    });

    it('never exposes token/shipment/order identifiers — only the sanitized status fields', async () => {
      const { service } = buildService({
        jobsPersistence: {
          findByAccountId: jest.fn().mockResolvedValue(jobRow()),
        },
      });
      const status = await service.getStatus('acc-1');
      const serialized = JSON.stringify(status);
      expect(serialized).not.toMatch(/token|shipment|external_order/i);
    });

    it('rejects an Amazon/Shopee account with ACCOUNT_NOT_MERCADO_LIVRE', async () => {
      const { service } = buildService({
        accountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(account({ marketplace: Marketplace.SHOPEE })),
        },
      });
      await expect(service.getStatus('acc-shopee')).rejects.toThrow(
        MlLogisticsReclassificationError,
      );
    });

    it('propagates NotFoundException for an unknown accountId — never a silent default', async () => {
      const { service } = buildService({
        accountsService: {
          findByIdOrFail: jest.fn().mockRejectedValue(new NotFoundException()),
        },
      });
      await expect(service.getStatus('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('start', () => {
    it('creates a new row with the live UNKNOWN count as the initial snapshot when none exists', async () => {
      const { service, jobsPersistence } = buildService({});
      await service.start('acc-1');
      expect(jobsPersistence.createIfAbsent).toHaveBeenCalledWith(
        'acc-1',
        8,
        expect.any(Date),
      );
    });

    it('is idempotent — a second start on an already RUNNING row never creates/restarts anything', async () => {
      const { service, jobsPersistence } = buildService({
        jobsPersistence: {
          findByAccountId: jest
            .fn()
            .mockResolvedValue(jobRow({ status: 'RUNNING' })),
        },
      });
      await service.start('acc-1');
      expect(jobsPersistence.createIfAbsent).not.toHaveBeenCalled();
      expect(jobsPersistence.restart).not.toHaveBeenCalled();
    });

    it('is idempotent on a PAUSED row too — start never force-resumes, only "Retomar" does', async () => {
      const { service, jobsPersistence } = buildService({
        jobsPersistence: {
          findByAccountId: jest
            .fn()
            .mockResolvedValue(jobRow({ status: 'PAUSED' })),
        },
      });
      await service.start('acc-1');
      expect(jobsPersistence.createIfAbsent).not.toHaveBeenCalled();
      expect(jobsPersistence.restart).not.toHaveBeenCalled();
    });

    it('restarts a COMPLETED row (new UNKNOWN may have appeared since)', async () => {
      const { service, jobsPersistence } = buildService({
        jobsPersistence: {
          findByAccountId: jest
            .fn()
            .mockResolvedValue(jobRow({ status: 'COMPLETED' })),
        },
      });
      await service.start('acc-1');
      expect(jobsPersistence.restart).toHaveBeenCalledWith(
        'acc-1',
        expect.any(Date),
      );
    });

    it('restarts a FAILED_AUTH row (user reconnected the account)', async () => {
      const { service, jobsPersistence } = buildService({
        jobsPersistence: {
          findByAccountId: jest
            .fn()
            .mockResolvedValue(jobRow({ status: 'FAILED_AUTH' })),
        },
      });
      await service.start('acc-1');
      expect(jobsPersistence.restart).toHaveBeenCalled();
    });

    describe('workerEnabled = false (item 6)', () => {
      it('rejects with WORKER_DISABLED when creating a new job — never creates a row that would never be processed', async () => {
        const { service, jobsPersistence } = buildService({
          configOverrides: {
            ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'false',
          },
        });
        await expect(service.start('acc-1')).rejects.toMatchObject({
          code: 'WORKER_DISABLED',
        });
        expect(jobsPersistence.createIfAbsent).not.toHaveBeenCalled();
      });

      it('rejects with WORKER_DISABLED when restarting a COMPLETED job', async () => {
        const { service, jobsPersistence } = buildService({
          configOverrides: {
            ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'false',
          },
          jobsPersistence: {
            findByAccountId: jest
              .fn()
              .mockResolvedValue(jobRow({ status: 'COMPLETED' })),
          },
        });
        await expect(service.start('acc-1')).rejects.toMatchObject({
          code: 'WORKER_DISABLED',
        });
        expect(jobsPersistence.restart).not.toHaveBeenCalled();
      });

      it('a start on an ALREADY ACTIVE job (RUNNING) stays idempotent — never blocked, since nothing new is created', async () => {
        const { service, jobsPersistence } = buildService({
          configOverrides: {
            ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'false',
          },
          jobsPersistence: {
            findByAccountId: jest
              .fn()
              .mockResolvedValue(jobRow({ status: 'RUNNING' })),
          },
        });
        await expect(service.start('acc-1')).resolves.toBeDefined();
        expect(jobsPersistence.createIfAbsent).not.toHaveBeenCalled();
      });
    });
  });

  describe('pause / resume', () => {
    it('pause delegates to requestPause and returns the fresh status', async () => {
      const { service, jobsPersistence } = buildService({});
      await service.pause('acc-1');
      expect(jobsPersistence.requestPause).toHaveBeenCalledWith('acc-1');
    });

    it('pause is never blocked by workerEnabled = false — pausing is always safe', async () => {
      const { service, jobsPersistence } = buildService({
        configOverrides: {
          ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'false',
        },
      });
      await expect(service.pause('acc-1')).resolves.toBeDefined();
      expect(jobsPersistence.requestPause).toHaveBeenCalled();
    });

    it('resume delegates to resume and returns the fresh status', async () => {
      const { service, jobsPersistence } = buildService({});
      await service.resume('acc-1');
      expect(jobsPersistence.resume).toHaveBeenCalledWith(
        'acc-1',
        expect.any(Date),
      );
    });

    it('resume rejects with WORKER_DISABLED when workerEnabled = false', async () => {
      const { service, jobsPersistence } = buildService({
        configOverrides: {
          ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED: 'false',
        },
      });
      await expect(service.resume('acc-1')).rejects.toMatchObject({
        code: 'WORKER_DISABLED',
      });
      expect(jobsPersistence.resume).not.toHaveBeenCalled();
    });
  });

  describe('escopo por conta — Shopee/Amazon nunca entram nas ações "todas"', () => {
    it('startAll only targets connected Mercado Livre accounts', async () => {
      const { service, accountsService, jobsPersistence } = buildService({
        accountsService: {
          findAll: jest.fn().mockResolvedValue([
            account({ id: 'ml-1' }),
            account({
              id: 'shopee-1',
              marketplace: Marketplace.SHOPEE,
            }),
            account({
              id: 'amazon-1',
              marketplace: Marketplace.AMAZON,
            }),
            account({
              id: 'ml-disconnected',
              status: MarketplaceAccountStatus.DISCONNECTED,
            }),
          ]),
          findByIdOrFail: jest.fn().mockResolvedValue(account({ id: 'ml-1' })),
        },
      });
      await service.startAll();
      expect(jobsPersistence.createIfAbsent).toHaveBeenCalledTimes(1);
      expect(accountsService.findByIdOrFail).toHaveBeenCalledWith('ml-1');
    });

    it('getStatusForAllAccounts never includes Shopee/Amazon rows', async () => {
      const { service } = buildService({
        accountsService: {
          findAll: jest
            .fn()
            .mockResolvedValue([
              account({ id: 'ml-1' }),
              account({ id: 'shopee-1', marketplace: Marketplace.SHOPEE }),
            ]),
        },
      });
      const statuses = await service.getStatusForAllAccounts();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].accountId).toBe('ml-1');
    });
  });
});
