import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { resolveKpiPeriod } from '../marketplace-orders/period.util';
import { MercadoLivreOrdersKpiService } from './mercado-livre-orders-kpi.service';

const REFERENCE_NOW = new Date('2026-09-01T12:00:00.000Z');
// Dentro dos últimos 30 dias (período atual — 03/08 a 01/09, SP).
const IN_CURRENT = new Date('2026-08-20T12:00:00.000Z');
// Entre 31 e 60 dias atrás (período de comparação — 04/07 a 02/08, SP).
const IN_PREVIOUS = new Date('2026-07-20T12:00:00.000Z');
// Mais de 60 dias atrás — fora de ambas as janelas.
const OUTSIDE_BOTH = new Date('2026-06-01T12:00:00.000Z');

function defaultWindows() {
  return resolveKpiPeriod({}, REFERENCE_NOW);
}

interface SeedOrderInput {
  accountId: string;
  externalOrderId: string;
  status: string;
  totalAmount: string;
  dateCreated: Date;
  items: Array<{
    externalItemId: string;
    variationId?: string | null;
    sellerSku: string | null;
    title: string;
    quantity: number;
    unitPrice: string;
  }>;
}

describe('MercadoLivreOrdersKpiService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MercadoLivreOrdersKpiService;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    service = new MercadoLivreOrdersKpiService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE sync_runs CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '1548451374',
      nickname: 'EZIEHOME',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;
  });

  async function seedOrder(input: SeedOrderInput): Promise<void> {
    const [order] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_orders
          (marketplace_account_id, external_order_id, status, currency_id,
           total_amount, date_created)
        VALUES ($1, $2, $3, 'BRL', $4, $5)
        RETURNING id`,
      [
        input.accountId,
        input.externalOrderId,
        input.status,
        input.totalAmount,
        input.dateCreated,
      ],
    );

    for (const item of input.items) {
      await dataSource.query(
        `INSERT INTO marketplace_order_items
            (order_id, external_item_id, variation_id, seller_sku, title, quantity, unit_price, currency_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'BRL')`,
        [
          order.id,
          item.externalItemId,
          item.variationId ?? null,
          item.sellerSku,
          item.title,
          item.quantity,
          item.unitPrice,
        ],
      );
    }
  }

  async function seedSuccessfulSyncRun(
    dateFrom: Date,
    dateTo: Date,
  ): Promise<void> {
    await dataSource.query(
      `INSERT INTO sync_runs
          (marketplace_account_id, marketplace, type, status, started_at, finished_at, date_from, date_to)
        VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
      [
        accountId,
        Marketplace.MERCADO_LIVRE,
        SyncRunType.MANUAL,
        SyncRunStatus.SUCCESS,
        new Date(),
        dateFrom,
        dateTo,
      ],
    );
  }

  it('sums gross revenue, order count and units only for paid orders in the current window', async () => {
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '100.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB1',
          sellerSku: 'SKU-1',
          title: 'Produto 1',
          quantity: 2,
          unitPrice: '50.00',
        },
      ],
    });
    await seedOrder({
      accountId,
      externalOrderId: '2',
      status: 'paid',
      totalAmount: '50.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB2',
          sellerSku: 'SKU-2',
          title: 'Produto 2',
          quantity: 1,
          unitPrice: '50.00',
        },
      ],
    });
    // Cancelado — não deve contar em faturamento/unidades, só em cancelledOrders.
    await seedOrder({
      accountId,
      externalOrderId: '3',
      status: 'cancelled',
      totalAmount: '999.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB3',
          sellerSku: 'SKU-3',
          title: 'Produto 3',
          quantity: 99,
          unitPrice: '999.00',
        },
      ],
    });
    // Fora da janela de 60 dias — não deve contar em nenhum período.
    await seedOrder({
      accountId,
      externalOrderId: '4',
      status: 'paid',
      totalAmount: '1000.00',
      dateCreated: OUTSIDE_BOTH,
      items: [],
    });

    const result = await service.getAggregate(accountId, defaultWindows());

    expect(result.current.grossRevenueCents).toBe(15000n);
    expect(result.current.orders).toBe(2);
    expect(result.current.units).toBe(3);
    expect(result.current.cancelledOrders).toBe(1);
    expect(result.previous.orders).toBe(0);
    expect(result.previous.grossRevenueCents).toBe(0n);
  });

  it('returns zero (not an error) when there are no orders at all', async () => {
    const result = await service.getAggregate(accountId, defaultWindows());
    expect(result.current).toEqual({
      grossRevenueCents: 0n,
      orders: 0,
      units: 0,
      cancelledOrders: 0,
      distinctProducts: 0,
      itemsGrossRevenueCents: 0n,
    });
    expect(result.previous.orders).toBe(0);
    expect(result.topProducts).toEqual([]);
    expect(result.topProductsBySku).toEqual([]);
    expect(result.topListings).toEqual([]);
    expect(result.bestDay).toBeNull();
  });

  it('aggregates the previous window independently from the current one', async () => {
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '200.00',
      dateCreated: IN_PREVIOUS,
      items: [
        {
          externalItemId: 'MLB1',
          sellerSku: 'SKU-1',
          title: 'Produto 1',
          quantity: 4,
          unitPrice: '50.00',
        },
      ],
    });

    const result = await service.getAggregate(accountId, defaultWindows());
    expect(result.previous.grossRevenueCents).toBe(20000n);
    expect(result.previous.orders).toBe(1);
    expect(result.previous.units).toBe(4);
    expect(result.current.orders).toBe(0);
  });

  it('ranks legacy topProducts by gross revenue (unchanged behaviour — can repeat a SKU across listings)', async () => {
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '300.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB1',
          sellerSku: 'SKU-A',
          title: 'Produto A',
          quantity: 1,
          unitPrice: '300.00',
        },
      ],
    });
    await seedOrder({
      accountId,
      externalOrderId: '2',
      status: 'paid',
      totalAmount: '20.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB2',
          sellerSku: 'SKU-B',
          title: 'Produto B',
          quantity: 2,
          unitPrice: '5.00',
        },
        {
          externalItemId: 'MLB1',
          sellerSku: 'SKU-A',
          title: 'Produto A',
          quantity: 1,
          unitPrice: '10.00',
        },
      ],
    });

    const result = await service.getAggregate(accountId, defaultWindows());

    expect(result.topProducts).toHaveLength(2);
    expect(result.topProducts[0]).toEqual({
      sku: 'SKU-A',
      title: 'Produto A',
      units: 2,
      grossRevenueCents: 31000n,
    });
  });

  it('excludes a formerly-paid order from KPIs once it is later marked cancelled', async () => {
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '500.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB1',
          sellerSku: 'SKU-1',
          title: 'Produto 1',
          quantity: 1,
          unitPrice: '500.00',
        },
      ],
    });
    let result = await service.getAggregate(accountId, defaultWindows());
    expect(result.current.orders).toBe(1);

    await dataSource.query(
      `UPDATE marketplace_orders SET status = 'cancelled' WHERE external_order_id = '1'`,
    );

    result = await service.getAggregate(accountId, defaultWindows());
    expect(result.current.orders).toBe(0);
    expect(result.current.grossRevenueCents).toBe(0n);
    expect(result.current.cancelledOrders).toBe(1);
  });

  describe('produtos distintos', () => {
    it('counts SKUs normalized by trimming external whitespace as the same product', async () => {
      await seedOrder({
        accountId,
        externalOrderId: '1',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: '  OPA300005PMA1  ',
            title: 'Produto',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: '2',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB2',
            sellerSku: 'OPA300005PMA1',
            title: 'Produto',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });

      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.current.distinctProducts).toBe(1);
    });

    it('treats items without SKU as distinct products by listing (fallback), never merging them', async () => {
      await seedOrder({
        accountId,
        externalOrderId: '1',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: null,
            title: 'Produto sem SKU 1',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: '2',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB2',
            sellerSku: null,
            title: 'Produto sem SKU 2',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });

      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.current.distinctProducts).toBe(2);
    });
  });

  describe('topProductsBySku', () => {
    it('consolidates the same normalized SKU sold under different listings into a single row', async () => {
      await seedOrder({
        accountId,
        externalOrderId: '1',
        status: 'paid',
        totalAmount: '100.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'OPA300005PMA1',
            title: 'Produto (anúncio antigo)',
            quantity: 2,
            unitPrice: '50.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: '2',
        status: 'paid',
        totalAmount: '60.00',
        dateCreated: new Date(IN_CURRENT.getTime() + 3600_000),
        items: [
          {
            externalItemId: 'MLB2',
            sellerSku: ' OPA300005PMA1 ',
            title: 'Produto (anúncio novo)',
            quantity: 1,
            unitPrice: '60.00',
          },
        ],
      });

      const result = await service.getAggregate(accountId, defaultWindows());

      const rows = result.topProductsBySku.filter(
        (row) => row.sku === 'OPA300005PMA1',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].units).toBe(3);
      expect(rows[0].grossRevenueCents).toBe(16000n);
      expect(rows[0].distinctListings).toBe(2);
      // Título representativo mais recente (segundo pedido, criado depois).
      expect(rows[0].title).toBe('Produto (anúncio novo)');
    });

    it('never merges different fallback (no-SKU) products under the same "Sem SKU" bucket', async () => {
      await seedOrder({
        accountId,
        externalOrderId: '1',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: null,
            title: 'Produto sem SKU A',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: '2',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB2',
            sellerSku: null,
            title: 'Produto sem SKU B',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });

      const result = await service.getAggregate(accountId, defaultWindows());
      const noSkuRows = result.topProductsBySku.filter(
        (row) => row.sku === null,
      );
      expect(noSkuRows).toHaveLength(2);
      expect(noSkuRows.map((r) => r.title).sort()).toEqual([
        'Produto sem SKU A',
        'Produto sem SKU B',
      ]);
    });
  });

  describe('topListings', () => {
    it('groups by externalItemId + variationId, keeping the same SKU separate across listings', async () => {
      await seedOrder({
        accountId,
        externalOrderId: '1',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            variationId: 'V1',
            sellerSku: 'SKU-X',
            title: 'Produto X (variação 1)',
            quantity: 1,
            unitPrice: '50.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: '2',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            variationId: 'V2',
            sellerSku: 'SKU-X',
            title: 'Produto X (variação 2)',
            quantity: 1,
            unitPrice: '50.00',
          },
        ],
      });

      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.topListings).toHaveLength(2);
      expect(result.topListings.every((row) => row.sku === 'SKU-X')).toBe(true);
      expect(new Set(result.topListings.map((row) => row.variationId))).toEqual(
        new Set(['V1', 'V2']),
      );
    });
  });

  describe('dailySeries e bestDay', () => {
    it('includes every day of the window, even with no sales, in ascending order', async () => {
      const { current } = defaultWindows();
      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.dailySeries.length).toBeGreaterThan(0);
      expect(result.dailySeries[0].date < result.dailySeries[1].date).toBe(
        true,
      );
      for (const day of result.dailySeries) {
        expect(day.grossRevenueCents).toBe(0n);
        expect(day.paidOrders).toBe(0);
        expect(day.units).toBe(0);
        expect(day.cancelledOrders).toBe(0);
      }
      // Confere que a janela realmente cobre o dia esperado (03/08 a 01/09).
      expect(result.dailySeries.map((d) => d.date)).toContain('2026-08-03');
      void current;
    });

    it('aggregates gross revenue, paid orders, units and cancellations per calendar day', async () => {
      await seedOrder({
        accountId,
        externalOrderId: '1',
        status: 'paid',
        totalAmount: '150.00',
        dateCreated: new Date('2026-08-20T14:00:00.000Z'),
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-1',
            title: 'Produto 1',
            quantity: 3,
            unitPrice: '50.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: '2',
        status: 'cancelled',
        totalAmount: '99.00',
        dateCreated: new Date('2026-08-20T15:00:00.000Z'),
        items: [],
      });

      const result = await service.getAggregate(accountId, defaultWindows());
      const day = result.dailySeries.find((d) => d.date === '2026-08-20');
      expect(day).toBeDefined();
      expect(day?.grossRevenueCents).toBe(15000n);
      expect(day?.paidOrders).toBe(1);
      expect(day?.units).toBe(3);
      expect(day?.cancelledOrders).toBe(1);

      expect(result.bestDay).not.toBeNull();
      expect(result.bestDay?.date).toBe('2026-08-20');
      expect(result.bestDay?.grossRevenueCents).toBe(15000n);
    });

    it('bestDay is null when there were no sales in the period', async () => {
      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.bestDay).toBeNull();
    });
  });

  describe('dataCoverage', () => {
    it('is "unknown" when the account never had a successful sync run', async () => {
      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.dataCoverage.status).toBe('unknown');
      expect(result.dataCoverage.synchronizedFrom).toBeNull();
      expect(result.dataCoverage.selectedPeriodComplete).toBe(false);
    });

    it('is "complete" when a successful sync run fully covers both windows', async () => {
      await seedSuccessfulSyncRun(
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T12:00:00.000Z'),
      );
      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.dataCoverage.status).toBe('complete');
      expect(result.dataCoverage.selectedPeriodComplete).toBe(true);
      expect(result.dataCoverage.comparisonPeriodComplete).toBe(true);
    });

    it('is "partial" when only part of the requested range was synchronized', async () => {
      await seedSuccessfulSyncRun(
        new Date('2026-08-03T03:00:00.000Z'),
        new Date('2026-09-02T03:00:00.000Z'),
      );
      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.dataCoverage.status).toBe('partial');
      expect(result.dataCoverage.selectedPeriodComplete).toBe(true);
      expect(result.dataCoverage.comparisonPeriodComplete).toBe(false);
    });

    it('ignores RUNNING/FAILED sync runs — only SUCCESS counts as coverage proof', async () => {
      await dataSource.query(
        `INSERT INTO sync_runs
            (marketplace_account_id, marketplace, type, status, started_at, date_from, date_to)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          accountId,
          Marketplace.MERCADO_LIVRE,
          SyncRunType.MANUAL,
          SyncRunStatus.FAILED,
          new Date(),
          new Date('2026-07-01T00:00:00.000Z'),
          new Date('2026-09-02T00:00:00.000Z'),
        ],
      );
      const result = await service.getAggregate(accountId, defaultWindows());
      expect(result.dataCoverage.status).toBe('unknown');
    });
  });
});
