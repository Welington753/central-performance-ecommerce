import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { SyncRun } from '../../sync/sync-run.entity';
import { SyncRunsCoveredThrough1788800000000 } from '../../database/migrations/1788800000000-sync-runs-covered-through';
import { MarketplaceOrdersFinancialFields1788900000000 } from '../../database/migrations/1788900000000-marketplace-orders-financial-fields';
import type { MappedOrderRecord } from './mapped-order-record';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceOrderItem } from './marketplace-order-item.entity';
import {
  InvalidCoveredThroughError,
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
  logistics_classification: string;
  logistics_type: string | null;
  marketplace_last_updated: Date | null;
  updated_at: Date;
  marketplace_fee_amount: string | null;
  buyer_shipping_cost_amount: string | null;
  taxes_amount: string | null;
  coupon_amount: string | null;
  refunded_amount: string | null;
}

interface MarketplaceOrderItemRow {
  id: string;
  external_item_id: string;
  seller_sku: string | null;
  quantity: number;
  sale_fee_amount: string | null;
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

    it('persists a non-null packId (order belonging to a pack)', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          packId: '2000000101334825',
        }),
      ]);

      const [order] = await dataSource.query<Array<{ pack_id: string | null }>>(
        'SELECT pack_id FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.pack_id).toBe('2000000101334825');
    });

    it('persists every item of a multi-item order — none overwrites another, and the units total is the sum of all quantities', async () => {
      const result = await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          items: [
            {
              externalItemId: 'MLB-A',
              variationId: null,
              sellerSku: 'SKU-A',
              title: 'Produto A',
              quantity: 2,
              unitPrice: '10.00',
              currencyId: 'BRL',
            },
            {
              externalItemId: 'MLB-B',
              variationId: null,
              sellerSku: 'SKU-B',
              title: 'Produto B',
              quantity: 3,
              unitPrice: '25.50',
              currencyId: 'BRL',
            },
            {
              externalItemId: 'MLB-C',
              variationId: null,
              sellerSku: 'SKU-C',
              title: 'Produto C',
              quantity: 1,
              unitPrice: '7.25',
              currencyId: 'BRL',
            },
          ],
        }),
      ]);
      expect(result.itemsPersisted).toBe(3);

      const [order] = await dataSource.query<
        Array<Pick<MarketplaceOrderRow, 'id'>>
      >('SELECT id FROM marketplace_orders WHERE marketplace_account_id = $1', [
        accountId,
      ]);
      const items = await dataSource.query<MarketplaceOrderItemRow[]>(
        'SELECT * FROM marketplace_order_items WHERE order_id = $1 ORDER BY external_item_id',
        [order.id],
      );

      expect(items).toHaveLength(3);
      // Nenhum item sobrescreve outro: cada external_item_id/quantity chega intacto.
      expect(
        items.map((item) => [item.external_item_id, item.quantity]),
      ).toEqual([
        ['MLB-A', 2],
        ['MLB-B', 3],
        ['MLB-C', 1],
      ]);

      const [{ total_units: totalUnits }] = await dataSource.query<
        Array<{ total_units: string }>
      >(
        'SELECT SUM(quantity)::text AS total_units FROM marketplace_order_items WHERE order_id = $1',
        [order.id],
      );
      expect(Number(totalUnits)).toBe(6); // 2 + 3 + 1
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

    describe('campos financeiros (CP2K-7D)', () => {
      it('insert grava os cinco campos financeiros do pedido e a comissão por item', async () => {
        await service.persistOrders([
          orderRecord({
            marketplaceAccountId: accountId,
            marketplaceFeeAmount: '12.50',
            buyerShippingCostAmount: '9.90',
            taxesAmount: '1.23',
            couponAmount: '5.00',
            refundedAmount: '0.00',
            items: [
              {
                externalItemId: 'MLB1',
                variationId: null,
                sellerSku: 'SKU-1',
                title: 'Produto 1',
                quantity: 2,
                unitPrice: '99.95',
                currencyId: 'BRL',
                saleFeeAmount: '4.99',
              },
            ],
          }),
        ]);

        const [order] = await dataSource.query<MarketplaceOrderRow[]>(
          'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
          [accountId],
        );
        expect(order.marketplace_fee_amount).toBe('12.50');
        expect(order.buyer_shipping_cost_amount).toBe('9.90');
        expect(order.taxes_amount).toBe('1.23');
        expect(order.coupon_amount).toBe('5.00');
        expect(order.refunded_amount).toBe('0.00');

        const [item] = await dataSource.query<MarketplaceOrderItemRow[]>(
          'SELECT * FROM marketplace_order_items WHERE order_id = $1',
          [order.id],
        );
        expect(item.sale_fee_amount).toBe('4.99');
      });

      it('registros sem os campos financeiros (Shopee/Amazon, ou Mercado Livre antigo) permanecem null — nunca zero', async () => {
        await service.persistOrders([
          orderRecord({ marketplaceAccountId: accountId }),
        ]);

        const [order] = await dataSource.query<MarketplaceOrderRow[]>(
          'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
          [accountId],
        );
        expect(order.marketplace_fee_amount).toBeNull();
        expect(order.buyer_shipping_cost_amount).toBeNull();
        expect(order.taxes_amount).toBeNull();
        expect(order.coupon_amount).toBeNull();
        expect(order.refunded_amount).toBeNull();

        const [item] = await dataSource.query<MarketplaceOrderItemRow[]>(
          'SELECT * FROM marketplace_order_items WHERE order_id = $1',
          [order.id],
        );
        expect(item.sale_fee_amount).toBeNull();
      });

      it('upsert atualiza os campos financeiros em uma ressincronização', async () => {
        await service.persistOrders([
          orderRecord({
            marketplaceAccountId: accountId,
            buyerShippingCostAmount: '9.90',
          }),
        ]);

        await service.persistOrders([
          orderRecord({
            marketplaceAccountId: accountId,
            buyerShippingCostAmount: '19.90',
          }),
        ]);

        const [order] = await dataSource.query<MarketplaceOrderRow[]>(
          'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
          [accountId],
        );
        expect(order.buyer_shipping_cost_amount).toBe('19.90');
      });

      // CP2K-7E (auditoria): o fluxo real de sincronização (manual, auto-sync
      // e backfill — todos via `MercadoLivreOrdersSyncService.syncOrders`)
      // NUNCA chama `/orders/{id}` (detalhe), só `/orders/search`. O
      // validador/mapper não têm como distinguir "a fonte confirmou que este
      // campo não existe" de "esta resposta específica não trouxe o campo"
      // — as duas situações colapsam no mesmo `null` (ver
      // `mercado-livre-order-response.ts`). Por isso um UPSERT de full
      // overwrite incondicional (como o CP2K-7D implementou originalmente)
      // arrisca apagar um valor financeiro já conhecido só porque uma
      // ressincronização posterior recebeu um payload menos completo (ex.:
      // nenhum payment `approved` nesta resposta específica) — nunca porque
      // o Mercado Livre confirmou que o valor deixou de existir. A correção:
      // `COALESCE(EXCLUDED.campo, marketplace_orders.campo)` — um novo valor
      // não-nulo (incluindo "0.00", nunca confundido com ausência) sempre
      // substitui; um novo `null` NUNCA apaga um valor não-nulo já
      // persistido.
      describe('preservação em re-sync com payload incompleto (CP2K-7E)', () => {
        it('uma ressincronização sem um campo financeiro anteriormente conhecido preserva o valor antigo — nunca apaga silenciosamente (payload incompleto não é a fonte confirmando ausência)', async () => {
          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              marketplaceFeeAmount: '12.50',
              buyerShippingCostAmount: '9.90',
              taxesAmount: '1.23',
              couponAmount: '5.00',
              refundedAmount: '3.00',
              marketplaceLastUpdated: new Date('2026-08-01T10:00:00.000Z'),
            }),
          ]);

          // Ressincronização MAIS NOVA (marketplaceLastUpdated avança, então
          // o UPSERT é aplicado normalmente) cujo payload desta vez não tem
          // nenhum payment elegível com estes campos.
          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              marketplaceFeeAmount: null,
              buyerShippingCostAmount: null,
              taxesAmount: null,
              couponAmount: null,
              refundedAmount: null,
              marketplaceLastUpdated: new Date('2026-08-02T10:00:00.000Z'),
            }),
          ]);

          const [order] = await dataSource.query<MarketplaceOrderRow[]>(
            'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
            [accountId],
          );
          expect(order.marketplace_fee_amount).toBe('12.50');
          expect(order.buyer_shipping_cost_amount).toBe('9.90');
          expect(order.taxes_amount).toBe('1.23');
          expect(order.coupon_amount).toBe('5.00');
          expect(order.refunded_amount).toBe('3.00');
        });

        it('uma ressincronização com um NOVO valor não-nulo continua substituindo o antigo normalmente', async () => {
          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              buyerShippingCostAmount: '9.90',
              marketplaceLastUpdated: new Date('2026-08-01T10:00:00.000Z'),
            }),
          ]);

          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              buyerShippingCostAmount: '19.90',
              marketplaceLastUpdated: new Date('2026-08-02T10:00:00.000Z'),
            }),
          ]);

          const [order] = await dataSource.query<MarketplaceOrderRow[]>(
            'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
            [accountId],
          );
          expect(order.buyer_shipping_cost_amount).toBe('19.90');
        });

        it('"0.00" é um valor válido e sobrescreve o antigo normalmente — nunca confundido com ausência/COALESCE', async () => {
          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              couponAmount: '9.90',
              marketplaceLastUpdated: new Date('2026-08-01T10:00:00.000Z'),
            }),
          ]);

          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              couponAmount: '0.00',
              marketplaceLastUpdated: new Date('2026-08-02T10:00:00.000Z'),
            }),
          ]);

          const [order] = await dataSource.query<MarketplaceOrderRow[]>(
            'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
            [accountId],
          );
          expect(order.coupon_amount).toBe('0.00');
        });

        it('um pedido que nunca teve o campo continua null após uma ressincronização também sem o campo (COALESCE(null, null) = null, nunca erro)', async () => {
          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              marketplaceLastUpdated: new Date('2026-08-01T10:00:00.000Z'),
            }),
          ]);

          await service.persistOrders([
            orderRecord({
              marketplaceAccountId: accountId,
              marketplaceLastUpdated: new Date('2026-08-02T10:00:00.000Z'),
            }),
          ]);

          const [order] = await dataSource.query<MarketplaceOrderRow[]>(
            'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
            [accountId],
          );
          expect(order.buyer_shipping_cost_amount).toBeNull();
        });
      });

      it('persistOrders continua sendo chamado uma única vez por execução — vários pedidos financeiros em um único lote', async () => {
        const result = await service.persistOrders([
          orderRecord({
            marketplaceAccountId: accountId,
            externalOrderId: 'a',
            buyerShippingCostAmount: '1.00',
          }),
          orderRecord({
            marketplaceAccountId: accountId,
            externalOrderId: 'b',
            buyerShippingCostAmount: '2.00',
          }),
        ]);
        expect(result).toEqual({
          ordersCreated: 2,
          ordersUpdated: 0,
          itemsPersisted: 2,
        });
      });
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

  describe('logistics_classification (Fase 4, "Full")', () => {
    it('defaults to UNKNOWN when the mapped record omits it', async () => {
      await service.persistOrders([
        orderRecord({ marketplaceAccountId: accountId }),
      ]);
      const [order] = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.logistics_classification).toBe('UNKNOWN');
      expect(order.logistics_type).toBeNull();
    });

    it('persists MARKETPLACE_FULFILLED with the raw logistics_type for audit', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          logisticsClassification: 'MARKETPLACE_FULFILLED',
          logisticsType: 'fulfillment',
        }),
      ]);
      const [order] = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.logistics_classification).toBe('MARKETPLACE_FULFILLED');
      expect(order.logistics_type).toBe('fulfillment');
    });

    it('never regresses an already-resolved classification back to UNKNOWN on a later UPSERT (e.g. defensive cap hit on a re-sync)', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          marketplaceLastUpdated: new Date('2026-08-01T10:00:00.000Z'),
          logisticsClassification: 'MARKETPLACE_FULFILLED',
          logisticsType: 'fulfillment',
        }),
      ]);

      const result = await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          status: 'cancelled',
          marketplaceLastUpdated: new Date('2026-08-02T10:00:00.000Z'),
          logisticsClassification: 'UNKNOWN',
          logisticsType: null,
        }),
      ]);
      expect(result.ordersUpdated).toBe(1);

      const [order] = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.status).toBe('cancelled');
      expect(order.logistics_classification).toBe('MARKETPLACE_FULFILLED');
      expect(order.logistics_type).toBe('fulfillment');
    });

    it('allows a resolved classification to replace another resolved one (e.g. corrected on re-sync)', async () => {
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          marketplaceLastUpdated: new Date('2026-08-01T10:00:00.000Z'),
          logisticsClassification: 'SELLER_FULFILLED',
          logisticsType: 'self_service',
        }),
      ]);

      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          marketplaceLastUpdated: new Date('2026-08-02T10:00:00.000Z'),
          logisticsClassification: 'MARKETPLACE_FULFILLED',
          logisticsType: 'fulfillment',
        }),
      ]);

      const [order] = await dataSource.query<MarketplaceOrderRow[]>(
        'SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1',
        [accountId],
      );
      expect(order.logistics_classification).toBe('MARKETPLACE_FULFILLED');
      expect(order.logistics_type).toBe('fulfillment');
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

  describe('getAccountSyncCoverage', () => {
    it('returns empty coverage for an account with no successful runs', async () => {
      const coverage = await service.getAccountSyncCoverage(accountId);
      expect(coverage).toEqual({
        intervals: [],
        oldestFrom: null,
        oldestRunRecordsRead: null,
      });
    });

    it('merges intervals from multiple SUCCESS runs and reports the oldest edge', async () => {
      const run1 = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date('2026-06-01T00:00:00.000Z'),
        periodTo: new Date('2026-07-01T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunSuccess(
        run1,
        {
          ordersFetched: 5,
          ordersCreated: 5,
          ordersUpdated: 0,
          pagesFetched: 1,
          itemsPersisted: 5,
        },
        new Date(),
      );

      const run2 = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date('2026-07-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-01T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunSuccess(
        run2,
        {
          ordersFetched: 3,
          ordersCreated: 3,
          ordersUpdated: 0,
          pagesFetched: 1,
          itemsPersisted: 3,
        },
        new Date(),
      );

      const coverage = await service.getAccountSyncCoverage(accountId);
      expect(coverage.intervals).toEqual([
        {
          from: new Date('2026-06-01T00:00:00.000Z'),
          to: new Date('2026-08-01T00:00:00.000Z'),
        },
      ]);
      expect(coverage.oldestFrom).toEqual(new Date('2026-06-01T00:00:00.000Z'));
      expect(coverage.oldestRunRecordsRead).toBe(5);
    });

    it('ignores RUNNING and FAILED runs — only SUCCESS proves coverage', async () => {
      const runningId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date('2026-06-01T00:00:00.000Z'),
        periodTo: new Date('2026-07-01T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunFailure(
        runningId,
        'PROVIDER_UNAVAILABLE',
        'Provedor indisponível.',
        new Date(),
      );

      const coverage = await service.getAccountSyncCoverage(accountId);
      expect(coverage.intervals).toEqual([]);
      expect(coverage.oldestFrom).toBeNull();
    });

    it('reports oldestRunRecordsRead = 0 faithfully as the raw DB value — the caller decides what it means (Fase 4: never proof of the true history start on its own)', async () => {
      const chunkId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date('2026-01-01T00:00:00.000Z'),
        periodTo: new Date('2026-02-01T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunSuccess(
        chunkId,
        {
          ordersFetched: 0,
          ordersCreated: 0,
          ordersUpdated: 0,
          pagesFetched: 1,
          itemsPersisted: 0,
        },
        new Date(),
      );

      const coverage = await service.getAccountSyncCoverage(accountId);
      expect(coverage.oldestRunRecordsRead).toBe(0);
    });
  });

  describe('getAccountOrderDateRange', () => {
    it('returns null when the account has no orders', async () => {
      expect(await service.getAccountOrderDateRange(accountId)).toBeNull();
    });

    it('returns the real MIN/MAX date_created across persisted orders, distinct accounts isolated', async () => {
      const otherAccount = await dataSource
        .getRepository(MarketplaceAccount)
        .save({
          id: randomUUID(),
          marketplace: Marketplace.MERCADO_LIVRE,
          externalSellerId: '999',
          nickname: null,
          status: MarketplaceAccountStatus.CONNECTED,
          tokenVersion: 1,
        });
      const otherAccountId = otherAccount.id;
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: '2001',
          dateCreated: new Date('2026-01-10T00:00:00.000Z'),
        }),
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: '2002',
          dateCreated: new Date('2026-08-20T00:00:00.000Z'),
        }),
        orderRecord({
          marketplaceAccountId: otherAccountId,
          externalOrderId: '3001',
          dateCreated: new Date('2020-01-01T00:00:00.000Z'),
        }),
      ]);

      const range = await service.getAccountOrderDateRange(accountId);
      expect(range?.first).toEqual(new Date('2026-01-10T00:00:00.000Z'));
      expect(range?.last).toEqual(new Date('2026-08-20T00:00:00.000Z'));
    });
  });

  describe('recoverStaleRunningRuns', () => {
    it('marks a long-stuck RUNNING run as FAILED with a sanitized error code', async () => {
      const staleId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      await dataSource.query(
        `UPDATE sync_runs SET started_at = $2 WHERE id = $1`,
        [staleId, new Date(Date.now() - 60 * 60 * 1000)],
      );

      const recovered = await service.recoverStaleRunningRuns(30 * 60 * 1000);
      expect(recovered).toBe(1);

      const [row] = await dataSource.query<
        Array<{ status: string; error_code: string | null }>
      >('SELECT status, error_code FROM sync_runs WHERE id = $1', [staleId]);
      expect(row.status).toBe('FAILED');
      expect(row.error_code).toBe('STALE_RUN_RECOVERED');
    });

    it('never touches a RUNNING run that is still within the stale threshold', async () => {
      const freshId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });

      const recovered = await service.recoverStaleRunningRuns(30 * 60 * 1000);
      expect(recovered).toBe(0);

      const [row] = await dataSource.query<Array<{ status: string }>>(
        'SELECT status FROM sync_runs WHERE id = $1',
        [freshId],
      );
      expect(row.status).toBe('RUNNING');
    });

    it('unblocks a new sync run on the same account after recovering the stale one', async () => {
      const staleId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.MERCADO_LIVRE,
        periodFrom: new Date(),
        periodTo: new Date(),
        startedAt: new Date(),
      });
      await dataSource.query(
        `UPDATE sync_runs SET started_at = $2 WHERE id = $1`,
        [staleId, new Date(Date.now() - 60 * 60 * 1000)],
      );

      await service.recoverStaleRunningRuns(30 * 60 * 1000);

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
  });

  describe('sync_runs.covered_through — coluna e CHECK (Checkpoint CP2K-5C-1)', () => {
    it('the migration added the column: a plain UPDATE with a valid value succeeds', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await dataSource.query(
        `UPDATE sync_runs SET covered_through = $2 WHERE id = $1`,
        [runId, new Date('2026-08-10T00:00:00.000Z')],
      );

      const [row] = await dataSource.query<
        Array<{ covered_through: Date | null }>
      >('SELECT covered_through FROM sync_runs WHERE id = $1', [runId]);
      expect(row.covered_through).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    });

    it('NULL is always accepted (default state of every pre-existing row)', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });

      const [row] = await dataSource.query<
        Array<{ covered_through: Date | null }>
      >('SELECT covered_through FROM sync_runs WHERE id = $1', [runId]);
      expect(row.covered_through).toBeNull();
    });

    it('the CHECK rejects covered_through BEFORE date_from', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await expect(
        dataSource.query(
          `UPDATE sync_runs SET covered_through = $2 WHERE id = $1`,
          [runId, new Date('2026-07-31T23:59:59.000Z')],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('the CHECK rejects covered_through AFTER date_to', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await expect(
        dataSource.query(
          `UPDATE sync_runs SET covered_through = $2 WHERE id = $1`,
          [runId, new Date('2026-08-15T00:00:01.000Z')],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('the CHECK rejects a filled covered_through when date_from/date_to are NULL (raw insert, bypassing beginSyncRun)', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO sync_runs
              (marketplace_account_id, marketplace, type, status, started_at,
               date_from, date_to, covered_through)
            VALUES ($1, 'SHOPEE', 'MANUAL', 'PARTIAL', now(), NULL, NULL, $2)`,
          [accountId, new Date('2026-08-10T00:00:00.000Z')],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('down() removes the constraint and then the column, cleanly reverting up()', async () => {
      const migration = new SyncRunsCoveredThrough1788800000000();
      const queryRunner = dataSource.createQueryRunner();
      try {
        await migration.down(queryRunner);
        const columnsAfterDown = await dataSource.query<
          Array<{ column_name: string }>
        >(
          `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'sync_runs' AND column_name = 'covered_through'`,
        );
        expect(columnsAfterDown).toHaveLength(0);

        await migration.up(queryRunner);
        const columnsAfterUp = await dataSource.query<
          Array<{ column_name: string }>
        >(
          `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'sync_runs' AND column_name = 'covered_through'`,
        );
        expect(columnsAfterUp).toHaveLength(1);
      } finally {
        await queryRunner.release();
      }
    });
  });

  describe('finalizeSyncRunPartial (Checkpoint CP2K-5C-1)', () => {
    it('writes status=PARTIAL, all 6 counters, error and covered_through in a single UPDATE', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await service.finalizeSyncRunPartial(
        runId,
        {
          ordersFetched: 5200,
          ordersCreated: 5000,
          ordersUpdated: 200,
          recordsFailed: 0,
          pagesFetched: 53,
          itemsPersisted: 9800,
        },
        new Date('2026-08-09T00:00:00.000Z'),
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      const [row] = await dataSource.query<
        Array<{
          status: string;
          covered_through: Date | null;
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
        `SELECT status, covered_through, records_read, records_created,
                records_updated, records_failed, pages_fetched, items_persisted,
                error_code, error_summary
           FROM sync_runs WHERE id = $1`,
        [runId],
      );

      expect(row.status).toBe('PARTIAL');
      expect(row.covered_through).toEqual(new Date('2026-08-09T00:00:00.000Z'));
      expect(row.records_read).toBe(5200);
      expect(row.records_created).toBe(5000);
      expect(row.records_updated).toBe(200);
      expect(row.records_failed).toBe(0);
      expect(row.pages_fetched).toBe(53);
      expect(row.items_persisted).toBe(9800);
      expect(row.error_code).toBe('SHOPEE_SAFETY_CAP_REACHED');
      expect(row.error_summary).toBe(
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
      );
    });

    it('accepts covered_through = null (cap before completing any block)', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await service.finalizeSyncRunPartial(
        runId,
        {
          ordersFetched: 100,
          ordersCreated: 100,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 1,
          itemsPersisted: 180,
        },
        null,
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      const [row] = await dataSource.query<
        Array<{ status: string; covered_through: Date | null }>
      >('SELECT status, covered_through FROM sync_runs WHERE id = $1', [runId]);
      expect(row.status).toBe('PARTIAL');
      expect(row.covered_through).toBeNull();
    });

    it('rejects (application layer) a covered_through outside [date_from, date_to] with InvalidCoveredThroughError, and writes nothing', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });

      await expect(
        service.finalizeSyncRunPartial(
          runId,
          {
            ordersFetched: 1,
            ordersCreated: 1,
            ordersUpdated: 0,
            recordsFailed: 0,
            pagesFetched: 1,
            itemsPersisted: 1,
          },
          new Date('2026-09-01T00:00:00.000Z'), // depois de date_to
          'SHOPEE_SAFETY_CAP_REACHED',
          'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
          new Date(),
        ),
      ).rejects.toBeInstanceOf(InvalidCoveredThroughError);

      const [row] = await dataSource.query<Array<{ status: string }>>(
        'SELECT status FROM sync_runs WHERE id = $1',
        [runId],
      );
      // Continua RUNNING: nenhuma escrita foi feita.
      expect(row.status).toBe('RUNNING');
    });

    it('the error never includes order/credential data — only the fixed domain code', () => {
      expect(new InvalidCoveredThroughError().message).toBe(
        'INVALID_COVERED_THROUGH',
      );
    });

    it('the run leaves RUNNING (frees the active-run-per-account unique index)', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunPartial(
        runId,
        {
          ordersFetched: 1,
          ordersCreated: 1,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 1,
          itemsPersisted: 1,
        },
        new Date('2026-08-05T00:00:00.000Z'),
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      await expect(
        service.beginSyncRun({
          marketplaceAccountId: accountId,
          marketplace: Marketplace.SHOPEE,
          periodFrom: new Date(),
          periodTo: new Date(),
          startedAt: new Date(),
        }),
      ).resolves.toEqual(expect.any(String));
    });
  });

  describe('getAccountSyncCoverage — PARTIAL (Checkpoint CP2K-5C-1)', () => {
    it('a PARTIAL run WITH covered_through contributes coverage only up to that boundary, never up to date_to', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunPartial(
        runId,
        {
          ordersFetched: 5000,
          ordersCreated: 5000,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 50,
          itemsPersisted: 9000,
        },
        new Date('2026-08-09T00:00:00.000Z'),
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      const coverage = await service.getAccountSyncCoverage(accountId);
      expect(coverage.intervals).toEqual([
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-09T00:00:00.000Z'),
        },
      ]);
      expect(coverage.oldestFrom).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    });

    it('a PARTIAL run with covered_through=NULL never contributes coverage', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunPartial(
        runId,
        {
          ordersFetched: 10,
          ordersCreated: 10,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 1,
          itemsPersisted: 15,
        },
        null,
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      const coverage = await service.getAccountSyncCoverage(accountId);
      expect(coverage.intervals).toEqual([]);
      expect(coverage.oldestFrom).toBeNull();
    });

    it('oldestRunRecordsRead ignores PARTIAL even when its date_from is earlier than every SUCCESS run, including records_read=0', async () => {
      const partialRunId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-01-01T00:00:00.000Z'),
        periodTo: new Date('2026-01-15T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunPartial(
        partialRunId,
        {
          ordersFetched: 0,
          ordersCreated: 0,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 1,
          itemsPersisted: 0,
        },
        new Date('2026-01-10T00:00:00.000Z'),
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      const successRunId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-06-01T00:00:00.000Z'),
        periodTo: new Date('2026-07-01T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunSuccess(
        successRunId,
        {
          ordersFetched: 7,
          ordersCreated: 7,
          ordersUpdated: 0,
          pagesFetched: 1,
          itemsPersisted: 7,
        },
        new Date(),
      );

      const coverage = await service.getAccountSyncCoverage(accountId);
      // O PARTIAL (2026-01) é mais antigo, mas o SUCCESS (2026-06) é o único
      // que pode legitimamente alimentar oldestRunRecordsRead.
      expect(coverage.oldestFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(coverage.oldestRunRecordsRead).toBe(7);
    });

    it('mixes SUCCESS and PARTIAL runs into a single merged, gap-free interval when they connect', async () => {
      const partialRunId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-20T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunPartial(
        partialRunId,
        {
          ordersFetched: 5000,
          ordersCreated: 5000,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 50,
          itemsPersisted: 9000,
        },
        new Date('2026-08-10T00:00:00.000Z'),
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      const successRunId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-09T00:00:00.000Z'), // sobrepõe o PARTIAL
        periodTo: new Date('2026-08-21T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunSuccess(
        successRunId,
        {
          ordersFetched: 50,
          ordersCreated: 50,
          ordersUpdated: 0,
          pagesFetched: 1,
          itemsPersisted: 50,
        },
        new Date(),
      );

      const coverage = await service.getAccountSyncCoverage(accountId);
      expect(coverage.intervals).toEqual([
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-21T00:00:00.000Z'),
        },
      ]);
    });

    it('a PARTIAL run still never counts in the SUCCESS-only coverage query used elsewhere (dashboard/KPI legacy)', async () => {
      const runId = await service.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: new Date('2026-08-01T00:00:00.000Z'),
        periodTo: new Date('2026-08-15T00:00:00.000Z'),
        startedAt: new Date(),
      });
      await service.finalizeSyncRunPartial(
        runId,
        {
          ordersFetched: 10,
          ordersCreated: 10,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 1,
          itemsPersisted: 15,
        },
        new Date('2026-08-05T00:00:00.000Z'),
        'SHOPEE_SAFETY_CAP_REACHED',
        'Sincronização interrompida por teto de segurança antes do fim natural da janela.',
        new Date(),
      );

      const successRows = await dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM sync_runs WHERE marketplace_account_id = $1 AND status = 'SUCCESS'`,
        [accountId],
      );
      expect(successRows.find((r) => r.id === runId)).toBeUndefined();
    });
  });

  describe('marketplace_orders financial fields migration (CP2K-7D)', () => {
    it('columns are nullable, correctly typed numeric(14,2), and down() cleanly reverts up()', async () => {
      const migration = new MarketplaceOrdersFinancialFields1788900000000();
      const queryRunner = dataSource.createQueryRunner();
      try {
        const expectedOrderColumns = [
          'marketplace_fee_amount',
          'buyer_shipping_cost_amount',
          'taxes_amount',
          'coupon_amount',
          'refunded_amount',
        ];

        const beforeDown = await dataSource.query<
          Array<{
            column_name: string;
            is_nullable: string;
            numeric_precision: number;
            numeric_scale: number;
            column_default: string | null;
          }>
        >(
          `SELECT column_name, is_nullable, numeric_precision, numeric_scale, column_default
             FROM information_schema.columns
            WHERE table_name = 'marketplace_orders'
              AND column_name = ANY($1)`,
          [expectedOrderColumns],
        );
        expect(beforeDown).toHaveLength(5);
        for (const column of beforeDown) {
          expect(column.is_nullable).toBe('YES');
          expect(column.numeric_precision).toBe(14);
          expect(column.numeric_scale).toBe(2);
          // Sem default — ausência de dado nunca vira zero silenciosamente.
          expect(column.column_default).toBeNull();
        }

        const itemColumnBeforeDown = await dataSource.query<
          Array<{ column_name: string; is_nullable: string }>
        >(
          `SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_name = 'marketplace_order_items'
              AND column_name = 'sale_fee_amount'`,
        );
        expect(itemColumnBeforeDown).toHaveLength(1);
        expect(itemColumnBeforeDown[0].is_nullable).toBe('YES');

        await migration.down(queryRunner);

        const afterDown = await dataSource.query<
          Array<{ column_name: string }>
        >(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'marketplace_orders' AND column_name = ANY($1)`,
          [expectedOrderColumns],
        );
        expect(afterDown).toHaveLength(0);

        const itemColumnAfterDown = await dataSource.query<
          Array<{ column_name: string }>
        >(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'marketplace_order_items' AND column_name = 'sale_fee_amount'`,
        );
        expect(itemColumnAfterDown).toHaveLength(0);

        await migration.up(queryRunner);

        const afterUp = await dataSource.query<Array<{ column_name: string }>>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'marketplace_orders' AND column_name = ANY($1)`,
          [expectedOrderColumns],
        );
        expect(afterUp).toHaveLength(5);
      } finally {
        await queryRunner.release();
      }
    });

    it('adding the columns never updates any pre-existing row (no mass UPDATE) — an order inserted before up() reruns stays untouched and null', async () => {
      // Este pedido já existe ANTES do down()/up() abaixo — se a migration
      // fizesse qualquer UPDATE em massa, este teste capturaria a regressão.
      await service.persistOrders([
        orderRecord({
          marketplaceAccountId: accountId,
          externalOrderId: 'pre-existing',
          buyerShippingCostAmount: '9.90',
        }),
      ]);

      const migration = new MarketplaceOrdersFinancialFields1788900000000();
      const queryRunner = dataSource.createQueryRunner();
      try {
        await migration.down(queryRunner);
        await migration.up(queryRunner);
      } finally {
        await queryRunner.release();
      }

      // down() removeu a coluna (dado antigo perdido, como esperado de um
      // DROP COLUMN) e up() a recriou vazia — o pedido pré-existente
      // continua válido, com o campo agora NULL (nunca 0, nunca erro).
      const [order] = await dataSource.query<MarketplaceOrderRow[]>(
        `SELECT * FROM marketplace_orders WHERE marketplace_account_id = $1 AND external_order_id = 'pre-existing'`,
        [accountId],
      );
      expect(order).toBeDefined();
      expect(order.buyer_shipping_cost_amount).toBeNull();
    });
  });
});
