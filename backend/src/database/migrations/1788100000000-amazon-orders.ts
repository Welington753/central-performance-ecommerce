import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkpoint 4-B (auditoria de schema): três colunas NULLABLE em
 * `marketplace_orders`, necessárias para preservar, sem perda, dados que só
 * a Amazon produz — nenhuma delas existia antes (status original da fonte,
 * canal de fulfillment FBA/FBM, marketplaceId externo). `source_updated_at`
 * NÃO precisou de coluna nova: `marketplace_last_updated` (Fase 3) já é
 * genérico o bastante e é reaproveitado também pela Amazon.
 *
 * Forward-only, reversível, retrocompatível: colunas nullable, sem default
 * diferente de NULL — nenhuma linha existente do Mercado Livre é tocada
 * (nenhum UPDATE nesta migration), nenhum valor financeiro/status/FK é
 * alterado, nenhum fulfillment é inventado para linhas antigas.
 */
export class AmazonOrders1788100000000 implements MigrationInterface {
  name = 'AmazonOrders1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        ADD COLUMN "source_status" varchar,
        ADD COLUMN "fulfillment_channel" varchar,
        ADD COLUMN "external_marketplace_id" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        DROP COLUMN IF EXISTS "source_status",
        DROP COLUMN IF EXISTS "fulfillment_channel",
        DROP COLUMN IF EXISTS "external_marketplace_id"
    `);
  }
}
