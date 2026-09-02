import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MercadoLivreOrdersKpisController } from './mercado-livre-orders-kpis.controller';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    externalSellerId: '1548451374',
    nickname: 'EZIEHOME',
    status: MarketplaceAccountStatus.CONNECTED,
    lastSuccessfulSyncAt: null,
    failureCode: 'SHOULD_NEVER_LEAK',
    connectedByUserId: 'SHOULD_NEVER_LEAK',
    encryptedAccessToken: 'SHOULD_NEVER_LEAK',
    ...overrides,
  };
}

function fullAggregate() {
  return {
    currentWindow: { from: new Date(0), to: new Date(0) },
    previousWindow: { from: new Date(0), to: new Date(0) },
    current: {
      grossRevenueCents: 0n,
      orders: 0,
      units: 0,
      cancelledOrders: 0,
      distinctProducts: 0,
      itemsGrossRevenueCents: 0n,
    },
    previous: {
      grossRevenueCents: 0n,
      orders: 0,
      units: 0,
      cancelledOrders: 0,
      distinctProducts: 0,
      itemsGrossRevenueCents: 0n,
    },
    topProducts: [],
    topProductsBySku: [],
    topListings: [],
    dailySeries: [],
    bestDay: null,
    dataCoverage: {
      status: 'unknown' as const,
      synchronizedFrom: null,
      synchronizedTo: null,
      synchronizedIntervals: [],
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
    },
  };
}

function buildController(
  overrides: {
    kpiService?: Record<string, jest.Mock>;
    marketplaceAccountsService?: Record<string, jest.Mock>;
  } = {},
) {
  const kpiService = {
    getAggregate: jest.fn().mockResolvedValue(fullAggregate()),
    ...overrides.kpiService,
  };
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(account()),
    ...overrides.marketplaceAccountsService,
  };
  const controller = new MercadoLivreOrdersKpisController(
    kpiService as never,
    marketplaceAccountsService as never,
  );
  return { controller, kpiService, marketplaceAccountsService };
}

describe('MercadoLivreOrdersKpisController', () => {
  it('requires AccessTokenGuard at the class level (endpoint protegido)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MercadoLivreOrdersKpisController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  describe('getKpis', () => {
    it('returns a DTO that never contains failureCode, connectedByUserId or encrypted* fields', async () => {
      const { controller } = buildController();

      const dto = await controller.getKpis('acc-1');
      const serialized = JSON.stringify(dto);
      expect(serialized).not.toContain('SHOULD_NEVER_LEAK');
      expect(dto.account).toEqual({
        id: 'acc-1',
        externalSellerId: '1548451374',
        nickname: 'EZIEHOME',
      });
    });

    it('applies ParseUUIDPipe to the route param (design metadata present)', () => {
      const paramTypes: unknown = Reflect.getMetadata(
        'design:paramtypes',
        MercadoLivreOrdersKpisController.prototype,
        'getKpis',
      );
      expect(Array.isArray(paramTypes)).toBe(true);
    });

    it('resolves the default 30-day window and forwards it to the KPI service when from/to are absent', async () => {
      const { controller, kpiService } = buildController();
      await controller.getKpis('acc-1');
      expect(kpiService.getAggregate).toHaveBeenCalledTimes(1);
      const [accountId, windows] = kpiService.getAggregate.mock.calls[0] as [
        string,
        { current: { from: Date; to: Date } },
      ];
      expect(accountId).toBe('acc-1');
      expect(
        windows.current.to.getTime() - windows.current.from.getTime(),
      ).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('forwards a valid from/to pair to the KPI service', async () => {
      const { controller, kpiService } = buildController();
      await controller.getKpis('acc-1', '2026-08-01', '2026-08-31');
      const [, windows] = kpiService.getAggregate.mock.calls[0] as [
        string,
        { current: { from: Date; to: Date } },
      ];
      expect(windows.current.from.toISOString()).toBe(
        '2026-08-01T03:00:00.000Z',
      );
      expect(windows.current.to.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    });

    it('rejects when only `from` is sent (400)', async () => {
      const { controller } = buildController();
      await expect(
        controller.getKpis('acc-1', '2026-08-01', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when only `to` is sent (400)', async () => {
      const { controller } = buildController();
      await expect(
        controller.getKpis('acc-1', undefined, '2026-08-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an invalid date format (400)', async () => {
      const { controller } = buildController();
      await expect(
        controller.getKpis('acc-1', '2026/08/01', '2026-08-31'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects from > to (400)', async () => {
      const { controller } = buildController();
      await expect(
        controller.getKpis('acc-1', '2026-08-31', '2026-08-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a range above 366 days (400)', async () => {
      const { controller } = buildController();
      await expect(
        controller.getKpis('acc-1', '2025-01-01', '2026-01-02'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never calls the KPI service when period validation fails', async () => {
      const { controller, kpiService, marketplaceAccountsService } =
        buildController();
      await expect(
        controller.getKpis('acc-1', '2026-08-01', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(kpiService.getAggregate).not.toHaveBeenCalled();
      expect(marketplaceAccountsService.findByIdOrFail).not.toHaveBeenCalled();
    });
  });
});
