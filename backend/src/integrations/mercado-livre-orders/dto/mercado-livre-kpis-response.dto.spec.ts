import type { OrdersKpiAggregate } from '../mercado-livre-orders-kpi.service';
import { toMercadoLivreKpisResponse } from './mercado-livre-kpis-response.dto';

function summary(overrides: Partial<OrdersKpiAggregate['current']> = {}) {
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
  overrides: Partial<OrdersKpiAggregate> = {},
): OrdersKpiAggregate {
  return {
    currentWindow: {
      from: new Date('2026-08-02T03:00:00.000Z'),
      to: new Date('2026-09-01T03:00:00.000Z'),
    },
    previousWindow: {
      from: new Date('2026-07-03T03:00:00.000Z'),
      to: new Date('2026-08-02T03:00:00.000Z'),
    },
    current: summary(),
    previous: summary(),
    topProducts: [],
    topProductsBySku: [],
    topListings: [],
    dailySeries: [],
    bestDay: null,
    dataCoverage: {
      status: 'unknown',
      synchronizedFrom: null,
      synchronizedTo: null,
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
    },
    ...overrides,
  };
}

const account = {
  id: 'acc-1',
  externalSellerId: '1548451374',
  nickname: 'EZIEHOME',
};

// `percentChange` foi extraída para `marketplace-orders/
// percent-change.util.spec.ts` (Checkpoint 4-B, "Commit 1") — coberta ali,
// não duplicada aqui.

