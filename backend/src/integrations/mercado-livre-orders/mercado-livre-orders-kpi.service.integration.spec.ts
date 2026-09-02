import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceOrderItem } from './marketplace-order-item.entity';
import { MercadoLivreOrdersKpiService } from './mercado-livre-orders-kpi.service';

const REFERENCE_NOW = new Date('2026-09-01T12:00:00.000Z');
// Dentro dos últimos 30 dias (período atual).
const IN_CURRENT = new Date('2026-08-20T12:00:00.000Z');
// Entre 31 e 60 dias atrás (período de comparação).
const IN_PREVIOUS = new Date('2026-07-20T12:00:00.000Z');
// Mais de 60 dias atrás — fora de ambas as janelas.
const OUTSIDE_BOTH = new Date('2026-06-01T12:00:00.000Z');

interface SeedOrderInput {
  accountId: string;
  externalOrderId: string;
  status: string;
  totalAmount: string;
  dateCreated: Date;
  items: Array<{
    externalItemId: string;
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
            (order_id, external_item_id, seller_sku, title, quantity, unit_price, currency_id)
          VALUES ($1, $2, $3, $4, $5, $6, 'BRL')`,
        [
          order.id,
          item.externalItemId,
          item.sellerSku,
          item.title,
          item.quantity,
          item.unitPrice,
        ],
      );
    }
  }

  it('sums gross revenue, order count and units only for paid orders in the current 30-day window', async () => {
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
    // Cancelado — não deve contar em nenhuma métrica.
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

    const result = await service.getAggregate(accountId, REFERENCE_NOW);

    expect(result.current.grossRevenueCents).toBe(15000n);
    expect(result.current.orders).toBe(2);
    expect(result.current.units).toBe(3);
    expect(result.previous.orders).toBe(0);
    expect(result.previous.grossRevenueCents).toBe(0n);
  });

  it('returns zero (not an error) when there are no orders at all', async () => {
    const result = await service.getAggregate(accountId, REFERENCE_NOW);
    expect(result.current).toEqual({
      grossRevenueCents: 0n,
      orders: 0,
      units: 0,
    });
    expect(result.previous).toEqual({
      grossRevenueCents: 0n,
      orders: 0,
      units: 0,
    });
    expect(result.topProducts).toEqual([]);
  });

  it('aggregates the previous 30-day comparison window independently from the current one', async () => {
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

    const result = await service.getAggregate(accountId, REFERENCE_NOW);
    expect(result.previous.grossRevenueCents).toBe(20000n);
    expect(result.previous.orders).toBe(1);
    expect(result.previous.units).toBe(4);
    expect(result.current.orders).toBe(0);
  });

  it('ranks top products by gross revenue, grouping by SKU', async () => {
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

    const result = await service.getAggregate(accountId, REFERENCE_NOW);

    expect(result.topProducts).toHaveLength(2);
    expect(result.topProducts[0]).toEqual({
      sku: 'SKU-A',
      title: 'Produto A',
      units: 2,
      grossRevenueCents: 31000n,
    });
    expect(result.topProducts[1]).toEqual({
      sku: 'SKU-B',
      title: 'Produto B',
      units: 2,
      grossRevenueCents: 1000n,
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
    let result = await service.getAggregate(accountId, REFERENCE_NOW);
    expect(result.current.orders).toBe(1);

    await dataSource.query(
      `UPDATE marketplace_orders SET status = 'cancelled' WHERE external_order_id = '1'`,
    );

    result = await service.getAggregate(accountId, REFERENCE_NOW);
    expect(result.current.orders).toBe(0);
    expect(result.current.grossRevenueCents).toBe(0n);
  });
});
