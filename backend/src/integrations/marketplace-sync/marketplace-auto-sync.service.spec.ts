import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncOrdersError } from '../mercado-livre-orders/mercado-livre-orders-sync.service';
import { MarketplaceAutoSyncService } from './marketplace-auto-sync.service';

function account(
  overrides: Partial<MarketplaceAccount> = {},
): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: '111',
    nickname: null,
    status: MarketplaceAccountStatus.CONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 1,
    refreshFailureCount: 0,
    refreshRetryAt: null,
    lastRefreshAttemptAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeConfigService(
  values: Record<string, unknown> = {},
): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function buildOrchestrator(
  overrides: {
    configValues?: Record<string, unknown>;
    marketplaceAccountsService?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
    mlSyncService?: Record<string, jest.Mock>;
    amazonSyncService?: Record<string, jest.Mock>;
    advisoryLockService?: Record<string, jest.Mock>;
  } = {},
) {
  const marketplaceAccountsService = {
    findAll: jest.fn().mockResolvedValue([]),
    ...overrides.marketplaceAccountsService,
  };
  const persistence = {
    recoverStaleRunningRuns: jest.fn().mockResolvedValue(0),
    ...overrides.persistence,
  };
  const mlSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
    ...overrides.mlSyncService,
  };
  const amazonSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
    ...overrides.amazonSyncService,
  };
  const advisoryLockService = {
    tryAcquire: jest
      .fn()
      .mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) }),
    ...overrides.advisoryLockService,
  };
  const configService = makeConfigService(overrides.configValues);

  const service = new MarketplaceAutoSyncService(
    configService,
    marketplaceAccountsService as never,
    persistence as never,
    mlSyncService as never,
    amazonSyncService as never,
    advisoryLockService as never,
  );

  return {
    service,
    marketplaceAccountsService,
    persistence,
    mlSyncService,
    amazonSyncService,
    advisoryLockService,
  };
}

