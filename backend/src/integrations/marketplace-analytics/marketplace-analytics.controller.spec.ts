import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { MarketplaceAnalyticsController } from './marketplace-analytics.controller';
import { MarketplaceAnalyticsFilterError } from './marketplace-filter.util';
import { InvalidKpiPeriodError } from '../marketplace-orders/period.util';
import type { MarketplaceAnalyticsAggregate } from './marketplace-analytics.service';

function emptyAggregate(): MarketplaceAnalyticsAggregate {
  return {
    scope: { marketplace: 'ALL', accountId: null },
    availability: 'NOT_CONNECTED',
    currentWindow: { from: new Date(0), to: new Date(0) },
    previousWindow: { from: new Date(0), to: new Date(0) },
    current: null,
    previous: null,
    bestDay: null,
    dailySeries: [],
    topProductsBySku: [],
    topListings: [],
    breakdownByMarketplace: [],
    breakdownByAccount: [],
    sources: [],
    dataCoverage: {
      status: 'unknown',
      intervals: [],
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
    },
    lastSync: null,
  };
}

function buildController(
  getAggregate: jest.Mock = jest.fn().mockResolvedValue(emptyAggregate()),
) {
  const service = { getAggregate };
  const controller = new MarketplaceAnalyticsController(service as never);
  return { controller, service };
}

describe('MarketplaceAnalyticsController', () => {
  it('requires AccessTokenGuard at the class level (endpoint protegido)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MarketplaceAnalyticsController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  it('forwards from/to/marketplace/accountId to the service', async () => {
    const { controller, service } = buildController();
    await controller.getKpis('2026-08-01', '2026-08-31', 'AMAZON', 'acc-1');
    expect(service.getAggregate).toHaveBeenCalledWith({
      from: '2026-08-01',
      to: '2026-08-31',
      marketplace: 'AMAZON',
      accountId: 'acc-1',
    });
  });

  it('translates InvalidKpiPeriodError into a 400 carrying only the closed code', async () => {
    const { controller } = buildController(
      jest.fn().mockRejectedValue(new InvalidKpiPeriodError('FROM_AFTER_TO')),
    );
    await expect(
      controller.getKpis('2026-08-31', '2026-08-01'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('translates MarketplaceAnalyticsFilterError into a 400 carrying only the closed code', async () => {
    const { controller } = buildController(
      jest
        .fn()
        .mockRejectedValue(
          new MarketplaceAnalyticsFilterError('ACCOUNT_MARKETPLACE_CONFLICT'),
        ),
    );
    try {
      await controller.getKpis(undefined, undefined, 'AMAZON', 'acc-1');
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (response as { message: unknown }).message;
      expect(JSON.stringify(message)).not.toContain('acc-1');
    }
  });

  it('rethrows unexpected errors untouched', async () => {
    const { controller } = buildController(
      jest.fn().mockRejectedValue(new Error('unexpected boom')),
    );
    await expect(controller.getKpis()).rejects.toThrow('unexpected boom');
  });

  it('returns a DTO with no sensitive substrings for an empty/NOT_CONNECTED aggregate', async () => {
    const { controller } = buildController();
    const dto = await controller.getKpis();
    const serialized = JSON.stringify(dto);
    for (const forbidden of [
      'token',
      'Token',
      'encrypted',
      'password',
      'failureCode',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(dto.summary).toBeNull();
    expect(dto.availability).toBe('NOT_CONNECTED');
  });
});
