import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correção histórica do "Shopee Full/FBS" — a auditoria de produção
 * confirmou o vocabulário fechado de `fulfillment_channel` (coluna que
 * guarda o `fulfillment_flag` bruto da Shopee, ver
 * `shopee-order.mapper.ts`/`shopee-fulfillment-flag-classification.ts`):
 * `'fulfilled_by_shopee'` → Shopee Full, `'fulfilled_by_local_seller'` →
 * vendedor. Antes desta migration, TODO pedido Shopee tinha
 * `logistics_classification = 'UNKNOWN'` (o mapper nunca classificava) —
 * esta migration classifica retroativamente só o histórico já sincronizado,
 * exatamente com a mesma regra agora aplicada pelo mapper em toda nova
 * sincronização/backfill.
 *
 * Escopo estritamente restrito a `marketplace_accounts.marketplace = 'SHOPEE'`
 * via `JOIN` (nunca um ID de conta hardcoded) — Mercado Livre e Amazon nunca
 * são tocados. Não altera `fulfillment_channel` (só LÊ o valor já
 * persistido) nem nenhum campo financeiro. Dois `UPDATE ... FROM` set-based,
 * sem loop por linha, sem chamada de rede. Qualquer `fulfillment_channel`
 * fora dos dois valores reconhecidos (incluindo `NULL`) permanece `UNKNOWN`
 * — nunca tocado por este `up`.
 */
export class ShopeeFulfillmentFlagReclassification1789100000000 implements MigrationInterface {
  name = 'ShopeeFulfillmentFlagReclassification1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "marketplace_orders" o
         SET "logistics_classification" = 'MARKETPLACE_FULFILLED'
        FROM "marketplace_accounts" ma
       WHERE ma."id" = o."marketplace_account_id"
         AND ma."marketplace" = 'SHOPEE'
         AND o."fulfillment_channel" = 'fulfilled_by_shopee'
    `);
    await queryRunner.query(`
      UPDATE "marketplace_orders" o
         SET "logistics_classification" = 'SELLER_FULFILLED'
        FROM "marketplace_accounts" ma
       WHERE ma."id" = o."marketplace_account_id"
         AND ma."marketplace" = 'SHOPEE'
         AND o."fulfillment_channel" = 'fulfilled_by_local_seller'
    `);
  }

  /**
   * Reverte exatamente o inverso do `up`: só as linhas Shopee cujo
   * `fulfillment_channel` está no vocabulário reconhecido voltam para
   * `UNKNOWN` — nunca toca em pedidos cuja classificação já estava resolvida
   * por outro motivo antes desta migration (não existia nenhum caso assim
   * para Shopee, mas o filtro por `fulfillment_channel` mantém o rollback
   * restrito ao que o `up` de fato mudou).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "marketplace_orders" o
         SET "logistics_classification" = 'UNKNOWN'
        FROM "marketplace_accounts" ma
       WHERE ma."id" = o."marketplace_account_id"
         AND ma."marketplace" = 'SHOPEE'
         AND o."fulfillment_channel" IN ('fulfilled_by_shopee', 'fulfilled_by_local_seller')
    `);
  }
}
