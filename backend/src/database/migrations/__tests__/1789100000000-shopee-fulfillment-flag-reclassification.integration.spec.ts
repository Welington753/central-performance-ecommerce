import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../../test-utils/create-test-data-source';
import { SyncRun } from '../../../sync/sync-run.entity';
import { Marketplace } from '../../../integrations/contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../../../integrations/marketplace-accounts/marketplace-account.entity';
import { MarketplaceOrder } from '../../../integrations/marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../../../integrations/marketplace-orders/marketplace-order-item.entity';
import { ShopeeFulfillmentFlagReclassification1789100000000 } from '../1789100000000-shopee-fulfillment-flag-reclassification';

/**
 * Prova, contra um PostgreSQL real, que a migration histórica do "Shopee
 * Full/FBS" classifica somente pedidos Shopee (nunca ML/Amazon), nunca toca
 * `fulfillment_channel`/valores financeiros, e que `down`/reaplicação do
 * `up` são coerentes (Task 7, requisitos de teste da migration).
 */
describe('ShopeeFulfillmentFlagReclassification1789100000000 (Postgres real)', () => {
  let dataSource: DataSource;
  const migration = new ShopeeFulfillmentFlagReclassification1789100000000();

  let shopeeAccountId: string;
  let mercadoLivreAccountId: string;
  let amazonAccountId: string;

  async function seedAccount(marketplace: Marketplace): Promise<string> {
    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace,
      externalSellerId: `seller-${marketplace}`,
      nickname: `Conta ${marketplace}`,
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    return account.id;
  }

  async function seedOrder(input: {
    accountId: string;
    fulfillmentChannel: string | null;
    logisticsClassification: string;
    totalAmount?: string;
  }): Promise<string> {
    const order = await dataSource.getRepository(MarketplaceOrder).save({
      id: randomUUID(),
      marketplaceAccountId: input.accountId,
      externalOrderId: `order-${randomUUID()}`,
      status: 'paid',
      currencyId: 'BRL',
      totalAmount: input.totalAmount ?? '100.00',
      packId: null,
      dateCreated: new Date('2026-01-10T00:00:00Z'),
      dateClosed: null,
      marketplaceLastUpdated: new Date('2026-01-10T00:00:00Z'),
      sourceStatus: null,
      fulfillmentChannel: input.fulfillmentChannel,
      externalMarketplaceId: null,
      logisticsClassification: input.logisticsClassification,
      logisticsType: null,
    });
    return order.id;
  }

  async function classificationOf(orderId: string): Promise<string> {
    const [row] = await dataSource.query<
      Array<{ logistics_classification: string }>
    >('SELECT logistics_classification FROM marketplace_orders WHERE id = $1', [
      orderId,
    ]);
    return row.logistics_classification;
  }

  async function fulfillmentChannelOf(orderId: string): Promise<string | null> {
    const [row] = await dataSource.query<
      Array<{ fulfillment_channel: string | null }>
    >('SELECT fulfillment_channel FROM marketplace_orders WHERE id = $1', [
      orderId,
    ]);
    return row.fulfillment_channel;
  }

  async function totalAmountOf(orderId: string): Promise<string> {
    const [row] = await dataSource.query<Array<{ total_amount: string }>>(
      'SELECT total_amount FROM marketplace_orders WHERE id = $1',
      [orderId],
    );
    return row.total_amount;
  }

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      SyncRun,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    shopeeAccountId = await seedAccount(Marketplace.SHOPEE);
    mercadoLivreAccountId = await seedAccount(Marketplace.MERCADO_LIVRE);
    amazonAccountId = await seedAccount(Marketplace.AMAZON);
  });

  async function runUp(): Promise<void> {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await migration.up(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function runDown(): Promise<void> {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await migration.down(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  it('classifica pedidos Shopee com fulfillment_channel = fulfilled_by_shopee como MARKETPLACE_FULFILLED', async () => {
    const orderId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'fulfilled_by_shopee',
      logisticsClassification: 'UNKNOWN',
    });

    await runUp();

    expect(await classificationOf(orderId)).toBe('MARKETPLACE_FULFILLED');
  });

  it('classifica pedidos Shopee com fulfillment_channel = fulfilled_by_local_seller como SELLER_FULFILLED', async () => {
    const orderId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'fulfilled_by_local_seller',
      logisticsClassification: 'UNKNOWN',
    });

    await runUp();

    expect(await classificationOf(orderId)).toBe('SELLER_FULFILLED');
  });

  it('mantém UNKNOWN para pedido Shopee com fulfillment_channel desconhecido ou ausente', async () => {
    const unknownFlagId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'algum_outro_valor',
      logisticsClassification: 'UNKNOWN',
    });
    const nullFlagId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: null,
      logisticsClassification: 'UNKNOWN',
    });

    await runUp();

    expect(await classificationOf(unknownFlagId)).toBe('UNKNOWN');
    expect(await classificationOf(nullFlagId)).toBe('UNKNOWN');
  });

  it('nunca toca pedidos Mercado Livre ou Amazon, mesmo com fulfillment_channel/logistics_classification parecidos', async () => {
    const mlOrderId = await seedOrder({
      accountId: mercadoLivreAccountId,
      fulfillmentChannel: null,
      logisticsClassification: 'SELLER_FULFILLED',
    });
    // Conta Amazon com um valor de `fulfillment_channel` igual, em texto, ao
    // vocabulário Shopee — nunca deve ser interpretado como Shopee Full.
    const amazonOrderId = await seedOrder({
      accountId: amazonAccountId,
      fulfillmentChannel: 'fulfilled_by_shopee',
      logisticsClassification: 'UNKNOWN',
    });

    await runUp();

    expect(await classificationOf(mlOrderId)).toBe('SELLER_FULFILLED');
    expect(await classificationOf(amazonOrderId)).toBe('UNKNOWN');
  });

  it('não altera fulfillment_channel nem valores financeiros', async () => {
    const orderId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'fulfilled_by_shopee',
      logisticsClassification: 'UNKNOWN',
      totalAmount: '250.75',
    });

    await runUp();

    expect(await fulfillmentChannelOf(orderId)).toBe('fulfilled_by_shopee');
    expect(await totalAmountOf(orderId)).toBe('250.75');
  });

  it('down reverte exatamente os pedidos Shopee classificados pelo up, de volta a UNKNOWN', async () => {
    const shopeeFullId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'fulfilled_by_shopee',
      logisticsClassification: 'UNKNOWN',
    });
    const shopeeSellerId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'fulfilled_by_local_seller',
      logisticsClassification: 'UNKNOWN',
    });
    const mlOrderId = await seedOrder({
      accountId: mercadoLivreAccountId,
      fulfillmentChannel: null,
      logisticsClassification: 'MARKETPLACE_FULFILLED',
    });

    await runUp();
    await runDown();

    expect(await classificationOf(shopeeFullId)).toBe('UNKNOWN');
    expect(await classificationOf(shopeeSellerId)).toBe('UNKNOWN');
    // ML nunca foi tocado por up nem por down.
    expect(await classificationOf(mlOrderId)).toBe('MARKETPLACE_FULFILLED');
  });

  it('reaplicar up após down produz exatamente o mesmo resultado (idempotência up → down → up)', async () => {
    const shopeeFullId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'fulfilled_by_shopee',
      logisticsClassification: 'UNKNOWN',
    });
    const shopeeSellerId = await seedOrder({
      accountId: shopeeAccountId,
      fulfillmentChannel: 'fulfilled_by_local_seller',
      logisticsClassification: 'UNKNOWN',
    });

    await runUp();
    const firstPass = {
      full: await classificationOf(shopeeFullId),
      seller: await classificationOf(shopeeSellerId),
    };

    await runDown();
    await runUp();
    const secondPass = {
      full: await classificationOf(shopeeFullId),
      seller: await classificationOf(shopeeSellerId),
    };

    expect(secondPass).toEqual(firstPass);
    expect(secondPass).toEqual({
      full: 'MARKETPLACE_FULFILLED',
      seller: 'SELLER_FULFILLED',
    });
  });
});
