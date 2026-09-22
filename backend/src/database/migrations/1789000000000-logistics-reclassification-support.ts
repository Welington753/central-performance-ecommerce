import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correção da auditoria Full/Fulfillment — duas colunas ADITIVAS, ambas
 * NULLABLE, SEM DEFAULT e SEM nenhum UPDATE em massa. Nenhuma linha
 * existente é tocada e nenhum contrato atual é alterado: todo leitor
 * anterior a esta migration continua funcionando sem enxergar as colunas.
 *
 * 1) `sync_runs.logistics_diagnostics` (jsonb)
 *    A tabela `sync_runs` só tinha colunas `int` de contagem fixas
 *    (`records_read`, `pages_fetched`, ...) e um `error_summary` de texto
 *    reservado a FALHAS. O diagnóstico da classificação logística tem doze
 *    contadores e precisa existir também em execuções de SUCESSO — não cabia
 *    em nenhuma coluna existente sem distorcer o significado delas (em
 *    especial `error_summary`, cujo contrato documentado é "resumo de erro").
 *    Uma coluna `jsonb` nullable é a menor alteração compatível: nada é
 *    removido, nada é renomeado, nada é preenchido retroativamente.
 *    O conteúdo é sempre SANITIZADO (só inteiros, vocabulário de chaves
 *    fechado — ver `logistics-classification-diagnostics.ts`); nunca token,
 *    URL, identificador de pedido/envio ou dado de comprador.
 *
 * 2) `marketplace_orders.external_shipment_id` (varchar)
 *    O identificador de envio do Mercado Livre (`shipping.id`) era usado em
 *    memória durante a sincronização e descartado. Sem ele persistido, um
 *    pedido que ficou `UNKNOWN` não tinha como ser reclassificado depois sem
 *    refazer o backfill. Passa a ser gravado a partir desta versão; linhas
 *    anteriores ficam `NULL` (nunca inventado, nunca inferido) e são
 *    contadas à parte pelo `--plan` da reclassificação.
 *
 *    O índice parcial existe exclusivamente para a varredura de pendências
 *    (`logistics_classification = 'UNKNOWN'` com identificador disponível),
 *    mantendo-a barata mesmo com histórico grande. Por ser PARCIAL, não
 *    pesa em nenhuma outra consulta nem nas escritas de pedidos já
 *    classificados.
 */
export class LogisticsReclassificationSupport1789000000000 implements MigrationInterface {
  name = 'LogisticsReclassificationSupport1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sync_runs"
        ADD COLUMN "logistics_diagnostics" jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        ADD COLUMN "external_shipment_id" varchar
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_orders_pending_logistics"
        ON "marketplace_orders" ("marketplace_account_id", "id")
        WHERE "logistics_classification" = 'UNKNOWN'
          AND "external_shipment_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_marketplace_orders_pending_logistics"
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        DROP COLUMN IF EXISTS "external_shipment_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "sync_runs"
        DROP COLUMN IF EXISTS "logistics_diagnostics"
    `);
  }
}
