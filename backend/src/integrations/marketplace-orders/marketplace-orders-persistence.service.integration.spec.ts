import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncRun } from '../../sync/sync-run.entity';
import type { MappedOrderRecord } from './mapped-order-record';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceOrderItem } from './marketplace-order-item.entity';
import {
  MarketplaceOrdersPersistenceService,
  SyncAlreadyRunningError,
} from './marketplace-orders-persistence.service';

interface SyncRunRow {
  status: string;
  marketplace: string;
  error_code: string | null;
  error_summary: string | null;
}

interface MarketplaceOrderRow {
  id: string;
  status: string;
  total_amount: string;
  source_status: string | null;
  fulfillment_channel: string | null;
  external_marketplace_id: string | null;
  marketplace_last_updated: Date | null;
  updated_at: Date;
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

describe('MarketplaceOrdersPersistenceService (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MarketplaceOrdersPersistenceService;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      SyncRun,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    service = new MarketplaceOrdersPersistenceService(dataSource);
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
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date('2026-07-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-30T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await expect(
        service.beginSyncRun({
          marketplaceAccountId: accountId,
          marketplace: Marketplace.MERCADO_LIVRE,
          periodFrom: new Date('2026-07-01T00:00:00.000Z'),
          periodTo: new Date('2026-08-30T00:00:00.000Z'),
          startedAt: new Date(),
        }),
      ).rejects.toBeInstanceOf(SyncAlreadyRunningError);
    });

    it('allows a new sync run after the previous one is finalized', async () => {
      const firstId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
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
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      expect(secondId).not.toBe(firstId);
    });

    it('also allows a new sync run after the previous one FAILED', async () => {
      const firstId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
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
          marketplace: Marketplace.MERCADO_LIVRE,
          periodFrom: new Date(),
          periodTo: new Date(),
          startedAt: new Date(),
        }),
      ).resolves.toEqual(expect.any(String));
    });

    it('never stores the raw failure message beyond the sanitized errorCode/summary passed in', async () => {
      const id = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
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

    it('records the marketplace passed in — a MERCADO_LIVRE run and an AMAZON run for different accounts never collide', async () => {
      const amazonAccount = await dataSource
        .getRepository(MarketplaceAccount)
        .save({
          id: randomUUID(),
          marketplace: Marketplace.AMAZON,
          externalSellerId: 'A1SELLERPARTNERID',
          status: MarketplaceAccountStatus.CONNECTED,
          tokenVersion: 1,
        });

      const mlRunId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      const amazonRunId = await service.beginSyncRun({
        marketplaceAccountId: amazonAccount.id,
        marketplace: Marketplace.AMAZON,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });

      const rows = await dataSource.query<
        Array<{ id: string; marketplace: string }>
      >('SELECT id, marketplace FROM sync_runs WHERE id = ANY($1)', [
        [mlRunId, amazonRunId],
      ]);
      const byId = new Map(rows.map((r) => [r.id, r.marketplace]));
      expect(byId.get(mlRunId)).toBe('MERCADO_LIVRE');
      expect(byId.get(amazonRunId)).toBe('AMAZON');
    });
  });

  describe('finalizeSyncRunIncomplete (Checkpoint 4-B-R1, "Correção 1")', () => {
    it('finalizes as FAILED (never SUCCESS/PARTIAL) while preserving the real read/created/updated/failed/pages/items counters', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.AMAZON,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-10T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await service.finalizeSyncRunIncomplete(
        runId,
        {
          ordersFetched: 5,
          ordersCreated: 3,
          ordersUpdated: 1,
          recordsFailed: 1,
          pagesFetched: 2,
          itemsPersisted: 4,
        },
        'INCOMPLETE_PROVIDER_DATA',
        'Parte dos pedidos recebidos não pôde ser processada com segurança.',
        new Date(),
      );

      const [row] = await dataSource.query<
        Array<{
          status: string;
          records_read: number;
          records_created: number;
          records_updated: number;
          records_failed: number;
          pages_fetched: number;
          items_persisted: number;
          error_code: string | null;
          error_summary: string | null;
        }>
      >(
        `SELECT status, records_read, records_created, records_updated,
                records_failed, pages_fetched, items_persisted, error_code,
                error_summary
           FROM sync_runs WHERE id = $1`,
        [runId],
      );

      expect(row.status).toBe('FAILED');
      expect(row.status).not.toBe('SUCCESS');
      expect(row.status).not.toBe('PARTIAL');
      expect(row.records_read).toBe(5);
      expect(row.records_created).toBe(3);
      expect(row.records_updated).toBe(1);
      expect(row.records_failed).toBe(1);
      expect(row.pages_fetched).toBe(2);
      expect(row.items_persisted).toBe(4);
      expect(row.error_code).toBe('INCOMPLETE_PROVIDER_DATA');
    });

    it('never appears in the SUCCESS-only coverage query used by the dashboard — an INCOMPLETE_PROVIDER_DATA run never counts as coverage', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.AMAZON,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-10T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunIncomplete(
        runId,
        {
          ordersFetched: 5,
          ordersCreated: 5,
          ordersUpdated: 0,
          recordsFailed: 1,
          pagesFetched: 1,
          itemsPersisted: 5,
        },
        'INCOMPLETE_PROVIDER_DATA',
        'Parte dos pedidos recebidos não pôde ser processada com segurança.',
        new Date(),
      );

      // Mesma condição usada pelas queries de cobertura do dashboard
      // (`marketplace-analytics.service.ts`): só considera `status =
      // 'SUCCESS'`.
      const successRows = await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM sync_runs WHERE marketplace_account_id = $1 AND status = 'SUCCESS'`,
        [accountId],
      );
      expect(successRows.find((r) => r.id === runId)).toBeUndefined();
    });

    it('does not touch last_successful_sync_at on the account (that column is only set by markAccountSynced, never called for an incomplete run)', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.AMAZON,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunIncomplete(
        runId,
        {
          ordersFetched: 1,
          ordersCreated: 1,
          ordersUpdated: 0,
          recordsFailed: 1,
          pagesFetched: 1,
          itemsPersisted: 1,
        },
        'INCOMPLETE_PROVIDER_DATA',
        'Parte dos pedidos recebidos não pôde ser processada com segurança.',
        new Date(),
      );

      const [account] = await dataSource.query<
        Array<{ last_successful_sync_at: Date | null }>
      >(
        'SELECT last_successful_sync_at FROM marketplace_accounts WHERE id = $1',
        [accountId],
      );
      expect(account.last_successful_sync_at).toBeNull();
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

    it('persists sourceStatus/fulfillmentChannel/externalMarketplaceId when provided (Amazon), leaving them null when omitted (Mercado Livre)', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: 'amz-1',
          sourceStatus: 'UNSHIPPED',
          fulfillmentChannel: 'AMAZON',
          externalMarketplaceId: 'A2Q3Y263D00KWC',
        }),
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: 'ml-1',
        }),
      ]);

      const byExternalId = new Map(
        (
          await dataSource.query<
            Array<MarketplaceOrderRow & { external_order_id: string }>
          >(
            `SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1`,
            [accountId],
          )
        ).map((r) => [r.external_order_id, r]),
      );

      const amazon = byExternalId.get('amz-1')!;
      expect(amazon.source_status).toBe('UNSHIPPED');
      expect(amazon.fulfillment_channel).toBe('AMAZON');
      expect(amazon.external_marketplace_id).toBe('A2Q3Y263D00KWC');

      const ml = byExternalId.get('ml-1')!;
      expect(ml.source_status).toBeNull();
      expect(ml.fulfillment_channel).toBeNull();
      expect(ml.external_marketplace_id).toBeNull();
    });

    it('never lets an older marketplaceLastUpdated overwrite a newer one already stored (stale event ignored)', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          totalAmount: '500.00',
          status: 'paid',
          marketplaceLastUpdated: new Date('2026-08-10T12:00:00.000Z'),
        }),
      ]);

      // Evento atrasado: marketplaceLastUpdated ANTERIOR ao já armazenado.
      const result = await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          totalAmount: '999.99',
          status: 'cancelled',
          marketplaceLastUpdated: new Date('2026-08-09T00:00:00.000Z'),
        }),
      ]);

      expect(result).toEqual({
        ordersCreated: 0,
        ordersUpdated: 0,
        itemsPersisted: 0,
      });

      const [order] = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.total_amount).toBe('500.00');
      expect(order.status).toBe('paid');

      // Itens do pedido original permanecem intocados também.
      const items = await dataSource.query<MarketplaceOrderItemRow[]>(
        'SELECT * FROM marketplace_order_items WHERE order_id = $1',
        [order.id],
      );
      expect(items).toHaveLength(1);
    });

    it('applies an update whose marketplaceLastUpdated is strictly newer than the stored one', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          status: 'paid',
          marketplaceLastUpdated: new Date('2026-08-10T12:00:00.000Z'),
        }),
      ]);

      const result = await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          status: 'cancelled',
          marketplaceLastUpdated: new Date('2026-08-11T00:00:00.000Z'),
        }),
      ]);

      expect(result.ordersUpdated).toBe(1);
      const [order] = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.status).toBe('cancelled');
    });

    it('applies an update with the EXACT same marketplaceLastUpdated (>= is inclusive, matches historical behavior)', async () => {
      const sameInstant = new Date('2026-08-10T12:00:00.000Z');
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          status: 'paid',
          marketplaceLastUpdated: sameInstant,
        }),
      ]);

      const result = await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          status: 'cancelled',
          marketplaceLastUpdated: sameInstant,
        }),
      ]);

      expect(result.ordersUpdated).toBe(1);
    });

    it('when a batch mixes a stale order and a fresh one, only the fresh one is applied — the stale one never blocks the rest of the batch', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: 'stale-target',
          status: 'paid',
          marketplaceLastUpdated: new Date('2026-08-10T12:00:00.000Z'),
        }),
      ]);

      const result = await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: 'stale-target',
          status: 'cancelled',
          marketplaceLastUpdated: new Date('2026-08-01T00:00:00.000Z'), // antigo
        }),
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: 'fresh-new',
          status: 'paid',
        }),
      ]);

      expect(result).toEqual({
        ordersCreated: 1,
        ordersUpdated: 0,
        itemsPersisted: 1,
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