describe('toMercadoLivreKpisResponse', () => {
  it('returns "0.00"/0 for every derived KPI with zero orders — no invalid division', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate(),
      lastSync: null,
    });
    expect(dto.summary).toEqual({
      grossRevenue: '0.00',
      orders: 0,
      units: 0,
      averageTicket: '0.00',
      cancelledOrders: 0,
      cancellationRate: 0,
      distinctProducts: 0,
      unitsPerOrder: 0,
      avgUnitPrice: '0.00',
    });
  });

  it('returns null comparisons (except cancellation p.p., which is always numeric) when the previous period had no orders', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate({
        current: summary({ grossRevenueCents: 10000n, orders: 2, units: 3 }),
      }),
      lastSync: null,
    });
    expect(dto.comparison.grossRevenuePct).toBeNull();
    expect(dto.comparison.ordersPct).toBeNull();
    expect(dto.comparison.unitsPct).toBeNull();
    expect(dto.comparison.averageTicketPct).toBeNull();
    expect(dto.comparison.cancelledOrdersPct).toBeNull();
    expect(dto.comparison.distinctProductsPct).toBeNull();
    expect(dto.comparison.unitsPerOrderPct).toBeNull();
    expect(dto.comparison.cancellationRateDiffPp).toBe(0);
  });

  it('computes summary, average ticket and comparison percentages correctly', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate({
        current: summary({ grossRevenueCents: 20000n, orders: 2, units: 4 }),
        previous: summary({ grossRevenueCents: 10000n, orders: 2, units: 2 }),
      }),
      lastSync: new Date('2026-09-01T10:00:00.000Z'),
    });

    expect(dto.summary.grossRevenue).toBe('200.00');
    expect(dto.summary.orders).toBe(2);
    expect(dto.summary.units).toBe(4);
    expect(dto.summary.averageTicket).toBe('100.00');
    expect(dto.comparison.grossRevenuePct).toBe(100);
    expect(dto.comparison.ordersPct).toBe(0);
    expect(dto.comparison.unitsPct).toBe(100);
    expect(dto.comparison.averageTicketPct).toBe(100);
    expect(dto.lastSync).toBe('2026-09-01T10:00:00.000Z');
  });

  describe('cancellation rate', () => {
    it('is 0 (never NaN/Infinity) when there are no paid nor cancelled orders', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate(),
        lastSync: null,
      });
      expect(dto.summary.cancellationRate).toBe(0);
    });

    it('computes cancelled / (paid + cancelled) * 100', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          current: summary({ orders: 3, cancelledOrders: 1 }),
        }),
        lastSync: null,
      });
      expect(dto.summary.cancellationRate).toBe(25);
    });

    it('compares two rates in percentage points (p.p.), never as a percentage-of-percentage', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          current: summary({ orders: 8, cancelledOrders: 2 }), // 20%
          previous: summary({ orders: 9, cancelledOrders: 1 }), // 10%
        }),
        lastSync: null,
      });
      expect(dto.comparison.cancellationRateDiffPp).toBe(10);
    });
  });

  describe('produtos distintos / unidades por pedido / preço médio por unidade', () => {
    it('reports distinctProducts as-is from the aggregate', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({ current: summary({ distinctProducts: 5 }) }),
        lastSync: null,
      });
      expect(dto.summary.distinctProducts).toBe(5);
    });

    it('computes unitsPerOrder = units / paid orders, zero with no orders', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          current: summary({ orders: 4, units: 10 }),
        }),
        lastSync: null,
      });
      expect(dto.summary.unitsPerOrder).toBe(2.5);

      const dtoZero = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate(),
        lastSync: null,
      });
      expect(dtoZero.summary.unitsPerOrder).toBe(0);
    });

    it('computes avgUnitPrice = items gross revenue / units, "0.00" with zero units', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          current: summary({ units: 4, itemsGrossRevenueCents: 2000n }),
        }),
        lastSync: null,
      });
      expect(dto.summary.avgUnitPrice).toBe('5.00');

      const dtoZero = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate(),
        lastSync: null,
      });
      expect(dtoZero.summary.avgUnitPrice).toBe('0.00');
    });
  });

  describe('bestDay', () => {
    it('is null when the aggregate has no best day', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({ bestDay: null }),
        lastSync: null,
      });
      expect(dto.bestDay).toBeNull();
    });

    it('maps the best day with a decimal-string gross revenue', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          bestDay: {
            date: '2026-08-20',
            grossRevenueCents: 15000n,
            paidOrders: 1,
            units: 3,
            cancelledOrders: 1,
          },
        }),
        lastSync: null,
      });
      expect(dto.bestDay).toEqual({
        date: '2026-08-20',
        grossRevenue: '150.00',
        paidOrders: 1,
        units: 3,
      });
    });
  });

  describe('dailySeries', () => {
    it('maps every point with a decimal-string gross revenue', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          dailySeries: [
            {
              date: '2026-08-01',
              grossRevenueCents: 0n,
              paidOrders: 0,
              units: 0,
              cancelledOrders: 0,
            },
            {
              date: '2026-08-02',
              grossRevenueCents: 12345n,
              paidOrders: 2,
              units: 5,
              cancelledOrders: 1,
            },
          ],
        }),
        lastSync: null,
      });
      expect(dto.dailySeries).toEqual([
        {
          date: '2026-08-01',
          grossRevenue: '0.00',
          paidOrders: 0,
          units: 0,
          cancelledOrders: 0,
        },
        {
          date: '2026-08-02',
          grossRevenue: '123.45',
          paidOrders: 2,
          units: 5,
          cancelledOrders: 1,
        },
      ]);
    });
  });

  describe('topProductsBySku', () => {
    it("maps consolidated SKU rows and computes each one's share of the period units", () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          current: summary({ units: 10 }),
          topProductsBySku: [
            {
              sku: 'SKU-A',
              title: 'Produto A',
              distinctListings: 2,
              units: 4,
              grossRevenueCents: 10000n,
            },
            {
              sku: null,
              title: 'Sem SKU',
              distinctListings: 1,
              units: 6,
              grossRevenueCents: 5000n,
            },
          ],
        }),
        lastSync: null,
      });
      expect(dto.topProductsBySku).toEqual([
        {
          sku: 'SKU-A',
          title: 'Produto A',
          distinctListings: 2,
          units: 4,
          grossRevenue: '100.00',
          unitsSharePct: 40,
        },
        {
          sku: null,
          title: 'Sem SKU',
          distinctListings: 1,
          units: 6,
          grossRevenue: '50.00',
          unitsSharePct: 60,
        },
      ]);
    });
  });

  describe('topListings', () => {
    it('builds listingId from externalItemId + variationId when present', () => {
      const dto = toMercadoLivreKpisResponse({
        account,
        aggregate: aggregate({
          topListings: [
            {
              externalItemId: 'MLB1',
              variationId: 'V1',
              sku: 'SKU-1',
              title: 'Produto',
              units: 2,
              grossRevenueCents: 1000n,
            },
            {
              externalItemId: 'MLB2',
              variationId: null,
              sku: null,
              title: 'Produto 2',
              units: 1,
              grossRevenueCents: 500n,
            },
          ],
        }),
        lastSync: null,
      });
      expect(dto.topListings).toEqual([
        {
          listingId: 'MLB1:V1',
          sku: 'SKU-1',
          title: 'Produto',
          units: 2,
          grossRevenue: '10.00',
        },
        {
          listingId: 'MLB2',
          sku: null,
          title: 'Produto 2',
          units: 1,
          grossRevenue: '5.00',
        },
      ]);
    });
  });

  it('maps top products with a decimal-string gross revenue', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate({
        topProducts: [
          {
            sku: 'SKU-1',
            title: 'Produto 1',
            units: 3,
            grossRevenueCents: 12345n,
          },
        ],
      }),
      lastSync: null,
    });
    expect(dto.topProducts).toEqual([
      { sku: 'SKU-1', title: 'Produto 1', units: 3, grossRevenue: '123.45' },
    ]);
  });

  it('passes dataCoverage through untouched', () => {
    const coverage = {
      status: 'partial' as const,
      synchronizedFrom: '2026-07-04',
      synchronizedTo: '2026-09-02',
      selectedPeriodComplete: true,
      comparisonPeriodComplete: false,
    };
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate({ dataCoverage: coverage }),
      lastSync: null,
    });
    expect(dto.dataCoverage).toEqual(coverage);
  });

  it('regression (CP3-R1): dataCoverage keeps EXACTLY its pre-Checkpoint-3 shape — never leaks synchronizedIntervals from the generic contract', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate(),
      lastSync: null,
    });
    expect(Object.keys(dto.dataCoverage).sort()).toEqual(
      [
        'status',
        'synchronizedFrom',
        'synchronizedTo',
        'selectedPeriodComplete',
        'comparisonPeriodComplete',
      ].sort(),
    );
    expect(dto.dataCoverage).not.toHaveProperty('synchronizedIntervals');
    expect(JSON.stringify(dto.dataCoverage)).not.toContain(
      'synchronizedIntervals',
    );
  });

  it('never includes any sensitive/internal field — fixed allowlist at every level', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate(),
      lastSync: null,
    });
    const serialized = JSON.stringify(dto);
    for (const forbidden of [
      'token',
      'Token',
      'connectedByUserId',
      'failureCode',
      'encrypted',
      'password',
      'buyer',
      'orderId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(dto).sort()).toEqual(
      [
        'account',
        'period',
        'comparisonPeriod',
        'summary',
        'comparison',
        'bestDay',
        'dailySeries',
        'topProducts',
        'topProductsBySku',
        'topListings',
        'dataCoverage',
        'lastSync',
      ].sort(),
    );
    expect(Object.keys(dto.account).sort()).toEqual(
      ['id', 'externalSellerId', 'nickname'].sort(),
    );
  });

  it('reports the current/comparison periods as inclusive São Paulo calendar dates', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate(),
      lastSync: null,
    });
    expect(dto.period).toEqual({
      days: 30,
      timeZone: 'America/Sao_Paulo',
      from: '2026-08-02',
      to: '2026-08-31',
    });
    expect(dto.comparisonPeriod).toEqual({
      days: 30,
      from: '2026-07-03',
      to: '2026-08-01',
    });
  });
});
