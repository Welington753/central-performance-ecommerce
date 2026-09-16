import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkpoint CP2K-7D: campos financeiros do Mercado Livre confirmados por
 * sondagem real da API (CP2K-7C) — `payments[].marketplace_fee`,
 * `.shipping_cost`, `.taxes_amount`, `.coupon_amount`,
 * `.transaction_amount_refunded` (nível pedido) e `order_items[].sale_fee`
 * (nível item). Mesma convenção decimal de `total_amount`/`unit_price`
 * (`numeric(14,2)`) — nunca centavos nesta camada.
 *
 * Todas as colunas nascem NULLABLE, SEM DEFAULT e SEM nenhum UPDATE em
 * massa: ausência de dado nunca significa zero, e nenhum pedido
 * pré-existente (Mercado Livre antigo, Amazon ou Shopee) precisa ser tocado
 * — todos ficam `NULL`, exatamente como qualquer outro campo aditivo
 * opcional já existente neste schema (`source_status`,
 * `fulfillment_channel` etc., ver migration 1788100000000).
 *
 * `buyer_shipping_cost_amount`: nome deliberadamente explícito — é o frete
 * COBRADO DO COMPRADOR (`payments[].shipping_cost`), nunca o custo do
 * vendedor (conceito não confirmado/nunca persistido neste checkpoint).
 */
export class MarketplaceOrdersFinancialFields1788900000000 implements MigrationInterface {
  name = 'MarketplaceOrdersFinancialFields1788900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        ADD COLUMN "marketplace_fee_amount" numeric(14,2),
        ADD COLUMN "buyer_shipping_cost_amount" numeric(14,2),
        ADD COLUMN "taxes_amount" numeric(14,2),
        ADD COLUMN "coupon_amount" numeric(14,2),
        ADD COLUMN "refunded_amount" numeric(14,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_order_items"
        ADD COLUMN "sale_fee_amount" numeric(14,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_order_items"
        DROP COLUMN IF EXISTS "sale_fee_amount"
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        DROP COLUMN IF EXISTS "marketplace_fee_amount",
        DROP COLUMN IF EXISTS "buyer_shipping_cost_amount",
        DROP COLUMN IF EXISTS "taxes_amount",
        DROP COLUMN IF EXISTS "coupon_amount",
        DROP COLUMN IF EXISTS "refunded_amount"
    `);
  }
}
