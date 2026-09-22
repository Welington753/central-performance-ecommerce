import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { SyncRun } from '../../sync/sync-run.entity';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { LogisticsReclassificationRepository } from './logistics-reclassification.repository';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceOrderItem } from './marketplace-order-item.entity';

/**
 * Prova contra Postgres real das garantias que a reclassificação depende
 * (correção da auditoria Full): fila correta, cursor retomável e escrita
 * CONDICIONAL que nunca sobrescreve uma classificação já resolvida.
 */
describe('LogisticsReclassificationRepository (Postgres real)', () => {
  let dataSource: DataSource;
  let repository: LogisticsReclassificationRepository;
  let mlAccountId: string;
  let shopeeAccountId: string;

  async function insertOrder(input: {
    accountId: string;
    externalOrderId: string;
    classification: string;
    externalShipmentId: string | null;
  }): Promise<string> {
    const [row] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_orders
          (marketplace_account_id, external_order_id, status, currency_id,
           total_amount, date_created, logistics_classification,
           external_shipment_id, updated_at)
        VALUES ($1, $2, 'paid', 'BRL', 100.00, now(), $3, $4, now())
        RETURNING id`,
      [
        input.accountId,
        input.externalOrderId,
        input.classification,
        input.externalShipmentId,
      ],
    );
    return row.id;
  }

  async function classificationOf(orderId: string): Promise<{
    classification: string;
    logisticsType: string | null;
  }> {
    const [row] = await dataSource.query<
      Array<{ logistics_classification: string; logistics_type: string | null }>
    >(
      'SELECT logistics_classification, logistics_type FROM marketplace_orders WHERE id = $1',
      [orderId],
    );
    return {
      classification: row.logistics_classification,
      logisticsType: row.logistics_type,
    };
  }

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      SyncRun,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    repository = new LogisticsReclassificationRepository(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE sync_runs CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const accounts = dataSource.getRepository(MarketplaceAccount);
    mlAccountId = (
      await accounts.save({
        id: randomUUID(),
        marketplace: Marketplace.MERCADO_LIVRE,
        externalSellerId: '111',
        nickname: 'Meli 1',
        status: MarketplaceAccountStatus.CONNECTED,
        tokenVersion: 1,
      })
    ).id;
    shopeeAccountId = (
      await accounts.save({
        id: randomUUID(),
        marketplace: Marketplace.SHOPEE,
        externalSellerId: '222',
        nickname: 'Shopee 1',
        status: MarketplaceAccountStatus.CONNECTED,
        tokenVersion: 1,
      })
    ).id;
  });

  describe('countPendingByAccount', () => {
    it('separates pending orders with and without a shipment identifier', async () => {
      await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '1',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-1',
      });
      await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '2',
        classification: 'UNKNOWN',
        externalShipmentId: null,
      });
      await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '3',
        classification: 'MARKETPLACE_FULFILLED',
        externalShipmentId: 'ship-3',
      });

      const [counts] = await repository.countPendingByAccount(
        Marketplace.MERCADO_LIVRE,
      );

      expect(counts).toEqual({
        marketplaceAccountId: mlAccountId,
        nickname: 'Meli 1',
        pendingWithShipmentId: 1,
        pendingWithoutShipmentId: 1,
        resolved: 1,
      });
    });

    it('never counts an account from another marketplace', async () => {
      await insertOrder({
        accountId: shopeeAccountId,
        externalOrderId: '1',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-1',
      });

      const counts = await repository.countPendingByAccount(
        Marketplace.MERCADO_LIVRE,
      );

      expect(counts).toEqual([]);
    });
  });

  describe('fetchPendingBatch', () => {
    it('returns only UNKNOWN orders that have a shipment identifier', async () => {
      const eligible = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '1',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-1',
      });
      await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '2',
        classification: 'UNKNOWN',
        externalShipmentId: null,
      });
      await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '3',
        classification: 'SELLER_FULFILLED',
        externalShipmentId: 'ship-3',
      });

      const batch = await repository.fetchPendingBatch({
        marketplaceAccountId: mlAccountId,
        limit: 10,
        afterId: null,
      });

      expect(batch).toEqual([{ id: eligible, externalShipmentId: 'ship-1' }]);
    });

    it('is resumable through the id cursor', async () => {
      for (const index of [1, 2, 3]) {
        await insertOrder({
          accountId: mlAccountId,
          externalOrderId: String(index),
          classification: 'UNKNOWN',
          externalShipmentId: `ship-${index}`,
        });
      }

      const first = await repository.fetchPendingBatch({
        marketplaceAccountId: mlAccountId,
        limit: 2,
        afterId: null,
      });
      const second = await repository.fetchPendingBatch({
        marketplaceAccountId: mlAccountId,
        limit: 2,
        afterId: first[first.length - 1].id,
      });

      expect(first).toHaveLength(2);
      expect(second).toHaveLength(1);
      expect(second[0].id > first[1].id).toBe(true);
    });

    it('never crosses into another account', async () => {
      await insertOrder({
        accountId: shopeeAccountId,
        externalOrderId: '1',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-1',
      });

      const batch = await repository.fetchPendingBatch({
        marketplaceAccountId: mlAccountId,
        limit: 10,
        afterId: null,
      });

      expect(batch).toEqual([]);
    });
  });

  describe('fetchPendingWithoutShipmentIdBatch (fallback de recuperação, revisão crítica)', () => {
    it('returns only UNKNOWN orders that do NOT have a shipment identifier', async () => {
      const eligible = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: 'hist-1',
        classification: 'UNKNOWN',
        externalShipmentId: null,
      });
      await insertOrder({
        accountId: mlAccountId,
        externalOrderId: 'hist-2',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-2',
      });
      await insertOrder({
        accountId: mlAccountId,
        externalOrderId: 'hist-3',
        classification: 'SELLER_FULFILLED',
        externalShipmentId: null,
      });

      const batch = await repository.fetchPendingWithoutShipmentIdBatch({
        marketplaceAccountId: mlAccountId,
        limit: 10,
        afterId: null,
      });

      expect(batch).toEqual([{ id: eligible, externalOrderId: 'hist-1' }]);
    });

    it('is resumable through the id cursor', async () => {
      for (const index of [1, 2, 3]) {
        await insertOrder({
          accountId: mlAccountId,
          externalOrderId: `hist-${index}`,
          classification: 'UNKNOWN',
          externalShipmentId: null,
        });
      }

      const first = await repository.fetchPendingWithoutShipmentIdBatch({
        marketplaceAccountId: mlAccountId,
        limit: 2,
        afterId: null,
      });
      const second = await repository.fetchPendingWithoutShipmentIdBatch({
        marketplaceAccountId: mlAccountId,
        limit: 2,
        afterId: first[first.length - 1].id,
      });

      expect(first).toHaveLength(2);
      expect(second).toHaveLength(1);
      expect(second[0].id > first[1].id).toBe(true);
    });

    it('never crosses into another account', async () => {
      await insertOrder({
        accountId: shopeeAccountId,
        externalOrderId: 'hist-1',
        classification: 'UNKNOWN',
        externalShipmentId: null,
      });

      const batch = await repository.fetchPendingWithoutShipmentIdBatch({
        marketplaceAccountId: mlAccountId,
        limit: 10,
        afterId: null,
      });

      expect(batch).toEqual([]);
    });
  });

  describe('attachRecoveredShipmentId (fallback de recuperação, revisão crítica)', () => {
    it('persists the recovered shipment id on an UNKNOWN order without one', async () => {
      const orderId = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: 'hist-1',
        classification: 'UNKNOWN',
        externalShipmentId: null,
      });

      const applied = await repository.attachRecoveredShipmentId({
        orderId,
        externalShipmentId: 'recovered-ship-1',
      });

      expect(applied).toBe(true);
      const [row] = await dataSource.query<
        Array<{
          external_shipment_id: string | null;
          logistics_classification: string;
        }>
      >(
        'SELECT external_shipment_id, logistics_classification FROM marketplace_orders WHERE id = $1',
        [orderId],
      );
      expect(row.external_shipment_id).toBe('recovered-ship-1');
      // Só o identificador muda — a classificação continua UNKNOWN até a
      // consulta de envio (etapa seguinte, feita por outro método).
      expect(row.logistics_classification).toBe('UNKNOWN');
    });

    it('never overwrites a shipment id already persisted by another process', async () => {
      const orderId = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: 'hist-1',
        classification: 'UNKNOWN',
        externalShipmentId: 'already-there',
      });

      const applied = await repository.attachRecoveredShipmentId({
        orderId,
        externalShipmentId: 'recovered-would-be-wrong',
      });

      expect(applied).toBe(false);
      const [row] = await dataSource.query<
        Array<{ external_shipment_id: string | null }>
      >('SELECT external_shipment_id FROM marketplace_orders WHERE id = $1', [
        orderId,
      ]);
      expect(row.external_shipment_id).toBe('already-there');
    });

    it('never touches an order already resolved (classification is no longer UNKNOWN)', async () => {
      const orderId = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: 'hist-1',
        classification: 'SELLER_FULFILLED',
        externalShipmentId: null,
      });

      const applied = await repository.attachRecoveredShipmentId({
        orderId,
        externalShipmentId: 'recovered-ship-1',
      });

      expect(applied).toBe(false);
      const [row] = await dataSource.query<
        Array<{ external_shipment_id: string | null }>
      >('SELECT external_shipment_id FROM marketplace_orders WHERE id = $1', [
        orderId,
      ]);
      expect(row.external_shipment_id).toBeNull();
    });
  });

  describe('applyResolvedClassification', () => {
    it('resolves an UNKNOWN order and stores the raw logistic type', async () => {
      const orderId = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '1',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-1',
      });

      const applied = await repository.applyResolvedClassification({
        orderId,
        classification: 'MARKETPLACE_FULFILLED',
        logisticsType: 'fulfillment',
      });

      expect(applied).toBe(true);
      expect(await classificationOf(orderId)).toEqual({
        classification: 'MARKETPLACE_FULFILLED',
        logisticsType: 'fulfillment',
      });
    });

    it('never overwrites a classification already resolved by another process', async () => {
      const orderId = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '1',
        classification: 'SELLER_FULFILLED',
        externalShipmentId: 'ship-1',
      });

      const applied = await repository.applyResolvedClassification({
        orderId,
        classification: 'MARKETPLACE_FULFILLED',
        logisticsType: 'fulfillment',
      });

      expect(applied).toBe(false);
      expect((await classificationOf(orderId)).classification).toBe(
        'SELLER_FULFILLED',
      );
    });

    it('is idempotent — a second identical apply changes nothing', async () => {
      const orderId = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '1',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-1',
      });

      expect(
        await repository.applyResolvedClassification({
          orderId,
          classification: 'MARKETPLACE_FULFILLED',
          logisticsType: 'fulfillment',
        }),
      ).toBe(true);
      expect(
        await repository.applyResolvedClassification({
          orderId,
          classification: 'MARKETPLACE_FULFILLED',
          logisticsType: 'fulfillment',
        }),
      ).toBe(false);

      const [{ count }] = await dataSource.query<Array<{ count: string }>>(
        'SELECT COUNT(*) AS count FROM marketplace_orders',
      );
      expect(Number(count)).toBe(1);
    });

    it('refuses to write UNKNOWN — nothing is ever degraded', async () => {
      const orderId = await insertOrder({
        accountId: mlAccountId,
        externalOrderId: '1',
        classification: 'UNKNOWN',
        externalShipmentId: 'ship-1',
      });

      const applied = await repository.applyResolvedClassification({
        orderId,
        classification: 'UNKNOWN',
        logisticsType: null,
      });

      expect(applied).toBe(false);
      expect((await classificationOf(orderId)).classification).toBe('UNKNOWN');
    });
  });
});
