import { randomUUID } from 'crypto';
import { Workbook } from 'exceljs';
import { DataSource, type QueryRunner } from 'typeorm';
import { createTestDataSource } from '../test-utils/create-test-data-source';
import { createTestEncryptionService } from '../test-utils/create-test-encryption-service';
import { Marketplace } from '../integrations/contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../integrations/marketplace-accounts/marketplace-account.entity';
import { CustomersExportService } from './customers-export.service';
import { parseCustomersFilter } from './customers-query';
import {
  CustomersRepository,
  EXPORT_BUYERS_BATCH_SIZE,
  EXPORT_DETAILS_BATCH_SIZE,
} from './customers.repository';
import { CustomersService } from './customers.service';

const NOW = new Date('2026-09-25T15:00:00.000Z');
const BUYERS = 1203;
const ITEMS_PER_ORDER = 2;
const TIMEOUT_MS = 60_000;

interface RecordedQuery {
  sql: string;
  rows: number;
}

/**
 * Prova de memória limitada da exportação: volume maior que os lotes,
 * leitura exclusivamente por `FETCH <lote>` de cursor do servidor e nenhuma
 * consulta devolvendo mais linhas que um lote.
 */
describe('Exportação de clientes em streaming (Postgres real)', () => {
  let dataSource: DataSource;
  let exportService: CustomersExportService;
  let recorded: RecordedQuery[];
  let runners: QueryRunner[];

  beforeAll(async () => {
    dataSource = await createTestDataSource([MarketplaceAccount]);
    for (const table of [
      'customer_export_audits',
      'marketplace_order_items',
      'marketplace_orders',
      'marketplace_buyers',
      'marketplace_accounts',
    ]) {
      await dataSource.query(`TRUNCATE TABLE ${table} CASCADE`);
    }
    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: 'volume',
      nickname: 'ML-VOLUME',
      status: MarketplaceAccountStatus.CONNECTED,
      tokenVersion: 1,
    });
    await dataSource.query(
      `INSERT INTO marketplace_buyers (marketplace_account_id, external_buyer_id, data_source, username)
       SELECT $1, 'B' || g, 'MERCADO_LIVRE_ORDERS', 'user' || g
         FROM generate_series(1, $2::int) g`,
      [account.id, BUYERS],
    );
    await dataSource.query(
      `INSERT INTO marketplace_orders (marketplace_account_id, external_order_id, status,
              currency_id, total_amount, date_created, marketplace_buyer_id)
       SELECT $1, 'O' || b.external_buyer_id, 'paid', 'BRL', 10,
              timestamptz '2026-01-01' + (substr(b.external_buyer_id, 2)::int || ' minutes')::interval,
              b.id
         FROM marketplace_buyers b`,
      [account.id],
    );
    await dataSource.query(
      `INSERT INTO marketplace_order_items (order_id, external_item_id, title, quantity, unit_price, currency_id)
       SELECT o.id, 'MLB' || g, 'Produto ' || g, 1, 5, 'BRL'
         FROM marketplace_orders o, generate_series(1, $1::int) g`,
      [ITEMS_PER_ORDER],
    );

    const repository = new CustomersRepository(dataSource);
    exportService = new CustomersExportService(
      repository,
      new CustomersService(repository, createTestEncryptionService(), {
        findById: jest.fn(),
      } as never),
    );

    // Registra TODA consulta feita pelos query runners da exportação.
    const original = dataSource.createQueryRunner.bind(dataSource);
    jest.spyOn(dataSource, 'createQueryRunner').mockImplementation(() => {
      const runner = original();
      const query = runner.query.bind(runner);
      runner.query = (async (sql: string, params?: unknown[]) => {
        const result: unknown = await query(sql, params);
        recorded.push({
          sql,
          rows: Array.isArray(result) ? result.length : 0,
        });
        return result;
      }) as typeof runner.query;
      runners.push(runner);
      return runner;
    });
  }, TIMEOUT_MS);

  beforeEach(() => {
    recorded = [];
    runners = [];
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await dataSource.destroy();
  });

  const filter = () => parseCustomersFilter({}, NOW);

  it(
    'reads buyers and item rows only through bounded FETCH batches and writes every row',
    async () => {
      const file = await exportService.export(
        filter(),
        true,
        randomUUID(),
        NOW,
      );
      let fetchesBeforeFirstByte: number | null = null;
      const chunks: Buffer[] = [];
      for await (const chunk of file.stream) {
        fetchesBeforeFirstByte ??= recorded.filter((q) =>
          q.sql.startsWith('FETCH'),
        ).length;
        chunks.push(chunk as Buffer);
      }
      await file.done;

      const buyerFetches = recorded.filter((q) =>
        q.sql.includes('FROM customers_export_buyers'),
      );
      const detailFetches = recorded.filter((q) =>
        q.sql.includes('FROM customers_export_details'),
      );
      const detailRows = BUYERS * ITEMS_PER_ORDER;
      expect(buyerFetches.map((q) => q.rows)).toEqual([500, 500, 203, 0]);
      expect(detailFetches.map((q) => q.rows)).toEqual([1000, 1000, 406, 0]);
      expect(new Set(buyerFetches.map((q) => q.sql))).toEqual(
        new Set([
          `FETCH ${EXPORT_BUYERS_BATCH_SIZE} FROM customers_export_buyers`,
        ]),
      );
      expect(new Set(detailFetches.map((q) => q.sql))).toEqual(
        new Set([
          `FETCH ${EXPORT_DETAILS_BATCH_SIZE} FROM customers_export_details`,
        ]),
      );

      // Nenhuma consulta (FETCH, produto mais comprado, cobertura) trouxe mais
      // linhas que um lote; nada de SELECT ilimitado sobre compradores/itens.
      expect(Math.max(...recorded.map((q) => q.rows))).toBeLessThanOrEqual(
        Math.max(EXPORT_BUYERS_BATCH_SIZE, EXPORT_DETAILS_BATCH_SIZE),
      );
      const directReads = recorded.filter(
        (q) =>
          /^\s*(WITH|SELECT)/i.test(q.sql) &&
          !q.sql.includes('ANY($5::uuid[])'),
      );
      // Só a consulta de cobertura (uma linha por conta) lê fora de cursor/lote.
      expect(directReads).toHaveLength(1);
      expect(directReads[0].sql).toContain('orders_with_buyer');

      // Os primeiros bytes saem antes de o banco terminar de ser lido.
      expect(fetchesBeforeFirstByte).not.toBeNull();
      expect(fetchesBeforeFirstByte!).toBeLessThan(
        buyerFetches.length + detailFetches.length,
      );

      const workbook = new Workbook();
      await workbook.xlsx.load(Buffer.concat(chunks) as never);
      expect(workbook.getWorksheet('Resumo de clientes')!.rowCount).toBe(
        1 + BUYERS,
      );
      expect(workbook.getWorksheet('Compras detalhadas')!.rowCount).toBe(
        1 + detailRows,
      );
      expect(runners.every((runner) => runner.isReleased)).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'client abort stops reading, releases the connection and leaves the audit incomplete',
    async () => {
      const abort = new AbortController();
      const file = await exportService.export(
        filter(),
        true,
        randomUUID(),
        NOW,
        abort.signal,
      );
      // Cliente lê um pedaço e desiste.
      file.stream.once('data', () => abort.abort());
      file.stream.on('error', () => undefined);
      file.stream.resume();
      await file.done;

      const detailFetches = recorded.filter((q) =>
        q.sql.includes('FROM customers_export_details'),
      );
      expect(detailFetches.length).toBeLessThan(4);
      expect(runners.every((runner) => runner.isReleased)).toBe(true);
      expect(file.stream.destroyed).toBe(true);
      const [audit] = await dataSource.query<
        Array<{ completed_at: Date | null; buyers_count: number | null }>
      >(
        `SELECT completed_at, buyers_count FROM customer_export_audits
        ORDER BY exported_at DESC LIMIT 1`,
      );
      expect(audit).toEqual({ completed_at: null, buyers_count: null });
    },
    TIMEOUT_MS,
  );
});
