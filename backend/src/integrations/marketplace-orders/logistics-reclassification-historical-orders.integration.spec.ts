import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { LogisticsReclassificationSupport1789000000000 } from '../../database/migrations/1789000000000-logistics-reclassification-support';
import { Marketplace } from '../contracts/marketplace.enum';
import { LogisticsReclassificationRepository } from './logistics-reclassification.repository';

/**
 * Prova contra Postgres real (não uma fixture já preenchida com o campo
 * novo) do cenário levantado pela revisão crítica: a coluna
 * `external_shipment_id` foi adicionada DEPOIS que pedidos históricos já
 * existiam. Este teste reproduz o schema ANTERIOR à migration
 * 1789000000000 de verdade — via `migration.down(queryRunner)` real —,
 * insere um pedido `UNKNOWN` do jeito que o schema antigo permitia (sem
 * nenhuma coluna nova disponível para preencher), aplica a migration por
 * cima dele (`migration.up`) e só então roda a mesma consulta que o
 * `--plan` usa.
 *
 * Tudo roda dentro de UMA transação, revertida no final — nunca afeta o
 * schema real usado pelas outras suites (`maxWorkers: 1` garante que nenhum
 * outro teste roda em paralelo enquanto o DDL desta transação está ativo).
 */
describe('reclassificação — pedido histórico anterior à migration 1789000000000 (Postgres real)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await createTestDataSource([]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('pedido gravado no schema anterior fica com external_shipment_id ausente (nunca inventado) e --plan o classifica como NÃO elegível diretamente', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    const migration = new LogisticsReclassificationSupport1789000000000();

    try {
      // 1. Volta o schema desta transação ao estado ANTERIOR à migration.
      await migration.down(queryRunner);

      const columnsBefore = (await queryRunner.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'marketplace_orders'
            AND column_name = 'external_shipment_id'`,
      )) as Array<{ column_name: string }>;
      expect(columnsBefore).toHaveLength(0);

      // 2. Insere conta + pedido histórico REAL, só com as colunas que o
      // schema antigo tinha — nada de `external_shipment_id` para preencher.
      const accountId = randomUUID();
      await queryRunner.query(
        `INSERT INTO marketplace_accounts
            (id, marketplace, external_seller_id, nickname, status,
             token_version, refresh_failure_count, created_at, updated_at)
          VALUES ($1, 'MERCADO_LIVRE', '999', 'Conta histórica', 'CONNECTED',
                  1, 0, now(), now())`,
        [accountId],
      );
      const insertedOrders = (await queryRunner.query(
        `INSERT INTO marketplace_orders
            (marketplace_account_id, external_order_id, status, currency_id,
             total_amount, date_created, logistics_classification, updated_at)
          VALUES ($1, 'hist-1', 'paid', 'BRL', 100.00, now(), 'UNKNOWN', now())
          RETURNING id`,
        [accountId],
      )) as Array<{ id: string }>;
      const orderId = insertedOrders[0].id;
      expect(orderId).toBeTruthy();

      // 3. Aplica a migration por cima do pedido já existente — exatamente o
      // que acontece em produção quando o deploy roda a migration.
      await migration.up(queryRunner);

      // A coluna nasce presente, mas NULL para a linha preexistente: a
      // migration nunca inventa nem infere o shipping.id retroativamente.
      const rowsAfterMigration = (await queryRunner.query(
        'SELECT external_shipment_id FROM marketplace_orders WHERE id = $1',
        [orderId],
      )) as Array<{ external_shipment_id: string | null }>;
      const valueAfterMigration = rowsAfterMigration[0].external_shipment_id;
      expect(valueAfterMigration).toBeNull();

      // 4. Mesma consulta que o `--plan` roda, na MESMA transação — para
      // realmente ler o estado pós-migration que acabamos de criar.
      const repository = new LogisticsReclassificationRepository({
        query: (sql: string, params?: unknown[]) =>
          queryRunner.query(sql, params),
      } as unknown as DataSource);

      const [counts] = await repository.countPendingByAccount(
        Marketplace.MERCADO_LIVRE,
        accountId,
      );

      expect(counts.pendingWithoutShipmentId).toBe(1);
      expect(counts.pendingWithShipmentId).toBe(0);
      expect(counts.resolved).toBe(0);

      // 5. E o lote realmente processável (`--apply`) nunca inclui esse
      // pedido — `fetchPendingBatch` exige `external_shipment_id IS NOT NULL`.
      const batch = await repository.fetchPendingBatch({
        marketplaceAccountId: accountId,
        limit: 50,
        afterId: null,
      });
      expect(batch).toHaveLength(0);
    } finally {
      // Reverte TUDO (DDL incluído — Postgres tem DDL transacional): o
      // schema real, visto pelas outras suites, nunca é tocado.
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
