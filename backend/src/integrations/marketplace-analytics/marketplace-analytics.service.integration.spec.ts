import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { MercadoLivreOrdersKpiService } from '../mercado-livre-orders/mercado-livre-orders-kpi.service';
import { toMercadoLivreKpisResponse } from '../mercado-livre-orders/dto/mercado-livre-kpis-response.dto';
import { resolveKpiPeriod } from '../marketplace-orders/period.util';
import { SyncRunStatus, SyncRunType } from '../../sync/sync-run.entity';
import type { RawAmazonOrder } from '../amazon-orders/amazon-order-response';
import { mapAmazonOrder } from '../amazon-orders/amazon-order.mapper';
import { MarketplaceOrdersPersistenceService } from '../marketplace-orders/marketplace-orders-persistence.service';
import { MarketplaceAnalyticsService } from './marketplace-analytics.service';
import { toMarketplaceAnalyticsResponse } from './dto/marketplace-analytics-response.dto';

const REFERENCE_NOW = new Date('2026-09-01T12:00:00.000Z');
const IN_CURRENT = new Date('2026-08-20T12:00:00.000Z');

describe('MarketplaceAnalyticsService (Postgres real)', () => {
  let dataSource: DataSource;
  let accountsService: MarketplaceAccountsService;
  let analyticsService: MarketplaceAnalyticsService;
  let legacyKpiService: MercadoLivreOrdersKpiService;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      MarketplaceAccount,
      MarketplaceOrder,
      MarketplaceOrderItem,
    ]);
    accountsService = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
    analyticsService = new MarketplaceAnalyticsService(
      dataSource,
      accountsService,
    );
    legacyKpiService = new MercadoLivreOrdersKpiService(dataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_order_items CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_orders CASCADE');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE sync_runs CASCADE');
  });

  async function seedAccount(
    overrides: {
      marketplace?: Marketplace;
      status?: MarketplaceAccountStatus;
      externalSellerId?: string | null;
      nickname?: string | null;
    } = {},
  ): Promise<string> {
    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: overrides.marketplace ?? Marketplace.MERCADO_LIVRE,
      externalSellerId: overrides.externalSellerId ?? null,
      nickname: overrides.nickname ?? null,
      status: overrides.status ?? MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    return account.id;
  }

  interface SeedOrderItemInput {
    externalItemId: string;
    variationId?: string | null;
    sellerSku: string | null;
    title: string;
    quantity: number;
    unitPrice: string;
  }

  async function seedOrder(input: {
    accountId: string;
    externalOrderId: string;
    status: string;
    totalAmount: string;
    dateCreated: Date;
    items: SeedOrderItemInput[];
    logisticsClassification?: string;
  }): Promise<void> {
    const [order] = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO marketplace_orders
          (marketplace_account_id, external_order_id, status, currency_id, total_amount, date_created, logistics_classification)
        VALUES ($1, $2, $3, 'BRL', $4, $5, $6)
        RETURNING id`,
      [
        input.accountId,
        input.externalOrderId,
        input.status,
        input.totalAmount,
        input.dateCreated,
        input.logisticsClassification ?? 'UNKNOWN',
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
    accountId: string,
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

  function defaultWindows() {
    return resolveKpiPeriod({}, REFERENCE_NOW);
  }

  it('1. a single Mercado Livre account produces the same numeric result as the legacy endpoint', async () => {
    const accountId = await seedAccount({ externalSellerId: '111' });
    await seedSuccessfulSyncRun(
      accountId,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-09-02T00:00:00.000Z'),
    );
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '150.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB1',
          sellerSku: 'SKU-A',
          title: 'Produto A',
          quantity: 3,
          unitPrice: '50.00',
        },
      ],
    });

    const legacyAggregate = await legacyKpiService.getAggregate(
      accountId,
      defaultWindows(),
    );
    const legacyDto = toMercadoLivreKpisResponse({
      account: { id: accountId, externalSellerId: '111', nickname: null },
      aggregate: legacyAggregate,
      lastSync: null,
    });

    const analyticsAggregate = await analyticsService.getAggregate(
      { accountId },
      REFERENCE_NOW,
    );
    const analyticsDto = toMarketplaceAnalyticsResponse(analyticsAggregate);

    expect(analyticsDto.summary?.grossRevenue).toBe(
      legacyDto.summary.grossRevenue,
    );
    expect(analyticsDto.summary?.orders).toBe(legacyDto.summary.orders);
    expect(analyticsDto.summary?.units).toBe(legacyDto.summary.units);
    expect(analyticsDto.summary?.averageTicket).toBe(
      legacyDto.summary.averageTicket,
    );
    expect(analyticsDto.summary?.cancelledOrders).toBe(
      legacyDto.summary.cancelledOrders,
    );
    expect(analyticsDto.summary?.distinctProducts).toBe(
      legacyDto.summary.distinctProducts,
    );
    expect(analyticsDto.bestDay?.grossRevenue).toBe(
      legacyDto.bestDay?.grossRevenue,
    );
  });

  it('2. two connected Mercado Livre accounts are summed correctly', async () => {
    const accountA = await seedAccount({ externalSellerId: 'A' });
    const accountB = await seedAccount({ externalSellerId: 'B' });
    await seedOrder({
      accountId: accountA,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '100.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'X1',
          sellerSku: 'SKU-1',
          title: 'P1',
          quantity: 1,
          unitPrice: '100.00',
        },
      ],
    });
    await seedOrder({
      accountId: accountB,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '50.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'X2',
          sellerSku: 'SKU-2',
          title: 'P2',
          quantity: 1,
          unitPrice: '50.00',
        },
      ],
    });

    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);

    expect(dto.summary?.grossRevenue).toBe('150.00');
    expect(dto.summary?.orders).toBe(2);
    expect(dto.breakdownByAccount).toHaveLength(2);
  });

  it('3. orders are never duplicated between accounts (same external_order_id per account is independent)', async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    await seedOrder({
      accountId: accountA,
      externalOrderId: 'SAME-ID',
      status: 'paid',
      totalAmount: '10.00',
      dateCreated: IN_CURRENT,
      items: [],
    });
    await seedOrder({
      accountId: accountB,
      externalOrderId: 'SAME-ID',
      status: 'paid',
      totalAmount: '20.00',
      dateCreated: IN_CURRENT,
      items: [],
    });

    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    expect(dto.summary?.orders).toBe(2);
    expect(dto.summary?.grossRevenue).toBe('30.00');
  });

  it('4. the same SKU with different spacing/case is consolidated into one row', async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    await seedOrder({
      accountId: accountA,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '50.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'X1',
          sellerSku: '  abc-123  ',
          title: 'Produto',
          quantity: 1,
          unitPrice: '50.00',
        },
      ],
    });
    await seedOrder({
      accountId: accountB,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '30.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'X2',
          sellerSku: 'ABC-123',
          title: 'Produto',
          quantity: 1,
          unitPrice: '30.00',
        },
      ],
    });

    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    const rows = dto.topProductsBySku.filter(
      (r) => r.sku?.toUpperCase() === 'ABC-123',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(2);
    expect(rows[0].distinctListings).toBe(2);
  });

  it('5. letter O and digit 0 are never confused as the same SKU', async () => {
    const accountId = await seedAccount();
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '10.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'X1',
          sellerSku: 'OPA300005PMA1',
          title: 'Com letra O',
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
          externalItemId: 'X2',
          sellerSku: '0PA300005PMA1',
          title: 'Com digito 0',
          quantity: 1,
          unitPrice: '10.00',
        },
      ],
    });

    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    const skus = dto.topProductsBySku.map((r) => r.sku).sort();
    expect(skus).toEqual(['0PA300005PMA1', 'OPA300005PMA1']);
  });

  it('6. the no-SKU fallback never collides between different accounts (same externalItemId)', async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    await seedOrder({
      accountId: accountA,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '10.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'SAME-ITEM',
          sellerSku: null,
          title: 'Produto conta A',
          quantity: 1,
          unitPrice: '10.00',
        },
      ],
    });
    await seedOrder({
      accountId: accountB,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '10.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'SAME-ITEM',
          sellerSku: null,
          title: 'Produto conta B',
          quantity: 1,
          unitPrice: '10.00',
        },
      ],
    });

    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    const noSkuRows = dto.topProductsBySku.filter((r) => r.sku === null);
    expect(noSkuRows).toHaveLength(2);
    expect(noSkuRows.map((r) => r.title).sort()).toEqual([
      'Produto conta A',
      'Produto conta B',
    ]);
  });

  it('7. an empty DISCONNECTED account is excluded from availability, breakdown and the aggregate', async () => {
    await seedAccount({ status: MarketplaceAccountStatus.DISCONNECTED });
    const activeAccountId = await seedAccount({
      status: MarketplaceAccountStatus.CONNECTED,
    });
    await seedOrder({
      accountId: activeAccountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '10.00',
      dateCreated: IN_CURRENT,
      items: [],
    });

    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    expect(dto.breakdownByAccount).toHaveLength(1);
    expect(dto.breakdownByAccount[0].accountId).toBe(activeAccountId);
    expect(dto.summary?.orders).toBe(1);
  });

  it('8. a TOKEN_EXPIRED account with real history keeps appearing (HISTORICAL_ONLY, never hidden)', async () => {
    const accountId = await seedAccount({
      status: MarketplaceAccountStatus.TOKEN_EXPIRED,
    });
    await seedOrder({
      accountId,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '75.00',
      dateCreated: IN_CURRENT,
      items: [],
    });

    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    expect(dto.breakdownByAccount).toHaveLength(1);
    expect(dto.breakdownByAccount[0].availability).toBe('HISTORICAL_ONLY');
    expect(dto.summary?.grossRevenue).toBe('75.00');
    expect(dto.availability).toBe('HISTORICAL_ONLY');
  });

  it('9. Amazon and Shopee without any connected/historical account return availability without numbers', async () => {
    await seedAccount({ marketplace: Marketplace.MERCADO_LIVRE });

    const aggregate = await analyticsService.getAggregate(
      { marketplace: 'AMAZON' },
      REFERENCE_NOW,
    );
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    expect(dto.availability).toBe('NOT_CONNECTED');
    expect(dto.summary).toBeNull();

    const allAggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const allDto = toMarketplaceAnalyticsResponse(allAggregate);
    const amazonBreakdown = allDto.breakdownByMarketplace.find(
      (m) => m.marketplace === Marketplace.AMAZON,
    );
    const shopeeBreakdown = allDto.breakdownByMarketplace.find(
      (m) => m.marketplace === Marketplace.SHOPEE,
    );
    expect(amazonBreakdown?.availability).toBe('NOT_CONNECTED');
    expect(amazonBreakdown?.summary).toBeNull();
    expect(shopeeBreakdown?.availability).toBe('NOT_CONNECTED');
    expect(shopeeBreakdown?.summary).toBeNull();
  });

  it("10. filtering by accountId fully isolates that account's data from the others", async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    await seedOrder({
      accountId: accountA,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '111.00',
      dateCreated: IN_CURRENT,
      items: [],
    });
    await seedOrder({
      accountId: accountB,
      externalOrderId: '1',
      status: 'paid',
      totalAmount: '999.00',
      dateCreated: IN_CURRENT,
      items: [],
    });

    const aggregate = await analyticsService.getAggregate(
      { accountId: accountA },
      REFERENCE_NOW,
    );
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    expect(dto.summary?.grossRevenue).toBe('111.00');
    expect(dto.summary?.orders).toBe(1);
    expect(dto.breakdownByAccount).toHaveLength(1);
    expect(dto.breakdownByAccount[0].accountId).toBe(accountA);
  });

  it('11. consolidated coverage only considers sources actually included in the aggregate', async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    await seedSuccessfulSyncRun(
      accountA,
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-09-02T12:00:00.000Z'),
    );
    // accountB nunca sincronizou (CONNECTED_NO_DATA) — está incluído no
    // agregado (soma zero, sem prejuízo numérico), mas força a cobertura
    // consolidada para "partial", nunca "complete".
    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    expect(aggregate.dataCoverage.status).toBe('partial');

    const onlyA = await analyticsService.getAggregate(
      { accountId: accountA },
      REFERENCE_NOW,
    );
    expect(onlyA.dataCoverage.status).toBe('complete');
    void accountB;
  });

  it('never exposes a raw zero for Amazon/Shopee as if it were proven — no summary object at all', async () => {
    await seedAccount({ marketplace: Marketplace.MERCADO_LIVRE });
    const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    const amazon = dto.breakdownByMarketplace.find(
      (m) => m.marketplace === Marketplace.AMAZON,
    );
    expect(JSON.stringify(amazon)).not.toContain('0.00');
  });

  it('a CONNECTED account with zero syncs (CONNECTED_NO_DATA) never shows a fabricated zero summary', async () => {
    const accountId = await seedAccount({
      status: MarketplaceAccountStatus.CONNECTED,
    });
    const aggregate = await analyticsService.getAggregate(
      { accountId },
      REFERENCE_NOW,
    );
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    expect(dto.availability).toBe('CONNECTED_NO_DATA');
    expect(dto.summary).toBeNull();
  });

  // -------------------------------------------------------------------
  // fix(kpis): reconcile gross sales and cancellations — "vendas brutas"
  // (pedidos pagos + cancelados com valor válido) equivalente ao indicador
  // do marketplace, e o painel de cancelamentos (todos os cancelados, sem
  // o filtro de valor válido).
  // -------------------------------------------------------------------
  it('gross sales reconcile paid + cancelled-with-value orders, mirroring the real-world discrepancy reported for 2026-08-04', async () => {
    const accountId = await seedAccount({ externalSellerId: '1548451374' });

    for (let i = 1; i <= 25; i += 1) {
      await seedOrder({
        accountId,
        externalOrderId: `paid-${i}`,
        status: 'paid',
        totalAmount: '265.31',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: `MLB-${i}`,
            sellerSku: `SKU-${i}`,
            title: 'Produto',
            quantity: i === 1 ? 4 : 1,
            unitPrice: i === 1 ? '66.33' : '265.31',
          },
        ],
      });
    }
    await seedOrder({
      accountId,
      externalOrderId: 'cancelled-with-value',
      status: 'cancelled',
      totalAmount: '579.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'MLB-CANC',
          sellerSku: 'SKU-CANC',
          title: 'Produto cancelado',
          quantity: 1,
          unitPrice: '579.00',
        },
      ],
    });

    const aggregate = await analyticsService.getAggregate(
      { accountId },
      REFERENCE_NOW,
    );
    const dto = toMarketplaceAnalyticsResponse(aggregate);

    // Operacional (pedidos pagos apenas) — nunca inclui o cancelado.
    expect(dto.summary?.grossRevenue).toBe('6632.75');
    expect(dto.summary?.orders).toBe(25);
    expect(dto.summary?.units).toBe(28);

    // Vendas brutas (equivalente ao marketplace) — paga + cancelada com valor.
    expect(dto.summary?.grossSalesRevenue).toBe('7211.75');
    expect(dto.summary?.grossSalesOrders).toBe(26);
    expect(dto.summary?.grossSalesUnits).toBe(29);

    // Painel de cancelamentos.
    expect(dto.summary?.cancelledOrders).toBe(1);
    expect(dto.summary?.cancelledUnits).toBe(1);
    expect(dto.summary?.cancelledRevenue).toBe('579.00');
  });

  it('excludes a cancelled order with zero value from gross sales, but still counts it in the cancellations panel', async () => {
    const accountId = await seedAccount();
    await seedOrder({
      accountId,
      externalOrderId: 'paid-1',
      status: 'paid',
      totalAmount: '100.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'X1',
          sellerSku: 'SKU-1',
          title: 'P1',
          quantity: 1,
          unitPrice: '100.00',
        },
      ],
    });
    await seedOrder({
      accountId,
      externalOrderId: 'cancelled-zero-value',
      status: 'cancelled',
      totalAmount: '0.00',
      dateCreated: IN_CURRENT,
      items: [
        {
          externalItemId: 'X2',
          sellerSku: 'SKU-2',
          title: 'P2',
          quantity: 1,
          unitPrice: '0.00',
        },
      ],
    });

    const aggregate = await analyticsService.getAggregate(
      { accountId },
      REFERENCE_NOW,
    );
    const dto = toMarketplaceAnalyticsResponse(aggregate);

    expect(dto.summary?.grossSalesOrders).toBe(1);
    expect(dto.summary?.grossSalesUnits).toBe(1);
    expect(dto.summary?.grossSalesRevenue).toBe('100.00');
    expect(dto.summary?.cancelledOrders).toBe(1);
    expect(dto.summary?.cancelledUnits).toBe(1);
    expect(dto.summary?.cancelledRevenue).toBe('0.00');
  });

  it('never divides by zero for gross-sales averages/comparisons when the scope has no data at all', async () => {
    const accountId = await seedAccount();
    const aggregate = await analyticsService.getAggregate(
      { accountId },
      REFERENCE_NOW,
    );
    expect(aggregate.availability).toBe('CONNECTED_NO_DATA');
    const dto = toMarketplaceAnalyticsResponse(aggregate);
    expect(dto.summary).toBeNull();
    expect(dto.comparison).toBeNull();
  });

  // -------------------------------------------------------------------
  // Checkpoint 4-B: coexistência Mercado Livre x Amazon no endpoint
  // genérico (10 cenários exigidos).
  // -------------------------------------------------------------------
  describe('Amazon (Checkpoint 4-B)', () => {
    interface SeedAmazonOrderInput {
      accountId: string;
      externalOrderId: string;
      status: string;
      totalAmount: string;
      currencyId?: string;
      dateCreated: Date;
      sourceStatus?: string | null;
      fulfillmentChannel?: string | null;
      externalMarketplaceId?: string | null;
      items: SeedOrderItemInput[];
    }

    async function seedOrderExtended(
      input: SeedAmazonOrderInput,
    ): Promise<void> {
      const currencyId = input.currencyId ?? 'BRL';
      const [order] = await dataSource.query<Array<{ id: string }>>(
        `INSERT INTO marketplace_orders
            (marketplace_account_id, external_order_id, status, currency_id,
             total_amount, date_created, source_status, fulfillment_channel,
             external_marketplace_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id`,
        [
          input.accountId,
          input.externalOrderId,
          input.status,
          currencyId,
          input.totalAmount,
          input.dateCreated,
          input.sourceStatus ?? null,
          input.fulfillmentChannel ?? null,
          input.externalMarketplaceId ?? null,
        ],
      );

      for (const item of input.items) {
        await dataSource.query(
          `INSERT INTO marketplace_order_items
              (order_id, external_item_id, variation_id, seller_sku, title, quantity, unit_price, currency_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            order.id,
            item.externalItemId,
            item.variationId ?? null,
            item.sellerSku,
            item.title,
            item.quantity,
            item.unitPrice,
            currencyId,
          ],
        );
      }
    }

    async function seedSuccessfulSyncRunFor(
      accountId: string,
      marketplace: Marketplace,
      dateFrom: Date,
      dateTo: Date,
    ): Promise<void> {
      await dataSource.query(
        `INSERT INTO sync_runs
            (marketplace_account_id, marketplace, type, status, started_at, finished_at, date_from, date_to)
          VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
        [
          accountId,
          marketplace,
          SyncRunType.MANUAL,
          SyncRunStatus.SUCCESS,
          new Date(),
          dateFrom,
          dateTo,
        ],
      );
    }

    it('1. Mercado Livre and Amazon coexist — both appear with their own numbers', async () => {
      const mlAccount = await seedAccount({
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedSuccessfulSyncRunFor(
        mlAccount,
        Marketplace.MERCADO_LIVRE,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedSuccessfulSyncRunFor(
        amazonAccount,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedOrder({
        accountId: mlAccount,
        externalOrderId: 'ml-1',
        status: 'paid',
        totalAmount: '100.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-ML',
            title: 'ML',
            quantity: 1,
            unitPrice: '100.00',
          },
        ],
      });
      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'amz-1',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        sourceStatus: 'SHIPPED',
        fulfillmentChannel: 'AMAZON',
        externalMarketplaceId: 'A2Q3Y263D00KWC',
        items: [
          {
            externalItemId: 'amz-item-1',
            sellerSku: 'SKU-AMZ',
            title: 'AMZ',
            quantity: 1,
            unitPrice: '50.00',
          },
        ],
      });

      const ml = await analyticsService.getAggregate(
        { accountId: mlAccount },
        REFERENCE_NOW,
      );
      const amazon = await analyticsService.getAggregate(
        { accountId: amazonAccount },
        REFERENCE_NOW,
      );

      expect(ml.current?.grossRevenueCents).toBe(10000n);
      expect(amazon.current?.grossRevenueCents).toBe(5000n);
    });

    it('2. ALL sums Mercado Livre and Amazon when both are in BRL', async () => {
      const mlAccount = await seedAccount({
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedSuccessfulSyncRunFor(
        mlAccount,
        Marketplace.MERCADO_LIVRE,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedSuccessfulSyncRunFor(
        amazonAccount,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedOrder({
        accountId: mlAccount,
        externalOrderId: 'ml-1',
        status: 'paid',
        totalAmount: '100.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-ML',
            title: 'ML',
            quantity: 1,
            unitPrice: '100.00',
          },
        ],
      });
      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'amz-1',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'amz-item-1',
            sellerSku: 'SKU-AMZ',
            title: 'AMZ',
            quantity: 1,
            unitPrice: '50.00',
          },
        ],
      });

      const all = await analyticsService.getAggregate({}, REFERENCE_NOW);
      expect(all.current?.grossRevenueCents).toBe(15000n);
      expect(all.current?.orders).toBe(2);
    });

    it('3. filtering by marketplace=AMAZON isolates Amazon data — Mercado Livre never leaks in', async () => {
      const mlAccount = await seedAccount({
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedSuccessfulSyncRunFor(
        mlAccount,
        Marketplace.MERCADO_LIVRE,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedSuccessfulSyncRunFor(
        amazonAccount,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedOrder({
        accountId: mlAccount,
        externalOrderId: 'ml-1',
        status: 'paid',
        totalAmount: '999.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-ML',
            title: 'ML',
            quantity: 1,
            unitPrice: '999.00',
          },
        ],
      });
      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'amz-1',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'amz-item-1',
            sellerSku: 'SKU-AMZ',
            title: 'AMZ',
            quantity: 1,
            unitPrice: '50.00',
          },
        ],
      });

      const amazonOnly = await analyticsService.getAggregate(
        { marketplace: 'AMAZON' },
        REFERENCE_NOW,
      );
      expect(amazonOnly.current?.grossRevenueCents).toBe(5000n);
      expect(amazonOnly.current?.orders).toBe(1);
    });

    it('4. filtering by accountId isolates one Amazon account from another', async () => {
      const amazonA = await seedAccount({
        marketplace: Marketplace.AMAZON,
        externalSellerId: 'AMZ-A',
      });
      const amazonB = await seedAccount({
        marketplace: Marketplace.AMAZON,
        externalSellerId: 'AMZ-B',
      });
      await seedSuccessfulSyncRunFor(
        amazonA,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedSuccessfulSyncRunFor(
        amazonB,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedOrderExtended({
        accountId: amazonA,
        externalOrderId: 'a-1',
        status: 'paid',
        totalAmount: '70.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'a-item',
            sellerSku: 'SKU-A',
            title: 'A',
            quantity: 1,
            unitPrice: '70.00',
          },
        ],
      });
      await seedOrderExtended({
        accountId: amazonB,
        externalOrderId: 'b-1',
        status: 'paid',
        totalAmount: '30.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'b-item',
            sellerSku: 'SKU-B',
            title: 'B',
            quantity: 1,
            unitPrice: '30.00',
          },
        ],
      });

      const scopedToA = await analyticsService.getAggregate(
        { accountId: amazonA },
        REFERENCE_NOW,
      );
      expect(scopedToA.current?.grossRevenueCents).toBe(7000n);
      expect(scopedToA.current?.orders).toBe(1);
    });

    it('5. FBA (fulfillmentChannel=AMAZON) and FBM (MERCHANT) are both preserved in persistence and readable back', async () => {
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'fba-1',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        fulfillmentChannel: 'AMAZON',
        items: [
          {
            externalItemId: 'i1',
            sellerSku: 'S1',
            title: 'X',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });
      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'fbm-1',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        fulfillmentChannel: 'MERCHANT',
        items: [
          {
            externalItemId: 'i2',
            sellerSku: 'S2',
            title: 'Y',
            quantity: 1,
            unitPrice: '10.00',
          },
        ],
      });

      const rows = await dataSource.query<
        Array<{ external_order_id: string; fulfillment_channel: string }>
      >(
        'SELECT external_order_id, fulfillment_channel FROM marketplace_orders WHERE marketplace_account_id = $1 ORDER BY external_order_id',
        [amazonAccount],
      );
      expect(rows).toEqual([
        { external_order_id: 'fba-1', fulfillment_channel: 'AMAZON' },
        { external_order_id: 'fbm-1', fulfillment_channel: 'MERCHANT' },
      ]);
    });

    it('6. a pending order never enters the revenue/paid-orders totals', async () => {
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedSuccessfulSyncRunFor(
        amazonAccount,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'pending-1',
        status: 'pending',
        totalAmount: '999.00',
        dateCreated: IN_CURRENT,
        sourceStatus: 'PENDING',
        items: [
          {
            externalItemId: 'i1',
            sellerSku: 'S1',
            title: 'X',
            quantity: 1,
            unitPrice: '999.00',
          },
        ],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId: amazonAccount },
        REFERENCE_NOW,
      );
      expect(aggregate.current?.grossRevenueCents).toBe(0n);
      expect(aggregate.current?.orders).toBe(0);
    });

    it('7. a cancelled order enters only the cancellation indicator, never revenue', async () => {
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedSuccessfulSyncRunFor(
        amazonAccount,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );
      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'cancelled-1',
        status: 'cancelled',
        totalAmount: '0.00',
        dateCreated: IN_CURRENT,
        sourceStatus: 'CANCELLED',
        items: [
          {
            externalItemId: 'i1',
            sellerSku: 'S1',
            title: 'X',
            quantity: 1,
            unitPrice: '0.00',
          },
        ],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId: amazonAccount },
        REFERENCE_NOW,
      );
      expect(aggregate.current?.grossRevenueCents).toBe(0n);
      expect(aggregate.current?.orders).toBe(0);
      expect(aggregate.current?.cancelledOrders).toBe(1);
    });

    it('8. a CONNECTED Amazon account without any data never fabricates a zero summary', async () => {
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
        status: MarketplaceAccountStatus.CONNECTED,
      });
      const aggregate = await analyticsService.getAggregate(
        { accountId: amazonAccount },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);
      expect(dto.availability).toBe('CONNECTED_NO_DATA');
      expect(dto.summary).toBeNull();
    });

    it('9. persisting Amazon orders never alters any Mercado Livre record', async () => {
      const mlAccount = await seedAccount({
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedOrder({
        accountId: mlAccount,
        externalOrderId: 'ml-1',
        status: 'paid',
        totalAmount: '100.00',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-ML',
            title: 'ML',
            quantity: 1,
            unitPrice: '100.00',
          },
        ],
      });
      const [before] = await dataSource.query<
        Array<{ status: string; total_amount: string }>
      >(
        'SELECT status, total_amount FROM marketplace_orders WHERE marketplace_account_id = $1',
        [mlAccount],
      );

      await seedOrderExtended({
        accountId: amazonAccount,
        externalOrderId: 'amz-1',
        status: 'paid',
        totalAmount: '999.99',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'amz-item-1',
            sellerSku: 'SKU-AMZ',
            title: 'AMZ',
            quantity: 1,
            unitPrice: '999.99',
          },
        ],
      });

      const [after] = await dataSource.query<
        Array<{ status: string; total_amount: string }>
      >(
        'SELECT status, total_amount FROM marketplace_orders WHERE marketplace_account_id = $1',
        [mlAccount],
      );
      expect(after).toEqual(before);
    });

    it('10. incompatible currencies in the same scope are never silently summed — the aggregate throws instead', async () => {
      const amazonA = await seedAccount({
        marketplace: Marketplace.AMAZON,
        externalSellerId: 'AMZ-A',
      });
      const amazonB = await seedAccount({
        marketplace: Marketplace.AMAZON,
        externalSellerId: 'AMZ-B',
      });
      await seedOrderExtended({
        accountId: amazonA,
        externalOrderId: 'a-1',
        status: 'paid',
        totalAmount: '100.00',
        currencyId: 'BRL',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'a-item',
            sellerSku: 'SKU-A',
            title: 'A',
            quantity: 1,
            unitPrice: '100.00',
          },
        ],
      });
      await seedOrderExtended({
        accountId: amazonB,
        externalOrderId: 'b-1',
        status: 'paid',
        totalAmount: '100.00',
        currencyId: 'USD',
        dateCreated: IN_CURRENT,
        items: [
          {
            externalItemId: 'b-item',
            sellerSku: 'SKU-B',
            title: 'B',
            quantity: 1,
            unitPrice: '100.00',
          },
        ],
      });

      await expect(
        analyticsService.getAggregate({ marketplace: 'AMAZON' }, REFERENCE_NOW),
      ).rejects.toThrow('CURRENCY_MISMATCH');
    });

    it('11. the same ASIN/SKU sold in two different orders consolidates into a single topListings entry, with units and revenue summed (Correção 5)', async () => {
      const amazonAccount = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedSuccessfulSyncRunFor(
        amazonAccount,
        Marketplace.AMAZON,
        new Date('2026-07-01T00:00:00.000Z'),
        new Date('2026-09-02T00:00:00.000Z'),
      );

      function sameListingOrder(input: {
        orderId: string;
        orderItemId: string;
      }): RawAmazonOrder {
        return {
          orderId: input.orderId,
          createdTime: IN_CURRENT.toISOString(),
          lastUpdatedTime: IN_CURRENT.toISOString(),
          marketplaceId: 'A2Q3Y263D00KWC',
          fulfillmentStatus: 'SHIPPED',
          fulfilledBy: 'AMAZON',
          grandTotal: { amount: '100.00', currencyCode: 'BRL' },
          items: [
            {
              // `orderItemId` é DIFERENTE em cada pedido — a identidade do
              // anúncio nunca pode depender dele (Checkpoint 4-B-R1,
              // "Correção 5"): o mesmo ASIN/SKU precisa consolidar.
              orderItemId: input.orderItemId,
              quantityOrdered: 2,
              asin: 'B0SAMEASIN01',
              sellerSku: 'SKU-SAME',
              title: 'Produto Consolidado',
              unitPrice: null,
              itemSubtotal: { amount: '100.00', currencyCode: 'BRL' },
            },
          ],
        };
      }

      const persistence = new MarketplaceOrdersPersistenceService(dataSource);
      const mappedA = mapAmazonOrder(
        amazonAccount,
        sameListingOrder({ orderId: 'amz-order-a', orderItemId: 'item-a' }),
        ['A2Q3Y263D00KWC'],
      );
      const mappedB = mapAmazonOrder(
        amazonAccount,
        sameListingOrder({ orderId: 'amz-order-b', orderItemId: 'item-b' }),
        ['A2Q3Y263D00KWC'],
      );
      await persistence.persistOrders([mappedA, mappedB]);

      const aggregate = await analyticsService.getAggregate(
        { accountId: amazonAccount },
        REFERENCE_NOW,
      );

      const listingsForThisAccount = aggregate.topListings.filter(
        (listing) => listing.accountId === amazonAccount,
      );
      expect(listingsForThisAccount).toHaveLength(1);
      expect(listingsForThisAccount[0].externalItemId).toBe('B0SAMEASIN01');
      expect(listingsForThisAccount[0].variationId).toBe('SKU-SAME');
      // Cada pedido: quantidade 2 × unitário 50.00 (subtotal 100.00 / 2) —
      // dois pedidos somam 4 unidades e 200.00 (20000 centavos).
      expect(listingsForThisAccount[0].units).toBe(4);
      expect(listingsForThisAccount[0].grossRevenueCents).toBe(20000n);
    });
  });

  describe('allTime ("Todo o período", Fase 4)', () => {
    it('the default (non-allTime) 30-day window never sees an order from years ago — sanity baseline', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'old-1',
        status: 'paid',
        totalAmount: '500.00',
        dateCreated: new Date('2020-01-15T12:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate({}, REFERENCE_NOW);
      expect(aggregate.current?.orders ?? 0).toBe(0);
    });

    it('allTime=true includes an order from years ago, far outside any default/custom window cap', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'old-1',
        status: 'paid',
        totalAmount: '500.00',
        dateCreated: new Date('2020-01-15T12:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { allTime: true },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.summary?.orders).toBe(1);
      expect(dto.summary?.grossRevenue).toBe('500.00');
    });

    it('allTime=true never computes a comparison — comparison and previous are always null', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'old-1',
        status: 'paid',
        totalAmount: '500.00',
        dateCreated: new Date('2020-01-15T12:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { allTime: true },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(aggregate.previous).toBeNull();
      expect(dto.comparison).toBeNull();
      expect(dto.scope.allTime).toBe(true);
    });

    it("allTime=true scoped by accountId isolates that account's full history from another account's", async () => {
      const accountA = await seedAccount({ externalSellerId: 'A' });
      const accountB = await seedAccount({ externalSellerId: 'B' });
      await seedOrder({
        accountId: accountA,
        externalOrderId: 'a-old',
        status: 'paid',
        totalAmount: '100.00',
        dateCreated: new Date('2019-06-01T00:00:00.000Z'),
        items: [],
      });
      await seedOrder({
        accountId: accountB,
        externalOrderId: 'b-old',
        status: 'paid',
        totalAmount: '999.00',
        dateCreated: new Date('2018-01-01T00:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { allTime: true, accountId: accountA },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.summary?.orders).toBe(1);
      expect(dto.summary?.grossRevenue).toBe('100.00');
    });

    it('allTime=true scoped by marketplace=MERCADO_LIVRE excludes an old Amazon order', async () => {
      const mlAccountId = await seedAccount({
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const amazonAccountId = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedOrder({
        accountId: mlAccountId,
        externalOrderId: 'ml-old',
        status: 'paid',
        totalAmount: '70.00',
        dateCreated: new Date('2021-03-01T00:00:00.000Z'),
        items: [],
      });
      await seedOrder({
        accountId: amazonAccountId,
        externalOrderId: 'amz-old',
        status: 'paid',
        totalAmount: '999.00',
        dateCreated: new Date('2021-03-01T00:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { allTime: true, marketplace: 'MERCADO_LIVRE' },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.summary?.orders).toBe(1);
      expect(dto.summary?.grossRevenue).toBe('70.00');
    });

    it('allTime=true with ALL marketplaces sums every scoped account with data', async () => {
      const mlAccountId = await seedAccount({
        marketplace: Marketplace.MERCADO_LIVRE,
      });
      const amazonAccountId = await seedAccount({
        marketplace: Marketplace.AMAZON,
      });
      await seedOrder({
        accountId: mlAccountId,
        externalOrderId: 'ml-old',
        status: 'paid',
        totalAmount: '70.00',
        dateCreated: new Date('2021-03-01T00:00:00.000Z'),
        items: [],
      });
      await seedOrder({
        accountId: amazonAccountId,
        externalOrderId: 'amz-old',
        status: 'paid',
        totalAmount: '30.00',
        dateCreated: new Date('2021-03-01T00:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { allTime: true },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.summary?.grossRevenue).toBe('100.00');
    });

    it('never reports coverage as complete when no sync_runs prove the all-time window was fully synced', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'old-1',
        status: 'paid',
        totalAmount: '500.00',
        dateCreated: new Date('2020-01-15T12:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { allTime: true },
        REFERENCE_NOW,
      );

      // Nenhum sync_run SUCCESS foi semeado neste teste — cobertura nunca
      // pode ser 'complete' sem prova real de sincronização.
      expect(aggregate.dataCoverage.status).not.toBe('complete');
    });

    it('a custom (non-allTime) period longer than the old ~1-year cap is no longer rejected', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'two-years-ago',
        status: 'paid',
        totalAmount: '42.00',
        dateCreated: new Date('2024-09-01T12:00:00.000Z'),
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { from: '2024-09-01', to: '2026-09-01' },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.summary?.orders).toBe(1);
      expect(dto.summary?.grossRevenue).toBe('42.00');
    });
  });

  describe('Mercado Livre Full (Fase 4)', () => {
    it('a paid Full order counts in full.summary — a non-Full paid order never leaks in', async () => {
      const accountId = await seedAccount({ externalSellerId: '111' });
      await seedOrder({
        accountId,
        externalOrderId: 'full-1',
        status: 'paid',
        totalAmount: '200.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-FULL',
            title: 'Produto Full',
            quantity: 2,
            unitPrice: '100.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: 'seller-1',
        status: 'paid',
        totalAmount: '80.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'SELLER_FULFILLED',
        items: [
          {
            externalItemId: 'MLB2',
            sellerSku: 'SKU-SELLER',
            title: 'Produto Seller',
            quantity: 1,
            unitPrice: '80.00',
          },
        ],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.full?.summary?.paidOrders).toBe(1);
      expect(dto.full?.summary?.paidRevenue).toBe('200.00');
      expect(dto.full?.summary?.paidUnits).toBe(2);
      // Faturamento pago total no escopo é 280.00 (200 Full + 80 Seller) —
      // participação do Full = 200/280.
      expect(dto.full?.summary?.shareOfPaidRevenuePct).toBeCloseTo(71.4, 1);
    });

    it('a cancelled Full order with a valid amount counts in cancellations, never in paid totals', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'full-cancelled',
        status: 'cancelled',
        totalAmount: '150.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-1',
            title: 'Produto',
            quantity: 1,
            unitPrice: '150.00',
          },
        ],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.full?.summary?.paidOrders).toBe(0);
      expect(dto.full?.summary?.cancelledOrders).toBe(1);
      expect(dto.full?.summary?.cancelledUnits).toBe(1);
      expect(dto.full?.summary?.cancelledRevenue).toBe('150.00');
      expect(dto.full?.summary?.grossSalesOrders).toBe(1);
      expect(dto.full?.summary?.grossSalesRevenue).toBe('150.00');
    });

    it('a non-Full order (SELLER_FULFILLED) never appears in full.summary at all', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'seller-only',
        status: 'paid',
        totalAmount: '90.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'SELLER_FULFILLED',
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-1',
            title: 'Produto',
            quantity: 1,
            unitPrice: '90.00',
          },
        ],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      // Nenhum pedido Full no escopo — nunca mostra zero como se fosse dado
      // completo, `summary` sai `null`.
      expect(dto.full?.summary).toBeNull();
      expect(dto.full?.classifiedOrders).toBe(1);
      expect(dto.full?.unclassifiedOrders).toBe(0);
      expect(dto.full?.coverage).toBe('complete');
    });

    it('an UNKNOWN order counts toward unclassifiedOrders and drives coverage to "partial"', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'full-1',
        status: 'paid',
        totalAmount: '100.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [],
      });
      await seedOrder({
        accountId,
        externalOrderId: 'unknown-1',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'UNKNOWN',
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.full?.classifiedOrders).toBe(1);
      expect(dto.full?.unclassifiedOrders).toBe(1);
      expect(dto.full?.coverage).toBe('partial');
    });

    it('is null when the account has no proven data at all (mirrors the root summary/current rule)', async () => {
      const accountId = await seedAccount();
      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.summary).toBeNull();
      expect(dto.full).toBeNull();
    });

    it('consolidates two Mercado Livre accounts (Meli 1 + Meli 2) into a single Full total', async () => {
      const accountA = await seedAccount({ externalSellerId: '111' });
      const accountB = await seedAccount({ externalSellerId: '222' });
      await seedOrder({
        accountId: accountA,
        externalOrderId: 'a-1',
        status: 'paid',
        totalAmount: '100.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [
          {
            externalItemId: 'MLA1',
            sellerSku: 'SKU-1',
            title: 'Produto',
            quantity: 1,
            unitPrice: '100.00',
          },
        ],
      });
      await seedOrder({
        accountId: accountB,
        externalOrderId: 'b-1',
        status: 'paid',
        totalAmount: '60.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [
          {
            externalItemId: 'MLB1',
            sellerSku: 'SKU-1',
            title: 'Produto',
            quantity: 1,
            unitPrice: '60.00',
          },
        ],
      });

      const aggregateA = await analyticsService.getAggregate(
        { accountId: accountA },
        REFERENCE_NOW,
      );
      const aggregateB = await analyticsService.getAggregate(
        { accountId: accountB },
        REFERENCE_NOW,
      );
      const aggregateAll = await analyticsService.getAggregate(
        { marketplace: 'MERCADO_LIVRE' },
        REFERENCE_NOW,
      );

      const dtoA = toMarketplaceAnalyticsResponse(aggregateA);
      const dtoB = toMarketplaceAnalyticsResponse(aggregateB);
      const dtoAll = toMarketplaceAnalyticsResponse(aggregateAll);

      expect(dtoA.full?.summary?.paidRevenue).toBe('100.00');
      expect(dtoB.full?.summary?.paidRevenue).toBe('60.00');
      expect(dtoAll.full?.summary?.paidRevenue).toBe('160.00');
      // Ranking consolidado funde o mesmo SKU entre as duas contas.
      expect(dtoAll.full?.ranking).toHaveLength(1);
      expect(dtoAll.full?.ranking[0].orders).toBe(2);
      expect(dtoAll.full?.ranking[0].units).toBe(2);
    });

    it('the same SKU listed under two different item ids still consolidates into one ranking row', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'r-1',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [
          {
            externalItemId: 'MLB-VARIANT-A',
            sellerSku: 'SKU-SAME',
            title: 'Produto (anúncio A)',
            quantity: 1,
            unitPrice: '50.00',
          },
        ],
      });
      await seedOrder({
        accountId,
        externalOrderId: 'r-2',
        status: 'paid',
        totalAmount: '50.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [
          {
            externalItemId: 'MLB-VARIANT-B',
            sellerSku: 'sku-same',
            title: 'Produto (anúncio B)',
            quantity: 1,
            unitPrice: '50.00',
          },
        ],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.full?.ranking).toHaveLength(1);
      expect(dto.full?.ranking[0].distinctListings).toBe(2);
      expect(dto.full?.ranking[0].orders).toBe(2);
      expect(dto.full?.ranking[0].units).toBe(2);
    });

    it('never divides by zero — shareOfPaidRevenuePct/unitsSharePct are 0 when the denominator is 0', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'full-only-cancelled',
        status: 'cancelled',
        totalAmount: '0.00',
        dateCreated: IN_CURRENT,
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      // Cancelado com valor 0 nunca entra em vendas brutas (regra existente
      // de "vendas brutas") — mas o pedido cancelado em si é real e aparece
      // em cancelledOrders/cancelledRevenue; sem nenhum pedido pago, as
      // participações percentuais nunca dividem por zero.
      expect(dto.full?.summary?.cancelledOrders).toBe(1);
      expect(dto.full?.summary?.grossSalesOrders).toBe(0);
      expect(dto.full?.summary?.paidOrders).toBe(0);
      expect(dto.full?.summary?.shareOfPaidRevenuePct).toBe(0);
      expect(dto.full?.summary?.shareOfPaidUnitsPct).toBe(0);
    });

    it('respects the selected period — an order outside the window never leaks into full totals', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'outside-window',
        status: 'paid',
        totalAmount: '999.00',
        dateCreated: new Date('2020-01-01T00:00:00.000Z'),
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.full?.summary).toBeNull();
      expect(dto.full?.coverage).toBe('unknown');
    });

    it('"Todo o período" (allTime) includes the Full order regardless of date and never computes a comparison', async () => {
      const accountId = await seedAccount();
      await seedOrder({
        accountId,
        externalOrderId: 'old-full',
        status: 'paid',
        totalAmount: '77.00',
        dateCreated: new Date('2020-01-01T00:00:00.000Z'),
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { allTime: true, accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.full?.summary?.paidRevenue).toBe('77.00');
      expect(dto.full?.comparison).toBeNull();
    });

    it('is structurally present (never undefined) even for an Amazon-only scope with no Full concept', async () => {
      const accountId = await seedAccount({ marketplace: Marketplace.AMAZON });
      await seedOrder({
        accountId,
        externalOrderId: 'amz-1',
        status: 'paid',
        totalAmount: '10.00',
        dateCreated: IN_CURRENT,
        items: [],
      });

      const aggregate = await analyticsService.getAggregate(
        { accountId },
        REFERENCE_NOW,
      );
      const dto = toMarketplaceAnalyticsResponse(aggregate);

      expect(dto.full).not.toBeNull();
      expect(dto.full?.coverage).toBe('unknown');
      expect(dto.full?.summary).toBeNull();
    });
  });
});