describe('MarketplaceAutoSyncService', () => {
  describe('onModuleInit / onModuleDestroy — scheduling', () => {
    it('never schedules a timer when NODE_ENV=test, even if enabled', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const { service } = buildOrchestrator({
        configValues: {
          NODE_ENV: 'test',
          MARKETPLACE_AUTO_SYNC_ENABLED: 'true',
        },
      });

      service.onModuleInit();

      expect(setIntervalSpy).not.toHaveBeenCalled();
      service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('never schedules a timer when disabled, even outside NODE_ENV=test', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const { service } = buildOrchestrator({
        configValues: {
          NODE_ENV: 'production',
          MARKETPLACE_AUTO_SYNC_ENABLED: 'false',
        },
      });

      service.onModuleInit();

      expect(setIntervalSpy).not.toHaveBeenCalled();
      service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('schedules a timer at the configured interval when enabled outside test', () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const { service } = buildOrchestrator({
        configValues: {
          NODE_ENV: 'production',
          MARKETPLACE_AUTO_SYNC_ENABLED: 'true',
          MARKETPLACE_AUTO_SYNC_INTERVAL_MINUTES: 60,
        },
      });

      service.onModuleInit();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60 * 60 * 1000,
      );
      service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('clears the scheduled timer on module destroy', () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const { service } = buildOrchestrator({
        configValues: {
          NODE_ENV: 'production',
          MARKETPLACE_AUTO_SYNC_ENABLED: 'true',
        },
      });

      service.onModuleInit();
      service.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  describe('runCycle', () => {
    it('recovers stale RUNNING runs before doing anything else', async () => {
      const { service, persistence } = buildOrchestrator();
      await service.runCycle();
      expect(persistence.recoverStaleRunningRuns).toHaveBeenCalled();
    });

    it('does nothing (no error) when the cycle lock is already held', async () => {
      const { service, marketplaceAccountsService } = buildOrchestrator({
        advisoryLockService: {
          tryAcquire: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(service.runCycle()).resolves.toBeUndefined();
      expect(marketplaceAccountsService.findAll).not.toHaveBeenCalled();
    });

    it('releases the cycle lock after finishing', async () => {
      const release = jest.fn().mockResolvedValue(undefined);
      const { service } = buildOrchestrator({
        advisoryLockService: {
          tryAcquire: jest.fn().mockResolvedValue({ release }),
        },
      });
      await service.runCycle();
      expect(release).toHaveBeenCalled();
    });

    it('skips a second overlapping cycle within the same instance', async () => {
      let resolveFirst!: () => void;
      const { service, marketplaceAccountsService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest.fn(
            () =>
              new Promise<MarketplaceAccount[]>((resolve) => {
                resolveFirst = () => resolve([]);
              }),
          ),
        },
      });

      const firstRun = service.runCycle();
      const secondRun = service.runCycle();

      await new Promise<void>((resolve) => setImmediate(resolve));
      resolveFirst();
      await Promise.all([firstRun, secondRun]);

      expect(marketplaceAccountsService.findAll).toHaveBeenCalledTimes(1);
    });

    it('only syncs CONNECTED accounts — DISCONNECTED/ERROR/TOKEN_EXPIRED are skipped', async () => {
      const { service, mlSyncService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest.fn().mockResolvedValue([
            account({
              id: 'connected',
              status: MarketplaceAccountStatus.CONNECTED,
            }),
            account({
              id: 'disconnected',
              status: MarketplaceAccountStatus.DISCONNECTED,
            }),
            account({
              id: 'error',
              status: MarketplaceAccountStatus.ERROR,
            }),
          ]),
        },
      });

      await service.runCycle();

      expect(mlSyncService.syncOrders).toHaveBeenCalledTimes(1);
      expect(mlSyncService.syncOrders).toHaveBeenCalledWith('connected', {
        type: 'INCREMENTAL',
      });
    });

    it('dispatches ML accounts to MercadoLivreOrdersSyncService and Amazon accounts to AmazonOrdersSyncService, one at a time', async () => {
      const order: string[] = [];
      const { service, mlSyncService, amazonSyncService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest
            .fn()
            .mockResolvedValue([
              account({ id: 'ml-1', marketplace: Marketplace.MERCADO_LIVRE }),
              account({ id: 'amz-1', marketplace: Marketplace.AMAZON }),
            ]),
        },
        mlSyncService: {
          syncOrders: jest.fn((id: string) => {
            order.push(id);
            return Promise.resolve({ ordersFetched: 0 });
          }),
        },
        amazonSyncService: {
          syncOrders: jest.fn((id: string) => {
            order.push(id);
            return Promise.resolve({ ordersFetched: 0 });
          }),
        },
      });

      await service.runCycle();

      expect(mlSyncService.syncOrders).toHaveBeenCalledWith('ml-1', {
        type: 'INCREMENTAL',
      });
      expect(amazonSyncService.syncOrders).toHaveBeenCalledWith(
        'amz-1',
        {},
        { type: 'INCREMENTAL' },
      );
      // Sequencial — nunca as duas em paralelo.
      expect(order).toEqual(['ml-1', 'amz-1']);
    });

    it('one account failing does not stop the others from being attempted', async () => {
      const { service, amazonSyncService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest.fn().mockResolvedValue([
            account({
              id: 'ml-fails',
              marketplace: Marketplace.MERCADO_LIVRE,
            }),
            account({ id: 'amz-ok', marketplace: Marketplace.AMAZON }),
          ]),
        },
        mlSyncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(new SyncOrdersError('PROVIDER_UNAVAILABLE')),
        },
      });

      await expect(service.runCycle()).resolves.toBeUndefined();
      expect(amazonSyncService.syncOrders).toHaveBeenCalledWith(
        'amz-ok',
        {},
        { type: 'INCREMENTAL' },
      );
    });

    it('never throws for a marketplace without a connector yet (e.g. Shopee) — skips it', async () => {
      const { service, mlSyncService, amazonSyncService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest
            .fn()
            .mockResolvedValue([account({ marketplace: Marketplace.SHOPEE })]),
        },
      });

      await expect(service.runCycle()).resolves.toBeUndefined();
      expect(mlSyncService.syncOrders).not.toHaveBeenCalled();
      expect(amazonSyncService.syncOrders).not.toHaveBeenCalled();
    });
  });
});
