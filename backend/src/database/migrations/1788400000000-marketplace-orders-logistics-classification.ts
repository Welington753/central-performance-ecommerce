import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Classificação logística (Fase 4, "Mercado Livre Full"): distingue pedidos
 * despachados pelo próprio Mercado Livre (Full) dos demais. Duas colunas
 * aditivas, ambas com default seguro:
 *
 * - `logistics_classification varchar NOT NULL DEFAULT 'UNKNOWN'`: valor
 *   CANÔNICO (`MARKETPLACE_FULFILLED`/`SELLER_FULFILLED`/`UNKNOWN`) usado por
 *   toda agregação — nunca reaproveita `fulfillment_channel`
 *   (`AMAZON`/`MERCHANT`), que é semântica exclusiva da Amazon. Todo pedido
 *   existente antes desta migration vira `UNKNOWN` (nunca inferido como
 *   `SELLER_FULFILLED`).
 * - `logistics_type varchar NULL`: valor bruto original do provedor (ex.:
 *   `fulfillment`, `drop_off`, `self_service`) preservado para auditoria,
 *   `NULL` quando nunca resolvido.
 */
export class MarketplaceOrdersLogisticsClassification1788400000000 implements MigrationInterface {
  name = 'MarketplaceOrdersLogisticsClassification1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        ADD COLUMN "logistics_classification" varchar NOT NULL DEFAULT 'UNKNOWN',
        ADD COLUMN "logistics_type" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        DROP COLUMN "logistics_classification",
        DROP COLUMN "logistics_type"
    `);
  }
}
