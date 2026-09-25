import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { createTestEncryptionService } from '../../test-utils/create-test-encryption-service';
import { SyncRun } from '../../sync/sync-run.entity';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import type { MappedBuyerRecord } from './buyer-snapshot';
import type { MappedOrderRecord } from './mapped-order-record';
import { MarketplaceBuyer } from './marketplace-buyer.entity';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceOrderItem } from './marketplace-order-item.entity';
import { MarketplaceOrdersPersistenceService } from './marketplace-orders-persistence.service';

interface BuyerRow {
  id: string;
  marketplace_account_id: string;
  external_buyer_id: string;
  username: string | null;
  buyer_name_encrypted: string | null;
  recipient_name_encrypted: string | null;
  recipient_phone_encrypted: string | null;
  has_buyer_name: boolean;
  has_recipient_name: boolean;
  has_recipient_phone: boolean;
  city: string | null;
  personal_data_last_updated_at: Date | null;
}

function buyer(overrides: Partial<MappedBuyerRecord> = {}): MappedBuyerRecord {
  return {
    externalBuyerId: '999',
    dataSource: 'MERCADO_LIVRE_ORDERS',
    username: 'COMPRADOR_X',
    buyerName: null,
    recipientName: null,
    email: null,
    recipientPhone: null,
    city: null,
    state: null,
    postalCode: null,
    ...overrides,
  };
}

function order(
  accountId: string,
  overrides: Partial<MappedOrderRecord> = {},
): MappedOrderRecord {
  return {
    marketplaceAccountId: accountId,
    externalOrderId: '1000',
    status: 'paid',
    currencyId: 'BRL',
    totalAmount: '100.00',
    packId: null,
    dateCreated: new Date('2026-08-01T10:00:00.000Z'),
    dateClosed: null,
    marketplaceLastUpdated: new Date('2026-08-01T10:05:00.000Z'),
    refundedAmount: '10.00',
    logisticsClassification: 'MARKETPLACE_FULFILLED',
    items: [
      {
        externalItemId: 'MLB1',
        variationId: null,
        sellerSku: 'SKU-1',
        title: 'Produto 1',
        quantity: 1,
        unitPrice: '100.00',
        currencyId: 'BRL',
      },
    ],
    ...overrides,
  };
}

