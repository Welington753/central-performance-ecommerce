import type { OrdersKpiAggregate } from '../mercado-livre-orders-kpi.service';
import {
  percentChange,
  toMercadoLivreKpisResponse,
} from './mercado-livre-kpis-response.dto';

function aggregate(
  overrides: Partial<OrdersKpiAggregate> = {},
): OrdersKpiAggregate {
  return {
    currentWindow: {
      from: new Date('2026-08-02T12:00:00.000Z'),
      to: new Date('2026-09-01T12:00:00.000Z'),
    },
    previousWindow: {
      from: new Date('2026-07-03T12:00:00.000Z'),
      to: new Date('2026-08-02T12:00:00.000Z'),
    },
    current: { grossRevenueCents: 0n, orders: 0, units: 0 },
    previous: { grossRevenueCents: 0n, orders: 0, units: 0 },
    topProducts: [],
    ...overrides,
  };
}

describe('percentChange', () => {
  it('returns null when the previous value is zero — never Infinity/NaN', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it('computes a rounded one-decimal percentage change', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(133, 100)).toBe(33);
  });
});

describe('toMercadoLivreKpisResponse', () => {
  const account = {
    id: 'acc-1',
    externalSellerId: '1548451374',
    nickname: 'EZIEHOME',
  };

  it('returns "0.00" for grossRevenue/averageTicket with zero orders — no invalid division', () => {
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
    });
  });

  it('returns null comparisons when the previous period had no orders', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate({
        current: { grossRevenueCents: 10000n, orders: 2, units: 3 },
      }),
      lastSync: null,
    });
    expect(dto.comparison).toEqual({
      grossRevenuePct: null,
      ordersPct: null,
      unitsPct: null,
      averageTicketPct: null,
    });
  });

  it('computes summary, average ticket and comparison percentages correctly', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate({
        current: { grossRevenueCents: 20000n, orders: 2, units: 4 },
        previous: { grossRevenueCents: 10000n, orders: 2, units: 2 },
      }),
      lastSync: new Date('2026-09-01T10:00:00.000Z'),
    });

    expect(dto.summary).toEqual({
      grossRevenue: '200.00',
      orders: 2,
      units: 4,
      averageTicket: '100.00',
    });
    expect(dto.comparison.grossRevenuePct).toBe(100);
    expect(dto.comparison.ordersPct).toBe(0);
    expect(dto.comparison.unitsPct).toBe(100);
    expect(dto.comparison.averageTicketPct).toBe(100);
    expect(dto.lastSync).toBe('2026-09-01T10:00:00.000Z');
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
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(dto).sort()).toEqual(
      [
        'account',
        'period',
        'summary',
        'comparison',
        'topProducts',
        'lastSync',
      ].sort(),
    );
    expect(Object.keys(dto.account).sort()).toEqual(
      ['id', 'externalSellerId', 'nickname'].sort(),
    );
  });

  it('uses the current window bounds and America/Sao_Paulo as the reported period', () => {
    const dto = toMercadoLivreKpisResponse({
      account,
      aggregate: aggregate(),
      lastSync: null,
    });
    expect(dto.period).toEqual({
      days: 30,
      timeZone: 'America/Sao_Paulo',
      from: '2026-08-02T12:00:00.000Z',
      to: '2026-09-01T12:00:00.000Z',
    });
  });
});
