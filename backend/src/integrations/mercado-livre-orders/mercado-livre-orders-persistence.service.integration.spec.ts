import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncRun } from '../../sync/sync-run.entity';
import type { MappedOrderRecord } from './mercado-livre-order.mapper';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceOrderItem } from './marketplace-order-item.entity';
import {
  MercadoLivreOrdersPersistenceService,
  SyncAlreadyRunningError,
} from './mercado-livre-orders-persistence.service';

interface SyncRunRow {
  status: string;
  error_code: string | null;
  error_summary: string | null;
}

interface MarketplaceOrderRow {
  id: string;
  status: string;
  total_amount: string;
}

interface MarketplaceOrderItemRow {
  id: string;
  external_item_id: string;
  seller_sku: string | null;
  quantity: number;
}

function orderRecord(
  overrides: Partial<MappedOrderRecord> = {},
): MappedOrderRecord {
  return {
    marketplaceAccountId: overrides.marketplaceAccountId as string,
    externalOrderId: '1000',
    status: 'paid',
    currencyId: 'BRL',
    totalAmount: '199.90',
    packId: null,
    dateCreated: new Date('2026-08-01T10:00:00.000Z'),
    dateClosed: new Date('2026-08-01T10:05:00.000Z'),
    marketplaceLastUpdated: new Date('2026-08-01T10:05:00.000Z'),
    items: [
      {
        externalItemId: 'MLB1',
        variationId: null,
        sellerSku: 'SKU-1',
        title: 'Produto 1',
        quantity: 2,
        unitPrice: '99.95',
        currencyId: 'BRL',
      },
    ],
    ...overrides,
  };
}