describe('Persistência de compradores (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MarketplaceOrdersPersistenceService;
  let ml1: string;
  let ml2: string;
  let shopee: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      SyncRun,
      MarketplaceOrder,
      MarketplaceOrderItem,
      MarketplaceBuyer,
    ]);
    service = new MarketplaceOrdersPersistenceService(
      dataSource,
      createTestEncryptionService(),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_buyers CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    const repo = dataSource.getRepository(MarketplaceAccount);
    const create = async (marketplace: Marketplace, sellerId: string) =>
      (
        await repo.save({
          id: randomUUID(),
          marketplace,
          externalSellerId: sellerId,
          nickname: `conta-${sellerId}`,
          status: MarketplaceAccountStatus.CONNECTED,
          tokenVersion: 1,
        })
      ).id;
    ml1 = await create(Marketplace.MERCADO_LIVRE, '1');
    ml2 = await create(Marketplace.MERCADO_LIVRE, '2');
    shopee = await create(Marketplace.SHOPEE, '3');
  });

  async function buyers(): Promise<BuyerRow[]> {
    return dataSource.query<BuyerRow[]>(
      `SELECT * FROM marketplace_buyers ORDER BY external_buyer_id, marketplace_account_id`,
    );
  }

  async function orderBuyerId(
    accountId: string,
    externalOrderId: string,
  ): Promise<string | null> {
    const [row] = await dataSource.query<
      Array<{ marketplace_buyer_id: string | null }>
    >(
      `SELECT marketplace_buyer_id FROM marketplace_orders
        WHERE marketplace_account_id = $1 AND external_order_id = $2`,
      [accountId, externalOrderId],
    );
    return row.marketplace_buyer_id;
  }

  it('keeps the same buyer id in ML1, ML2 and Shopee as three different buyers', async () => {
    await service.persistOrders([
      order(ml1, { buyer: buyer() }),
      order(ml2, { buyer: buyer() }),
      order(shopee, {
        externalOrderId: 'SN1',
        buyer: buyer({ dataSource: 'SHOPEE_ORDER_DETAIL' }),
      }),
    ]);
    const rows = await buyers();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.marketplace_account_id))).toEqual(
      new Set([ml1, ml2, shopee]),
    );
    expect(await orderBuyerId(ml1, '1000')).not.toBe(
      await orderBuyerId(ml2, '1000'),
    );
  });

  it('several orders of the same buyer in the same account share ONE buyer row; reprocessing never duplicates', async () => {
    const batch = [
      order(ml1, { externalOrderId: 'A', buyer: buyer() }),
      order(ml1, { externalOrderId: 'B', buyer: buyer() }),
    ];
    await service.persistOrders(batch);
    await service.persistOrders(batch);
    expect(await buyers()).toHaveLength(1);
    const [count] = await dataSource.query<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM marketplace_orders`,
    );
    expect(count.n).toBe(2);
    expect(await orderBuyerId(ml1, 'A')).toBe(await orderBuyerId(ml1, 'B'));
  });

  it('a partial payload (null fields) never erases known data', async () => {
    await service.persistOrders([
      order(ml1, {
        buyer: buyer({ buyerName: 'Maria Silva', city: 'Santos' }),
      }),
    ]);
    await service.persistOrders([
      order(ml1, {
        marketplaceLastUpdated: new Date('2026-08-02T00:00:00.000Z'),
        buyer: buyer({ username: null }),
      }),
    ]);
    const [row] = await buyers();
    expect(row.username).toBe('COMPRADOR_X');
    expect(row.city).toBe('Santos');
    expect(row.buyer_name_encrypted).not.toBeNull();
    expect(row.has_buyer_name).toBe(true);
  });

  it('stores name/phone encrypted — the plaintext never reaches the column', async () => {
    await service.persistOrders([
      order(shopee, {
        buyer: buyer({
          dataSource: 'SHOPEE_ORDER_DETAIL',
          recipientName: 'Maria Silva',
          recipientPhone: '11999990000',
        }),
      }),
    ]);
    const [row] = await buyers();
    expect(row.recipient_name_encrypted).not.toContain('Maria');
    expect(row.buyer_name_encrypted).toBeNull();
    expect(row.recipient_phone_encrypted).not.toContain('11999990000');
    expect(row).toMatchObject({
      has_buyer_name: false,
      has_recipient_name: true,
      has_recipient_phone: true,
    });
  });

  it('a historical order persisted without buyer gains it on a later (backfill/enrichment) reprocess, keeping financial and Full data', async () => {
    await service.persistOrders([order(ml1)]);
    expect(await orderBuyerId(ml1, '1000')).toBeNull();

    // Reprocesso sem campos financeiros/Full (ex.: payload mais pobre) — só o comprador é novo.
    await service.persistOrders([
      order(ml1, {
        refundedAmount: null,
        logisticsClassification: 'UNKNOWN',
        buyer: buyer(),
      }),
    ]);
    expect(await orderBuyerId(ml1, '1000')).not.toBeNull();
    const [row] = await dataSource.query<
      Array<{ refunded_amount: string; logistics_classification: string }>
    >(
      `SELECT refunded_amount, logistics_classification FROM marketplace_orders`,
    );
    expect(row).toEqual({
      refunded_amount: '10.00',
      logistics_classification: 'MARKETPLACE_FULFILLED',
    });
  });

  it('never swaps an order to a different buyer, and a payload without buyer never unlinks it', async () => {
    await service.persistOrders([order(ml1, { buyer: buyer() })]);
    const original = await orderBuyerId(ml1, '1000');
    await service.persistOrders([
      order(ml1, { buyer: buyer({ externalBuyerId: '777' }) }),
    ]);
    expect(await orderBuyerId(ml1, '1000')).toBe(original);
    await service.persistOrders([order(ml1, { buyer: null })]);
    expect(await orderBuyerId(ml1, '1000')).toBe(original);
  });

  it('a masked value counts as unavailable (has_* false) — the flag never exposes the value', async () => {
    await service.persistOrders([
      order(shopee, {
        buyer: buyer({
          dataSource: 'SHOPEE_ORDER_DETAIL',
          recipientName: 'M****a',
          recipientPhone: '******0000',
        }),
      }),
    ]);
    const [row] = await buyers();
    expect(row).toMatchObject({
      has_recipient_name: false,
      has_recipient_phone: false,
    });
  });

  describe('attachBuyersToOrders (enriquecimento)', () => {
    const ORDER_COLUMNS = `status, currency_id, total_amount, refunded_amount, pack_id,
      date_created, date_closed, marketplace_last_updated, source_status,
      fulfillment_channel, logistics_classification, logistics_type,
      external_shipment_id, marketplace_fee_amount, updated_at`;

    async function orderSnapshot(): Promise<unknown[]> {
      const orders = await dataSource.query<unknown[]>(
        `SELECT external_order_id, ${ORDER_COLUMNS} FROM marketplace_orders ORDER BY external_order_id`,
      );
      const items = await dataSource.query<unknown[]>(
        `SELECT * FROM marketplace_order_items ORDER BY id`,
      );
      return [orders, items];
    }

    it('only links the buyer: no order is created and no other order/item column changes', async () => {
      await service.persistOrders([
        order(ml1, { externalOrderId: 'A' }),
        order(ml1, { externalOrderId: 'B', status: 'cancelled' }),
      ]);
      const before = await orderSnapshot();

      const linked = await service.attachBuyersToOrders(ml1, [
        {
          externalOrderId: 'A',
          buyer: buyer({ buyerName: 'Maria' }),
          // Evento mais novo que o pedido: mesmo assim nada além do comprador muda.
          observedAt: new Date('2026-09-20T00:00:00.000Z'),
        },
        { externalOrderId: 'B', buyer: buyer(), observedAt: new Date() },
        // Pedido inexistente aqui: nunca criado, comprador nunca gravado.
        {
          externalOrderId: 'NAO-EXISTE',
          buyer: buyer({ externalBuyerId: '555' }),
          observedAt: new Date(),
        },
      ]);

      expect(linked).toBe(2);
      expect(await orderSnapshot()).toEqual(before);
      expect(await orderBuyerId(ml1, 'A')).not.toBeNull();
      expect(await orderBuyerId(ml1, 'A')).toBe(await orderBuyerId(ml1, 'B'));
      const rows = await buyers();
      expect(rows.map((r) => r.external_buyer_id)).toEqual(['999']);
    });

    it('never swaps an already linked buyer and is idempotent; other accounts stay untouched', async () => {
      await service.persistOrders([order(ml1, { buyer: buyer() }), order(ml2)]);
      const original = await orderBuyerId(ml1, '1000');
      const link = {
        externalOrderId: '1000',
        buyer: buyer({ externalBuyerId: '777' }),
        observedAt: new Date(),
      };
      expect(await service.attachBuyersToOrders(ml1, [link])).toBe(0);
      expect(await orderBuyerId(ml1, '1000')).toBe(original);
      expect(await orderBuyerId(ml2, '1000')).toBeNull();

      expect(await service.attachBuyersToOrders(ml2, [link])).toBe(1);
      expect(await service.attachBuyersToOrders(ml2, [link])).toBe(0);
      const ml2Buyer = await orderBuyerId(ml2, '1000');
      expect(ml2Buyer).not.toBe(original);
      expect(await buyers()).toHaveLength(2);
    });
  });

  it('a stale event (older last_updated) still links a buyer-less order but never regresses newer personal data', async () => {
    await service.persistOrders([
      order(ml1, {
        externalOrderId: 'NEW',
        marketplaceLastUpdated: new Date('2026-09-01T00:00:00.000Z'),
        buyer: buyer({ city: 'Santos' }),
      }),
      order(ml1, {
        externalOrderId: 'OLD',
        marketplaceLastUpdated: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ]);
    await service.persistOrders([
      order(ml1, {
        externalOrderId: 'OLD',
        marketplaceLastUpdated: new Date('2026-08-01T00:00:00.000Z'),
        buyer: buyer({ city: 'Campinas' }),
      }),
    ]);
    expect(await orderBuyerId(ml1, 'OLD')).toBe(await orderBuyerId(ml1, 'NEW'));
    const [row] = await buyers();
    expect(row.city).toBe('Santos');
    expect(row.personal_data_last_updated_at).toEqual(
      new Date('2026-09-01T00:00:00.000Z'),
    );
  });
});
