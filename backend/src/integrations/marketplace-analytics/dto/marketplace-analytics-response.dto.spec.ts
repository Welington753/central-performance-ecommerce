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
    grossSalesRevenueCents: 0n,
    grossSalesOrders: 0,
    grossSalesUnits: 0,
    cancelledUnits: 0,
    cancelledRevenueCents: 0n,
    partiallyRefundedOrders: 0,
    partiallyRefundedGrossAmountCents: 0n,
    shippingCostCents: 0n,
    couponAmountCents: 0n,
    refundedAmountCents: 0n,
    ...overrides,
  };
}

function aggregate(
  overrides: Partial<MarketplaceAnalyticsAggregate> = {},
): MarketplaceAnalyticsAggregate {
  return {
    scope: {
      marketplace: 'ALL',
      accountId: null,
      allTime: false,
      logisticsScope: 'ALL',
    },
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
    breakdownByAccountUnscoped: [],
    sources: [],
    dataCoverage: {
      status: 'unknown',
      intervals: [],
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
    },
    lastSync: null,
    full: null,
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

  it('computes gross sales (paid + cancelled) and its averages from the shared totals, never dividing by zero', () => {
    const dto = toMarketplaceAnalyticsResponse(
      aggregate({
        current: totals({
          grossRevenueCents: 663279n,
          orders: 25,
          units: 28,
          cancelledOrders: 1,
          cancelledUnits: 1,
          cancelledRevenueCents: 57900n,
          grossSalesRevenueCents: 721179n,
          grossSalesOrders: 26,
          grossSalesUnits: 29,
        }),
        previous: totals(),
      }),
    );
    expect(dto.summary?.grossSalesRevenue).toBe('7211.79');
    expect(dto.summary?.grossSalesOrders).toBe(26);
    expect(dto.summary?.grossSalesUnits).toBe(29);
    expect(dto.summary?.grossSalesAverageTicket).toBe('277.38');
    expect(dto.summary?.grossSalesAvgUnitPrice).toBe('248.68');
    expect(dto.summary?.cancelledUnits).toBe(1);
    expect(dto.summary?.cancelledRevenue).toBe('579.00');
    // Sem base no período anterior (tudo zero) — nunca NaN/Infinity, sempre null.
    expect(dto.comparison?.grossSalesRevenuePct).toBeNull();
    expect(dto.comparison?.grossSalesAverageTicketPct).toBeNull();
    expect(dto.comparison?.grossSalesAvgUnitPricePct).toBeNull();
    expect(dto.comparison?.cancelledUnitsPct).toBeNull();
    expect(dto.comparison?.cancelledRevenuePct).toBeNull();
  });

  describe('partially_refunded (auditoria "contrato de dados", Checkpoint BI-1)', () => {
    it('refundCoverage is COMPLETE and the fields are zeroed when there is no partially_refunded order in scope', () => {
      const dto = toMarketplaceAnalyticsResponse(aggregate());
      expect(dto.summary?.partiallyRefundedOrders).toBe(0);
      expect(dto.summary?.partiallyRefundedGrossAmount).toBe('0.00');
      expect(dto.summary?.refundCoverage).toBe('COMPLETE');
    });

    it('surfaces partiallyRefundedOrders/GrossAmount and flips refundCoverage to PARTIAL', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({
            partiallyRefundedOrders: 3,
            partiallyRefundedGrossAmountCents: 538727n,
          }),
        }),
      );
      expect(dto.summary?.partiallyRefundedOrders).toBe(3);
      expect(dto.summary?.partiallyRefundedGrossAmount).toBe('5387.27');
      expect(dto.summary?.refundCoverage).toBe('PARTIAL');
    });

    it('never adds partiallyRefundedGrossAmount into grossRevenue or cancelledRevenue', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({
            grossRevenueCents: 100000n,
            cancelledRevenueCents: 5000n,
            partiallyRefundedOrders: 1,
            partiallyRefundedGrossAmountCents: 999999n,
          }),
        }),
      );
      expect(dto.summary?.grossRevenue).toBe('1000.00');
      expect(dto.summary?.cancelledRevenue).toBe('50.00');
    });
  });

  describe('despesas e ajustes conhecidos / resultado (correção pós-revisão)', () => {
    it('sums only couponAmount into knownAdjustmentsAmount — refundedAmount never enters (populações disjuntas: paid x partially_refunded)', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({
            grossRevenueCents: 100000n, // R$ 1000,00 — só pedidos "paid"
            couponAmountCents: 5000n, // R$ 50,00 — mesma população "paid"
            refundedAmountCents: 30000n, // R$ 300,00 — população "partially_refunded", nunca contou para grossRevenue
          }),
        }),
      );
      expect(dto.summary?.knownAdjustmentsAmount).toBe('50.00');
      expect(dto.summary?.resultAfterKnownAdjustments).toBe('950.00');
    });

    it('computes knownAdjustmentsPctOfGrossRevenue and marginAfterKnownAdjustmentsPct correctly', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({
            grossRevenueCents: 100000n,
            couponAmountCents: 10000n,
          }),
        }),
      );
      expect(dto.summary?.knownAdjustmentsPctOfGrossRevenue).toBe(10);
      expect(dto.summary?.resultAfterKnownAdjustments).toBe('900.00');
      expect(dto.summary?.marginAfterKnownAdjustmentsPct).toBe(90);
    });

    it('never NaN/Infinity when grossRevenue is zero — pct and margin are both 0', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({ grossRevenueCents: 0n, couponAmountCents: 0n }),
        }),
      );
      expect(dto.summary?.knownAdjustmentsPctOfGrossRevenue).toBe(0);
      expect(dto.summary?.resultAfterKnownAdjustments).toBe('0.00');
      expect(dto.summary?.marginAfterKnownAdjustmentsPct).toBe(0);
      expect(Number.isNaN(dto.summary?.knownAdjustmentsPctOfGrossRevenue)).toBe(
        false,
      );
    });

    /**
     * Exemplo numérico do relatório da tarefa: um pedido `paid` (conta para
     * `grossRevenue`) e um pedido `partially_refunded` COMPLETAMENTE
     * diferente (nunca contou para `grossRevenue`) com reembolso alto. O
     * resultado NUNCA pode cair para menos que `grossRevenue`, porque
     * `refundedAmount` fica de fora do cálculo — nunca "exclui da base E
     * ainda desconta" o mesmo dinheiro duas vezes.
     */
    it('a large refundedAmount on an unrelated partially_refunded order never drags resultAfterKnownAdjustments down (no double penalty)', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({
            grossRevenueCents: 10000n, // pedido A, "paid", R$ 100,00 — o único que compõe grossRevenue
            couponAmountCents: 0n,
            partiallyRefundedOrders: 1,
            partiallyRefundedGrossAmountCents: 20000n, // pedido B, "partially_refunded", R$ 200,00 — nunca em grossRevenue
            refundedAmountCents: 5000n, // R$ 50,00 devolvidos no pedido B
          }),
        }),
      );
      expect(dto.summary?.grossRevenue).toBe('100.00');
      // Reembolso do pedido B continua visível, só que separado (indicador informativo).
      expect(dto.summary?.refundedAmount).toBe('50.00');
      // Resultado usa só a base real (pedido A) — nunca 100.00 - 50.00 = 50.00.
      expect(dto.summary?.knownAdjustmentsAmount).toBe('0.00');
      expect(dto.summary?.resultAfterKnownAdjustments).toBe('100.00');
    });
  });

  describe('grossRevenueSharePct do ranking (Top SKU / Top anúncio) — auditoria pós-revisão', () => {
    /**
     * O denominador precisa usar `itemsGrossRevenueCents`
     * (`SUM(quantity * unit_price)`, MESMA expressão/população/filtros do
     * numerador de cada linha do ranking) — NUNCA `grossRevenueCents`
     * (`SUM(total_amount)` do pedido), que pode divergir por cupom, desconto
     * ou arredondamento. Ver `AnalyticsTopProductBySku.grossRevenueSharePct`
     * no DTO para a auditoria completa.
     */
    it('uses itemsGrossRevenueCents (quantity*unit_price) as denominator — NEVER grossRevenueCents (order total_amount), which can diverge by coupon/desconto/arredondamento', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({
            // Pedido único com cupom: total_amount (grossRevenueCents) é
            // R$ 800,00 (após desconto), mas quantity*unit_price da linha
            // (itemsGrossRevenueCents) é R$ 1000,00 — valores DIFERENTES de
            // propósito, para provar que o share usa o segundo, não o primeiro.
            grossRevenueCents: 80000n,
            itemsGrossRevenueCents: 100000n,
            couponAmountCents: 20000n,
          }),
          topProductsBySku: [
            {
              sku: 'SKU-A',
              title: 'Produto A',
              distinctListings: 1,
              units: 2,
              grossRevenueCents: 30000n, // 30% de itemsGrossRevenueCents (100000n) — nunca 37,5% de grossRevenueCents (80000n)
            },
          ],
          topListings: [
            {
              marketplace: Marketplace.MERCADO_LIVRE,
              accountId: 'acc-1',
              externalItemId: 'MLB1',
              variationId: null,
              sku: 'SKU-A',
              title: 'Produto A',
              units: 2,
              grossRevenueCents: 30000n,
            },
          ],
        }),
      );
      expect(dto.topProductsBySku[0].grossRevenueSharePct).toBe(30);
      expect(dto.topListings[0].grossRevenueSharePct).toBe(30);
    });

    it('SKU: a soma de grossRevenueSharePct de TODAS as linhas do ranking soma aproximadamente 100% quando elas cobrem o itemsGrossRevenueCents inteiro do período', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({ itemsGrossRevenueCents: 100000n }),
          topProductsBySku: [
            {
              sku: 'SKU-A',
              title: 'Produto A',
              distinctListings: 1,
              units: 6,
              grossRevenueCents: 50000n,
            },
            {
              sku: 'SKU-B',
              title: 'Produto B',
              distinctListings: 1,
              units: 3,
              grossRevenueCents: 30000n,
            },
            {
              sku: 'SKU-C',
              title: 'Produto C',
              distinctListings: 1,
              units: 1,
              grossRevenueCents: 20000n,
            },
          ],
        }),
      );
      const sum = dto.topProductsBySku.reduce(
        (acc, row) => acc + row.grossRevenueSharePct,
        0,
      );
      // Tolerância de arredondamento: cada participação é arredondada a 1 casa decimal.
      expect(sum).toBeGreaterThanOrEqual(99.5);
      expect(sum).toBeLessThanOrEqual(100.5);
    });

    it('anúncio: a soma de grossRevenueSharePct de TODAS as linhas do ranking soma aproximadamente 100%', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({ itemsGrossRevenueCents: 100000n }),
          topListings: [
            {
              marketplace: Marketplace.MERCADO_LIVRE,
              accountId: 'acc-1',
              externalItemId: 'MLB1',
              variationId: null,
              sku: 'SKU-A',
              title: 'Produto A',
              units: 6,
              grossRevenueCents: 50000n,
            },
            {
              marketplace: Marketplace.MERCADO_LIVRE,
              accountId: 'acc-1',
              externalItemId: 'MLB2',
              variationId: null,
              sku: 'SKU-B',
              title: 'Produto B',
              units: 3,
              grossRevenueCents: 30000n,
            },
            {
              marketplace: Marketplace.MERCADO_LIVRE,
              accountId: 'acc-1',
              externalItemId: 'MLB3',
              variationId: null,
              sku: 'SKU-C',
              title: 'Produto C',
              units: 1,
              grossRevenueCents: 20000n,
            },
          ],
        }),
      );
      const sum = dto.topListings.reduce(
        (acc, row) => acc + row.grossRevenueSharePct,
        0,
      );
      expect(sum).toBeGreaterThanOrEqual(99.5);
      expect(sum).toBeLessThanOrEqual(100.5);
    });

    it('never NaN/Infinity when the period itemsGrossRevenueCents is zero', () => {
      const dto = toMarketplaceAnalyticsResponse(
        aggregate({
          current: totals({ itemsGrossRevenueCents: 0n }),
          topProductsBySku: [
            {
              sku: 'SKU-A',
              title: 'Produto A',
              distinctListings: 1,
              units: 0,
              grossRevenueCents: 0n,
            },
          ],
        }),
      );
      expect(dto.topProductsBySku[0].grossRevenueSharePct).toBe(0);
      expect(Number.isNaN(dto.topProductsBySku[0].grossRevenueSharePct)).toBe(
        false,
      );
    });
  });

  it('never divides by zero for gross-sales averages when there are zero gross-sales orders/units', () => {
    const dto = toMarketplaceAnalyticsResponse(aggregate());
    expect(dto.summary?.grossSalesAverageTicket).toBe('0.00');
    expect(dto.summary?.grossSalesAvgUnitPrice).toBe('0.00');
    expect(dto.summary?.grossSalesOrders).toBe(0);
    expect(dto.summary?.grossSalesUnits).toBe(0);
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
    expect(dto.scope).toEqual({
      marketplace: 'ALL',
      accountId: null,
      allTime: false,
      logisticsScope: 'ALL',
    });
    expect(dto.period).toEqual({
      days: 30,
      timeZone: 'America/Sao_Paulo',
      from: '2026-08-02',
      to: '2026-08-31',
    });
  });
});
