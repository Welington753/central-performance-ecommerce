import { randomUUID } from 'crypto';
import { Workbook } from 'exceljs';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { createTestEncryptionService } from '../test-utils/create-test-encryption-service';
import { SyncRun } from '../sync/sync-run.entity';
import { Marketplace } from '../integrations/contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../integrations/marketplace-accounts/marketplace-account.entity';
import type { MappedBuyerRecord } from '../integrations/marketplace-orders/buyer-snapshot';
import type {
  MappedOrderItemRecord,
  MappedOrderRecord,
} from '../integrations/marketplace-orders/mapped-order-record';
import { MarketplaceBuyer } from '../integrations/marketplace-orders/marketplace-buyer.entity';
import { MarketplaceOrder } from '../integrations/marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../integrations/marketplace-orders/marketplace-order-item.entity';
import { MarketplaceOrdersPersistenceService } from '../integrations/marketplace-orders/marketplace-orders-persistence.service';
import { CustomersExportService } from './customers-export.service';
import { parseCustomersFilter } from './customers-query';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

const NOW = new Date('2026-09-25T15:00:00.000Z');

function item(
  externalItemId: string,
  sellerSku: string,
  quantity: number,
  unitPrice: string,
): MappedOrderItemRecord {
  return {
    externalItemId,
    variationId: null,
    sellerSku,
    title: `Produto ${sellerSku}`,
    quantity,
    unitPrice,
    currencyId: 'BRL',
  };
}

