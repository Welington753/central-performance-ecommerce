import { Marketplace } from '../../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../../marketplace-accounts/marketplace-account.entity';
import { toMarketplaceAnalyticsResponse } from './marketplace-analytics-response.dto';
import type { MarketplaceAnalyticsAggregate } from '../marketplace-analytics.service';

function totals(
  overrides: Partial<MarketplaceAnalyticsAggregate['current']> = {},
) {
  return {
    grossRevenueCents: 0n,
    orders: 0,
    units: 0,
    cancelledOrders: 0,
    distinctProducts: 0,
    itemsGrossRevenueCents: 0n,
    ...overrides,
  };
}

function aggregate(
  overrides: Partial<MarketplaceAnalyticsAggregate> = {},
): MarketplaceAnalyticsAggregate {
  return {
    scope: { marketplace: 'ALL', accountId: null },
    availability: 'AVAILABLE',
    currentWindow: {
      from: new Date('2026-08-02T03:00:00.000Z'),
      to: new Date('2026-09-01T03:00:00.000Z'),
    },
    previousWindow: {
      from: new Date('2026-07-03T03:00:00.000Z'),
      to: new Date('2026-08-02T03:00:00.000Z'),
    },
    current: totals(),
    previous: totals(),
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
    ...overrides,
  };
}

