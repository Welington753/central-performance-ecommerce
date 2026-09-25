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
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { MarketplaceOrdersPersistenceService } from '../marketplace-orders/marketplace-orders-persistence.service';
import { validateShopeeOrderDetailResponseBody } from './shopee-order-detail-response';
import { mapShopeeOrder } from './shopee-order.mapper';

/**
 * Lacuna apontada pela auditoria Full: o `fulfillment_flag` da Shopee era
 * provado no PARSER e no MAPPER, mas nada provava que ele chega ao banco.
 * Esta suíte percorre a cadeia inteira — corpo bruto do detalhe do pedido,
 * validação por allowlist, mapper e persistência real — e verifica a coluna.
 *
 * Auditoria de produção (Shopee Full/FBS) confirmou o vocabulário fechado de
 * `fulfillment_flag`: `'fulfilled_by_shopee'` → `MARKETPLACE_FULFILLED`,
 * `'fulfilled_by_local_seller'` → `SELLER_FULFILLED`, qualquer outro valor
 * (ou ausente) → `UNKNOWN` (ver `classifyShopeeFulfillmentFlag`). Esta suíte
 * continua provando a coluna bruta `fulfillment_channel` como transporte
 * fiel do valor original — a classificação canônica é testada à parte,
 * abaixo.
 */