function buyer(overrides: Partial<MappedBuyerRecord> = {}): MappedBuyerRecord {
  return {
    externalBuyerId: '999',
    dataSource: 'MERCADO_LIVRE_ORDERS',
    username: 'NICK',
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
  externalOrderId: string,
  date: string,
  overrides: Partial<MappedOrderRecord>,
): MappedOrderRecord {
  return {
    marketplaceAccountId: accountId,
    externalOrderId,
    status: 'paid',
    currencyId: 'BRL',
    totalAmount: '0.00',
    packId: null,
    dateCreated: new Date(date),
    dateClosed: null,
    marketplaceLastUpdated: new Date(date),
    items: [],
    ...overrides,
  };
}

describe('CustomersService + export (Postgres real)', () => {
  let dataSource: DataSource;
  let service: CustomersService;
  let exportService: CustomersExportService;
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
    const encryption = createTestEncryptionService();
    const persistence = new MarketplaceOrdersPersistenceService(
      dataSource,
      encryption,
    );
    service = new CustomersService(
      new CustomersRepository(dataSource),
      encryption,
      { findById: jest.fn() } as never,
    );
    exportService = new CustomersExportService(
      new CustomersRepository(dataSource),
      service,
    );

    for (const table of [
      'customer_export_audits',
      'marketplace_order_items',
      'marketplace_orders',
      'marketplace_buyers',
      'marketplace_accounts',
    ]) {
      await dataSource.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
    const repo = dataSource.getRepository(MarketplaceAccount);
    const create = async (marketplace: Marketplace, nickname: string) =>
      (
        await repo.save({
          id: randomUUID(),
          marketplace,
          externalSellerId: nickname,
          nickname,
          status: MarketplaceAccountStatus.CONNECTED,
          tokenVersion: 1,
        })
      ).id;
    ml1 = await create(Marketplace.MERCADO_LIVRE, 'ML1');
    ml2 = await create(Marketplace.MERCADO_LIVRE, 'ML2');
    shopee = await create(Marketplace.SHOPEE, 'Shopee');

    const maria = buyer({ buyerName: 'Maria Silva', email: 'maria@x.com' });
    await persistence.persistOrders([
      order(ml1, 'A', '2026-08-01T12:00:00.000Z', {
        totalAmount: '100.00',
        refundedAmount: '10.00',
        logisticsClassification: 'MARKETPLACE_FULFILLED',
        buyer: maria,
        items: [
          item('MLB1', 'SKU-1', 2, '30.00'),
          item('MLB2', 'SKU-2', 1, '40.00'),
        ],
      }),
      order(ml1, 'B', '2026-08-10T12:00:00.000Z', {
        totalAmount: '50.00',
        buyer: maria,
        items: [item('MLB2', 'SKU-2', 1, '50.00')],
      }),
      order(ml1, 'C', '2026-08-15T12:00:00.000Z', {
        status: 'cancelled',
        totalAmount: '70.00',
        buyer: maria,
        items: [item('MLB3', 'SKU-3', 5, '14.00')],
      }),
      order(ml1, 'SEM-COMPRADOR', '2026-08-16T12:00:00.000Z', {
        totalAmount: '10.00',
        items: [item('MLB9', 'SKU-9', 1, '10.00')],
      }),
      order(ml2, 'D', '2026-08-05T12:00:00.000Z', {
        totalAmount: '20.00',
        buyer: buyer(),
        items: [item('MLB1', 'SKU-1', 1, '20.00')],
      }),
      order(shopee, 'E', '2026-07-01T12:00:00.000Z', {
        totalAmount: '30.00',
        buyer: buyer({
          dataSource: 'SHOPEE_ORDER_DETAIL',
          username: '@shopee_user',
          recipientName: '=HYPERLINK("http://malicioso","x")',
          recipientPhone: '11987654321',
          city: 'São Paulo',
          state: 'SP',
          postalCode: '01310-100',
        }),
        // Textos que o Excel interpretaria como fórmula em SKU/produto/anúncio.
        items: [
          {
            ...item('@55501', '-SKU-S', 1, '30.00'),
            title: '+cmd|calc',
          },
        ],
      }),
    ]);
  });

  async function readExport(
    file: Awaited<ReturnType<CustomersExportService['export']>>,
  ): Promise<Workbook> {
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(chunk as Buffer);
    await file.done;
    const workbook = new Workbook();
    await workbook.xlsx.load(Buffer.concat(chunks) as never);
    return workbook;
  }

  function sheetRows(workbook: Workbook, name: string): unknown[][] {
    return workbook
      .getWorksheet(name)!
      .getSheetValues()
      .slice(2)
      .map((row) => (row as unknown[]).slice(1));
  }

  afterAll(async () => {
    await dataSource.destroy();
  });

  const filter = (query: Record<string, string> = {}) =>
    parseCustomersFilter(query, NOW);

  it('keeps ML1, ML2 and Shopee buyers with the same external id separated, computing cards with KPI semantics', async () => {
    const summary = await service.getSummary(filter(), {
      page: 1,
      pageSize: 25,
    });
    expect(summary.totalCustomers).toBe(3);
    expect(summary.period).toEqual({ allTime: true, from: null, to: null });
    expect(summary.cards).toEqual({
      identifiedCustomers: 3,
      customersWithValidPurchase: 3,
      recurringCustomers: 1,
      recurrenceRate: 0.3333,
      paidRevenue: '200.00',
      paidOrders: 4,
      averageTicket: '50.00',
      units: 6,
      buyerNameCoverage: 0.3333,
      recipientNameCoverage: 0.3333,
      emailCoverage: 0.3333,
      recipientPhoneCoverage: 0.3333,
    });
  });

  it('counts orders (never items), excludes cancelled from revenue/ticket, keeps refund N/D when unknown, and masks email/phone', async () => {
    const summary = await service.getSummary(filter(), {
      page: 1,
      pageSize: 25,
    });
    const byAccount = new Map(summary.customers.map((c) => [c.accountId, c]));
    expect(byAccount.get(ml1)).toMatchObject({
      validOrders: 2,
      totalOrders: 3,
      units: 4,
      paidRevenue: '150.00',
      refundedAmount: '10.00',
      averageTicket: '75.00',
      customerType: 'RECURRING',
      buyerName: 'Maria Silva',
      recipientName: null,
      emailMasked: 'ma***@x.com',
      recipientPhoneMasked: null,
      // Empate em 2 unidades (MLB1 x MLB2) → menor external_item_id.
      topProduct: { externalItemId: 'MLB1', units: 2 },
    });
    expect(byAccount.get(ml2)).toMatchObject({
      customerType: 'NEW',
      refundedAmount: null,
    });
    // Shopee: nome/telefone são do DESTINATÁRIO, nunca apresentados como do comprador.
    expect(byAccount.get(shopee)).toMatchObject({
      buyerName: null,
      recipientName: '=HYPERLINK("http://malicioso","x")',
      recipientPhoneMasked: '*******4321',
      city: 'São Paulo',
      state: 'SP',
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('maria@x.com');
    expect(serialized).not.toContain('11987654321');
    expect(serialized).not.toContain('01310-100');
  });

  it.each([
    [{ customerType: 'RECURRING' }, ['ML1']],
    [{ customerType: 'NEW' }, ['ML2', 'Shopee']],
    // Busca só em id externo/username; nome (criptografado) nunca é pesquisado.
    [{ search: 'shopee_u' }, ['Shopee']],
    [{ search: 'nick' }, ['ML1', 'ML2']],
    [{ search: 'maria' }, []],
    [{ search: '%' }, []],
    [{ product: 'SKU-3' }, ['ML1']],
    [{ onlyWithRecipientPhone: 'true' }, ['Shopee']],
    [{ onlyWithEmail: 'true' }, ['ML1']],
    [{ marketplace: 'SHOPEE' }, ['Shopee']],
  ])('filter %j → %j', async (query, expected) => {
    const summary = await service.getSummary(filter(query), {
      page: 1,
      pageSize: 25,
    });
    expect(summary.customers.map((c) => c.accountNickname).sort()).toEqual(
      expected,
    );
    expect(summary.totalCustomers).toBe(expected.length);
  });

  it('filters by account and period; the period changes recurrence', async () => {
    const byAccount = await service.getSummary(filter({ accountId: ml2 }), {
      page: 1,
      pageSize: 25,
    });
    expect(byAccount.customers.map((c) => c.accountId)).toEqual([ml2]);

    const period = await service.getSummary(
      filter({ from: '2026-08-09', to: '2026-08-20' }),
      { page: 1, pageSize: 25 },
    );
    expect(period.customers).toHaveLength(1);
    expect(period.customers[0]).toMatchObject({
      accountId: ml1,
      validOrders: 1,
      totalOrders: 2,
      customerType: 'NEW',
    });
  });

  it('paginates deterministically in the database, most recent purchase first', async () => {
    const first = await service.getSummary(filter(), { page: 1, pageSize: 2 });
    const second = await service.getSummary(filter(), { page: 2, pageSize: 2 });
    expect(first.totalPages).toBe(2);
    expect(first.totalCustomers).toBe(3);
    expect(first.customers.map((c) => c.accountNickname)).toEqual([
      'ML1',
      'ML2',
    ]);
    expect(second.customers.map((c) => c.accountNickname)).toEqual(['Shopee']);
  });

  it('lists a buyer order lines (one per item), including cancelled ones', async () => {
    const summary = await service.getSummary(filter({ accountId: ml1 }), {
      page: 1,
      pageSize: 25,
    });
    const lines = await service.getBuyerOrders(
      summary.customers[0].buyerId,
      filter(),
    );
    expect(lines.map((l) => l.externalOrderId)).toEqual(['A', 'A', 'B', 'C']);
    expect(lines[0].fulfillment).toBe('FULL');
    expect(lines[3].status).toBe('cancelled');
  });

  it('exports three sheets with numeric money, N/D for absences, formula-safe text and an audit row without personal data', async () => {
    // Busca que casa com os três (id externo "999") — só para provar que o
    // texto buscado nunca vai para a auditoria.
    const file = await exportService.export(
      filter({ search: '999' }),
      true,
      randomUUID(),
      NOW,
    );
    expect(file.filename).toBe(
      'clientes_todo-o-periodo_gerado-2026-09-25_1200.xlsx',
    );
    const workbook = await readExport(file);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Resumo de clientes',
      'Compras detalhadas',
      'Cobertura dos dados',
    ]);

    const summarySheet = workbook.getWorksheet('Resumo de clientes')!;
    expect(summarySheet.getRow(1).values).toEqual(
      expect.arrayContaining([
        'Nome do comprador',
        'Nome do destinatário',
        'Telefone do destinatário',
      ]),
    );
    const rows = sheetRows(workbook, 'Resumo de clientes');
    const ml1Row = rows.find((r) => r[1] === 'ML1')!;
    expect(ml1Row[4]).toBe('Maria Silva');
    expect(ml1Row[5]).toBe('N/D');
    expect(ml1Row[6]).toBe('maria@x.com');
    expect(ml1Row[15]).toBe(150);
    expect(typeof ml1Row[15]).toBe('number');
    expect(ml1Row[11]).toBeInstanceOf(Date);
    const ml2Row = rows.find((r) => r[1] === 'ML2')!;
    expect(ml2Row[16]).toBe('N/D');
    expect(ml2Row[7]).toBe('N/D');
    const shopeeRow = rows.find((r) => r[1] === 'Shopee')!;
    expect(shopeeRow[3]).toBe(`'@shopee_user`);
    expect(shopeeRow[4]).toBe('N/D');
    expect(shopeeRow[5]).toBe(`'=HYPERLINK("http://malicioso","x")`);
    expect(shopeeRow[7]).toBe('11987654321');
    expect(shopeeRow[19]).toBe(`'+cmd|calc`);
    expect(summarySheet.autoFilter).toBeDefined();
    expect(summarySheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

    expect(workbook.getWorksheet('Compras detalhadas')!.rowCount).toBe(1 + 6);
    const shopeeDetail = sheetRows(workbook, 'Compras detalhadas').find(
      (r) => r[1] === 'Shopee',
    )!;
    expect(shopeeDetail.slice(3, 10)).toEqual([
      `'@shopee_user`,
      'E',
      expect.any(Date),
      'paid',
      `'-SKU-S`,
      `'+cmd|calc`,
      `'@55501`,
    ]);
    // Nenhuma célula de texto de nenhuma aba começa com gatilho de fórmula.
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          if (typeof cell.value === 'string') {
            expect(cell.value).not.toMatch(/^[=+\-@\t\r]/);
          }
          expect(cell.formula).toBeUndefined();
        }),
      );
    }

    const coverage = sheetRows(workbook, 'Cobertura dos dados');
    const ml1Coverage = coverage.find((r) => r[1] === 'ML1')!;
    expect(ml1Coverage.slice(2, 5)).toEqual([4, 3, 1]);
    expect(ml1Coverage[15]).toBe(0.75);
    const shopeeCoverage = coverage.find((r) => r[1] === 'Shopee')!;
    // nome do comprador 0, nome do destinatário 1, e-mail 0, telefone do destinatário 1.
    expect(shopeeCoverage.slice(6, 10)).toEqual([0, 1, 0, 1]);
    expect(String(shopeeCoverage[14])).toContain('destinatário');

    const audits = await dataSource.query<
      Array<{
        filters: Record<string, unknown>;
        buyers_count: number;
        detail_rows_count: number;
        included_personal_data: boolean;
        completed_at: Date | null;
      }>
    >(`SELECT filters, buyers_count, detail_rows_count, included_personal_data,
              completed_at
         FROM customer_export_audits`);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      buyers_count: 3,
      detail_rows_count: 6,
      included_personal_data: true,
    });
    expect(audits[0].completed_at).toBeInstanceOf(Date);
    expect(audits[0].filters).toMatchObject({
      searchApplied: true,
      allTime: true,
    });
    const auditText = JSON.stringify(audits);
    expect(auditText).not.toContain('999');
    expect(auditText).not.toContain('maria');
    expect(auditText).not.toContain('11987654321');
  });

  it('without personal data permission flag, the export masks email/phone/CEP', async () => {
    const workbook = await readExport(
      await exportService.export(filter(), false, randomUUID(), NOW),
    );
    const rows = sheetRows(workbook, 'Resumo de clientes');
    expect(rows.find((r) => r[1] === 'ML1')![6]).toBe('ma***@x.com');
    const shopeeRow = rows.find((r) => r[1] === 'Shopee')!;
    expect(shopeeRow[7]).toBe('*******4321');
    expect(shopeeRow[10]).toBe('01***-***');
  });
});