describe('toMarketplaceAnalyticsResponse', () => {
  it('summary/comparison are null when there is no proven data (NOT_CONNECTED)', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        availability: 'NOT_CONNECTED',
        current: null,
        previous: null,
      }),
    );
    expect(dto.summary).toBeNull();
    expect(dto.comparison).toBeNull();
    expect(dto.dailySeries).toEqual([]);
    expect(dto.topProductsBySku).toEqual([]);
  });

  it('summary/comparison are null when there is no proven data (CONNECTED_NO_DATA)', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        availability: 'CONNECTED_NO_DATA',
        current: null,
        previous: null,
      }),
    );
    expect(dto.summary).toBeNull();
  });

  it('consolidates monetary values as decimal strings, never as float', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        current: totals({ grossRevenueCents: 15050n, orders: 3, units: 5 }),
      }),
    );
    expect(dto.summary?.grossRevenue).toBe('150.50');
    expect(typeof dto.summary?.grossRevenue).toBe('string');
  });

  it('computes the cancellation-rate comparison in percentage points (p.p.), always numeric', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        current: totals({ orders: 8, cancelledOrders: 2 }), // 20%
        previous: totals({ orders: 18, cancelledOrders: 2 }), // 10%
      }),
    );
    expect(dto.comparison?.cancellationRateDiffPp).toBe(10);
  });

  it('maps the best day and daily series with decimal-string revenue', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        bestDay: {
          date: '2026-08-20',
          grossRevenueCents: 5000n,
          paidOrders: 2,
          units: 4,
          cancelledOrders: 0,
        },
        dailySeries: [
          {
            date: '2026-08-02',
            grossRevenueCents: 0n,
            paidOrders: 0,
            units: 0,
            cancelledOrders: 0,
          },
          {
            date: '2026-08-20',
            grossRevenueCents: 5000n,
            paidOrders: 2,
            units: 4,
            cancelledOrders: 0,
          },
        ],
      }),
    );
    expect(dto.bestDay).toEqual({
      date: '2026-08-20',
      grossRevenue: '50.00',
      paidOrders: 2,
      units: 4,
    });
    expect(dto.dailySeries).toHaveLength(2);
    expect(dto.dailySeries[1].grossRevenue).toBe('50.00');
  });

  it('maps breakdownByMarketplace, hiding summary for sources without proven data', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        breakdownByMarketplace: [
          {
            marketplace: Marketplace.MERCADO_LIVRE,
            availability: 'AVAILABLE',
            accountsIncluded: 1,
            accountsTotal: 1,
            totals: { grossRevenueCents: 10000n, orders: 2, units: 3 },
            lastSuccessfulSyncAt: new Date('2026-09-01T10:00:00.000Z'),
          },
          {
            marketplace: Marketplace.AMAZON,
            availability: 'NOT_CONNECTED',
            accountsIncluded: 0,
            accountsTotal: 0,
            totals: null,
            lastSuccessfulSyncAt: null,
          },
          {
            marketplace: Marketplace.SHOPEE,
            availability: 'NOT_CONNECTED',
            accountsIncluded: 0,
            accountsTotal: 0,
            totals: null,
            lastSuccessfulSyncAt: null,
          },
        ],
      }),
    );
    expect(dto.breakdownByMarketplace).toHaveLength(3);
    const ml = dto.breakdownByMarketplace.find(
      (m) => m.marketplace === Marketplace.MERCADO_LIVRE,
    );
    expect(ml?.summary).toEqual({
      grossRevenue: '100.00',
      paidOrders: 2,
      units: 3,
    });
    const amazon = dto.breakdownByMarketplace.find(
      (m) => m.marketplace === Marketplace.AMAZON,
    );
    expect(amazon?.summary).toBeNull();
    expect(amazon?.availability).toBe('NOT_CONNECTED');
    const shopee = dto.breakdownByMarketplace.find(
      (m) => m.marketplace === Marketplace.SHOPEE,
    );
    expect(shopee?.summary).toBeNull();
  });

  it('maps breakdownByAccount and preserves the HISTORICAL_ONLY availability without hiding numbers', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        breakdownByAccount: [
          {
            accountId: 'acc-1',
            marketplace: Marketplace.MERCADO_LIVRE,
            nickname: 'Loja X',
            externalSellerId: '123',
            status: MarketplaceAccountStatus.TOKEN_EXPIRED,
            availability: 'HISTORICAL_ONLY',
            totals: { grossRevenueCents: 5000n, orders: 1, units: 1 },
            lastSuccessfulSyncAt: null,
          },
        ],
      }),
    );
    expect(dto.breakdownByAccount[0].availability).toBe('HISTORICAL_ONLY');
    expect(dto.breakdownByAccount[0].summary).toEqual({
      grossRevenue: '50.00',
      paidOrders: 1,
      units: 1,
    });
  });

  it('maps sources with their own synchronized intervals, never a single misleading continuous range', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        sources: [
          {
            accountId: 'acc-1',
            marketplace: Marketplace.MERCADO_LIVRE,
            availability: 'AVAILABLE',
            coverage: {
              intervals: [
                {
                  from: new Date('2026-07-02T03:00:00Z'),
                  to: new Date('2026-07-10T03:00:00Z'),
                },
                {
                  from: new Date('2026-08-20T03:00:00Z'),
                  to: new Date('2026-09-01T03:00:00Z'),
                },
              ],
              selectedPeriodComplete: false,
              comparisonPeriodComplete: false,
              hasAnySuccess: true,
            },
          },
        ],
      }),
    );
    expect(dto.sources[0].synchronizedIntervals).toEqual([
      { from: '2026-07-02', to: '2026-07-10' },
      { from: '2026-08-20', to: '2026-09-01' },
    ]);
  });

  it('never includes token, credential, buyer or order-level fields anywhere in the serialized DTO', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        breakdownByAccount: [
          {
            accountId: 'acc-1',
            marketplace: Marketplace.MERCADO_LIVRE,
            nickname: 'Loja X',
            externalSellerId: '123',
            status: MarketplaceAccountStatus.CONNECTED,
            availability: 'AVAILABLE',
            totals: { grossRevenueCents: 100n, orders: 1, units: 1 },
            lastSuccessfulSyncAt: null,
          },
        ],
      }),
    );
    const serialized = JSON.stringify(dto);
    for (const forbidden of [
      'token',
      'Token',
      'encrypted',
      'password',
      'failureCode',
      'connectedByUserId',
      'buyer',
      'orderId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reports scope and period using São Paulo calendar dates', () => {
    const dto = toMarketplaceAnalyticsResponse(aggregate());
    expect(dto.scope).toEqual({ marketplace: 'ALL', accountId: null });
    expect(dto.period).toEqual({
      days: 30,
      timeZone: 'America/Sao_Paulo',
      from: '2026-08-02',
      to: '2026-08-31',
    });
  });
});