describe('MercadoLivreOrdersPersistenceService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MercadoLivreOrdersPersistenceService;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      SyncRun,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    service = new MercadoLivreOrdersPersistenceService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE sync_runs CASCADE');
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

  describe('beginSyncRun / concorrência', () => {
    it('blocks a second RUNNING sync for the same account with SyncAlreadyRunningError', async () => {
      await service.beginSyncRun({
        marketplaceAccountId: accountId,
        periodFrom: new Date('2026-07-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-30T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await expect(
        service.beginSyncRun({
          marketplaceAccountId: accountId,
          periodFrom: new Date('2026-07-01T00:00:00.000Z'),
          periodTo: new Date('2026-08-30T00:00:00.000Z'),
          startedAt: new Date(),
        }),
      ).rejects.toBeInstanceOf(SyncAlreadyRunningError);
    });

    it('allows a new sync run after the previous one is finalized', async () => {
      const firstId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunSuccess(
        firstId,
        {
          ordersFetched: 0,
          ordersCreated: 0,
          ordersUpdated: 0,
          pagesFetched: 1,
          itemsPersisted: 0,
        },
        new Date(),
      );

      const secondId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      expect(secondId).not.toBe(firstId);
    });

    it('also allows a new sync run after the previous one FAILED', async () => {
      const firstId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunFailure(
        firstId,
        'PROVIDER_UNAVAILABLE',
        'Provedor indisponível ao consultar pedidos.',
        new Date(),
      );

      await expect(
        service.beginSyncRun({
          marketplaceAccountId: accountId,
          periodFrom: new Date(),
          periodTo: new Date(),
          startedAt: new Date(),
        }),
      ).resolves.toEqual(expect.any(String));
    });

    it('never stores the raw failure message beyond the sanitized errorCode/summary passed in', async () => {
      const id = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunFailure(
        id,
        'SYNC_FAILED',
        'Falha inesperada durante a sincronização.',
        new Date(),
      );

      const [row] = await dataSource.query<SyncRunRow[]>(
        'SELECT status, error_code, error_summary FROM sync_runs WHERE id = $1',
        [id],
      );
      expect(row.status).toBe('FAILED');
      expect(row.error_code).toBe('SYNC_FAILED');
      expect(row.error_summary).toBe(
        'Falha inesperada durante a sincronização.',
      );
    });
  });

  describe('persistOrders (idempotência)', () => {
    it('creates a new order and its items on first sync', async () => {
      const result = await service.persistOrders([
        orderRecord({ marketplaceAccountId: accountId }),
      ]);
      expect(result).toEqual({
        ordersCreated: 1,
        ordersUpdated: 0,
        itemsPersisted: 1,
      });

      const orders = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(orders).toHaveLength(1);
      expect(orders[0].total_amount).toBe('199.90');

      const items = await dataSource.query<MarketplaceOrderItemRow[]>(
        'SELECT * FROM marketplace_order_items WHERE order_id = $1',
        [orders[0].id],
      );
      expect(items).toHaveLength(1);
      expect(items[0].seller_sku).toBe('SKU-1');
    });

    it('re-syncing the same external order updates it in place — never duplicates the row', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          status: 'paid',
          totalAmount: '100.00',
        }),
      ]);

      const result = await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          status: 'paid',
          totalAmount: '150.00',
        }),
      ]);
      expect(result).toEqual({
        ordersCreated: 0,
        ordersUpdated: 1,
        itemsPersisted: 1,
      });

      const orders = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(orders).toHaveLength(1);
      expect(orders[0].total_amount).toBe('150.00');
    });

    it('a later sync that reports the order as cancelled updates its status', async () => {
      await service.persistOrders([
        orderRecord({ marketplaceAccountId: accountId, status: 'paid' }),
      ]);
      await service.persistOrders([
        orderRecord({ marketplaceAccountId: accountId, status: 'cancelled' }),
      ]);

      const [order] = await dataSource.query<
        Array<Pick<MarketplaceOrderRow, 'status'>>
      >(
        'SELECT status FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.status).toBe('cancelled');
    });

    it('replaces items on re-sync without duplicating or leaving stale rows behind', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          items: [
            {
              externalItemId: 'MLB1',
              variationId: null,
              sellerSku: 'SKU-1',
              title: 'Produto 1',
              quantity: 1,
              unitPrice: '10.00',
              currencyId: 'BRL',
            },
            {
              externalItemId: 'MLB2',
              variationId: null,
              sellerSku: 'SKU-2',
              title: 'Produto 2',
              quantity: 1,
              unitPrice: '20.00',
              currencyId: 'BRL',
            },
          ],
        }),
      ]);

      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          items: [
            {
              externalItemId: 'MLB1',
              variationId: null,
              sellerSku: 'SKU-1',
              title: 'Produto 1',
              quantity: 3,
              unitPrice: '10.00',
              currencyId: 'BRL',
            },
          ],
        }),
      ]);

      const [order] = await dataSource.query<
        Array<Pick<MarketplaceOrderRow, 'id'>>
      >('SELECT id FROM marketplace_orders WHERE marketplace_account_id = $1', [
        accountId,
      ]);
      const items = await dataSource.query<MarketplaceOrderItemRow[]>(
        'SELECT * FROM marketplace_order_items WHERE order_id = $1',
        [order.id],
      );
      expect(items).toHaveLength(1);
      expect(items[0].external_item_id).toBe('MLB1');
      expect(items[0].quantity).toBe(3);
    });

    it('persists two distinct orders for the same account without collision', async () => {
      const result = await service.persistOrders([
        orderRecord({ marketplaceAccountId: accountId, externalOrderId: '1' }),
        orderRecord({ marketplaceAccountId: accountId, externalOrderId: '2' }),
      ]);
      expect(result).toEqual({
        ordersCreated: 2,
        ordersUpdated: 0,
        itemsPersisted: 2,
      });
    });

    it('is a no-op returning zeros for an empty batch', async () => {
      const result = await service.persistOrders([]);
      expect(result).toEqual({
        ordersCreated: 0,
        ordersUpdated: 0,
        itemsPersisted: 0,
      });
    });
  });

  describe('markAccountSynced', () => {
    it('sets last_successful_sync_at on the account', async () => {
      const syncedAt = new Date('2026-09-01T12:00:00.000Z');
      await service.markAccountSynced(accountId, syncedAt);

      const account = await dataSource
        .getRepository(MarketplaceAccount)
        .findOneOrFail({ where: { id: accountId } });
      expect(account.lastSuccessfulSyncAt?.toISOString()).toBe(
        syncedAt.toISOString(),
      );
    });
  });
});