describe('Shopee fulfillment_flag — parser → mapper → persistência (Postgres real)', () => {
  let dataSource: DataSource;
  let persistence: MarketplaceOrdersPersistenceService;
  let accountId: string;

  const ORDER_SN = '2404098R48U37H';

  function detailBody(fulfillmentFlag: string | null) {
    const order: Record<string, unknown> = {
      order_sn: ORDER_SN,
      region: 'VN',
      currency: 'VND',
      order_status: 'COMPLETED',
      total_amount: 1004.0,
      create_time: 1712601591,
      update_time: 1713139948,
      item_list: [
        {
          item_id: 2600144043,
          item_name: 'backpack',
          item_sku: 'item-sku',
          model_id: 221404189791,
          model_name: '60g',
          model_sku: 'model-sku',
          model_quantity_purchased: 2,
          model_original_price: 3000.0,
          model_discounted_price: 2480.0,
        },
      ],
    };
    if (fulfillmentFlag !== null) {
      order.fulfillment_flag = fulfillmentFlag;
    }
    return {
      error: '',
      message: '',
      request_id: 'req-abc123',
      response: { order_list: [order] },
    };
  }

  function mapFromBody(fulfillmentFlag: string | null) {
    const validation = validateShopeeOrderDetailResponseBody(
      detailBody(fulfillmentFlag),
      [ORDER_SN],
    );
    if (!validation.valid) {
      throw new Error('fixture inválida para esta suíte');
    }
    return mapShopeeOrder(accountId, validation.result.orders[0]);
  }

  async function storedFulfillmentChannel(): Promise<string | null> {
    const [row] = await dataSource.query<
      Array<{ fulfillment_channel: string | null }>
    >(
      'SELECT fulfillment_channel FROM marketplace_orders WHERE marketplace_account_id = $1',
      [accountId],
    );
    return row.fulfillment_channel;
  }

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      SyncRun,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    persistence = new MarketplaceOrdersPersistenceService(
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
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.SHOPEE,
      externalSellerId: '777',
      nickname: 'Shopee 1',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    accountId = account.id;
  });

  it('carries the parsed fulfillment_flag all the way into the database column', async () => {
    const mapped = mapFromBody('fulfilled_by_local_seller');
    expect(mapped.fulfillmentChannel).toBe('fulfilled_by_local_seller');

    await persistence.persistOrders([mapped]);

    expect(await storedFulfillmentChannel()).toBe('fulfilled_by_local_seller');
  });

  it('stores NULL — never a guess — when the detail omits the flag', async () => {
    const mapped = mapFromBody(null);
    expect(mapped.fulfillmentChannel).toBeNull();

    await persistence.persistOrders([mapped]);

    expect(await storedFulfillmentChannel()).toBeNull();
  });

  it('never lets a later upsert lose a known flag for no reason', async () => {
    const first = mapFromBody('fulfilled_by_local_seller');
    await persistence.persistOrders([first]);

    // Reprocessamento do MESMO pedido cujo detalhe não trouxe o campo
    // (resposta parcial) — o valor já conhecido é preservado.
    const second = mapFromBody(null);
    second.marketplaceLastUpdated = new Date(
      (first.marketplaceLastUpdated?.getTime() ?? 0) + 60_000,
    );
    await persistence.persistOrders([second]);

    expect(await storedFulfillmentChannel()).toBe('fulfilled_by_local_seller');
  });

  it('keeps a NEW non-null flag when the provider really changed it', async () => {
    await persistence.persistOrders([mapFromBody('fulfilled_by_local_seller')]);

    const second = mapFromBody('outro_valor_qualquer');
    second.marketplaceLastUpdated = new Date(Date.now() + 60_000);
    await persistence.persistOrders([second]);

    expect(await storedFulfillmentChannel()).toBe('outro_valor_qualquer');
  });

  it('never mixes accounts — a second Shopee account gets its own flag, independent of the first', async () => {
    const secondAccount = await dataSource
      .getRepository(MarketplaceAccount)
      .save({
        id: randomUUID(),
        marketplace: Marketplace.SHOPEE,
        externalSellerId: '888',
        nickname: 'Shopee 2',
        status: MarketplaceAccountStatus.CONNECTED,
        tokenVersion: 1,
      });

    const firstOrder = mapFromBody('fulfilled_by_local_seller');
    await persistence.persistOrders([firstOrder]);

    // Mesmo `order_sn` (é comum entre vendedores diferentes), MESMO
    // `ORDER_SN`, mas mapeado para a SEGUNDA conta com um valor DIFERENTE.
    const validation = validateShopeeOrderDetailResponseBody(
      detailBody('outro_fulfillment_flag'),
      [ORDER_SN],
    );
    if (!validation.valid) throw new Error('fixture inválida para esta suíte');
    const secondOrder = mapShopeeOrder(
      secondAccount.id,
      validation.result.orders[0],
    );
    await persistence.persistOrders([secondOrder]);

    const rows = await dataSource.query<
      Array<{
        marketplace_account_id: string;
        fulfillment_channel: string | null;
      }>
    >(
      'SELECT marketplace_account_id, fulfillment_channel FROM marketplace_orders ORDER BY marketplace_account_id',
    );
    expect(rows).toHaveLength(2);
    const firstRow = rows.find(
      (row) => row.marketplace_account_id === accountId,
    );
    const secondRow = rows.find(
      (row) => row.marketplace_account_id === secondAccount.id,
    );
    expect(firstRow?.fulfillment_channel).toBe('fulfilled_by_local_seller');
    expect(secondRow?.fulfillment_channel).toBe('outro_fulfillment_flag');
  });

  it('classifica "fulfilled_by_shopee" como MARKETPLACE_FULFILLED na persistência', async () => {
    await persistence.persistOrders([mapFromBody('fulfilled_by_shopee')]);

    const [row] = await dataSource.query<
      Array<{ logistics_classification: string; logistics_type: string | null }>
    >(
      'SELECT logistics_classification, logistics_type FROM marketplace_orders WHERE marketplace_account_id = $1',
      [accountId],
    );
    expect(row.logistics_classification).toBe('MARKETPLACE_FULFILLED');
    expect(row.logistics_type).toBeNull();
  });

  it('classifica "fulfilled_by_local_seller" como SELLER_FULFILLED na persistência', async () => {
    await persistence.persistOrders([mapFromBody('fulfilled_by_local_seller')]);

    const [row] = await dataSource.query<
      Array<{ logistics_classification: string }>
    >(
      'SELECT logistics_classification FROM marketplace_orders WHERE marketplace_account_id = $1',
      [accountId],
    );
    expect(row.logistics_classification).toBe('SELLER_FULFILLED');
  });

  it('valor ausente/não reconhecido permanece UNKNOWN na persistência', async () => {
    await persistence.persistOrders([mapFromBody(null)]);

    const [row] = await dataSource.query<
      Array<{ logistics_classification: string }>
    >(
      'SELECT logistics_classification FROM marketplace_orders WHERE marketplace_account_id = $1',
      [accountId],
    );
    expect(row.logistics_classification).toBe('UNKNOWN');
  });

  it('payload parcial sem fulfillment_flag não apaga classificação já resolvida (COALESCE + regra de não regressão UNKNOWN)', async () => {
    await persistence.persistOrders([mapFromBody('fulfilled_by_shopee')]);

    // Resync sem o campo (ausente no detalhe) — mapper produz UNKNOWN, mas a
    // persistência genérica (`marketplace-orders-persistence.service.ts`)
    // nunca regride uma classificação já resolvida de volta para UNKNOWN.
    const resynced = mapFromBody(null);
    resynced.marketplaceLastUpdated = new Date(
      (resynced.marketplaceLastUpdated?.getTime() ?? 0) + 1000,
    );
    await persistence.persistOrders([resynced]);

    const [row] = await dataSource.query<
      Array<{
        logistics_classification: string;
        fulfillment_channel: string | null;
      }>
    >(
      'SELECT logistics_classification, fulfillment_channel FROM marketplace_orders WHERE marketplace_account_id = $1',
      [accountId],
    );
    expect(row.logistics_classification).toBe('MARKETPLACE_FULFILLED');
    expect(row.fulfillment_channel).toBe('fulfilled_by_shopee');
  });
});
