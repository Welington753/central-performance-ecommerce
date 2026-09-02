import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 3: tabelas de pedidos/itens normalizados do Mercado Livre e colunas
 * de bookkeeping em `sync_runs` (design "Banco de dados"). Forward-only —
 * nunca reescreve nem destrói dados existentes de `marketplace_accounts`,
 * `sync_runs` ou das migrations da Fase 1/2.
 *
 * `sync_runs` (Fase 1) já cobre praticamente todo o registro de execução de
 * sincronização exigido aqui (status, período, contagens) — reaproveitada
 * em vez de criar uma tabela paralela, com apenas duas colunas novas
 * (`pages_fetched`, `items_persisted`) e um índice único parcial que
 * impede duas sincronizações simultâneas para a mesma conta.
 */
export class MercadoLivreOrders1788000000000 implements MigrationInterface {
  name = 'MercadoLivreOrders1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -----------------------------------------------------------------
    // sync_runs: novas colunas + índice único parcial anti-sobreposição
    // -----------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "sync_runs"
        ADD COLUMN "pages_fetched" integer NOT NULL DEFAULT 0,
        ADD COLUMN "items_persisted" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sync_runs_active_run_per_account"
        ON "sync_runs" ("marketplace_account_id")
        WHERE "status" = 'RUNNING' AND "marketplace_account_id" IS NOT NULL
    `);

    // -----------------------------------------------------------------
    // marketplace_orders
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "marketplace_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_account_id" uuid NOT NULL,
        "external_order_id" varchar NOT NULL,
        "status" varchar NOT NULL,
        "currency_id" varchar(3) NOT NULL,
        "total_amount" numeric(14,2) NOT NULL,
        "pack_id" varchar,
        "date_created" TIMESTAMPTZ NOT NULL,
        "date_closed" TIMESTAMPTZ,
        "marketplace_last_updated" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_orders_marketplace_account_id"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_marketplace_orders_account_external_order_id"
        ON "marketplace_orders" ("marketplace_account_id", "external_order_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_orders_account_date_created"
        ON "marketplace_orders" ("marketplace_account_id", "date_created")
    `);

    // -----------------------------------------------------------------
    // marketplace_order_items
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "marketplace_order_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "external_item_id" varchar NOT NULL,
        "variation_id" varchar,
        "seller_sku" varchar,
        "title" varchar NOT NULL,
        "quantity" integer NOT NULL,
        "unit_price" numeric(14,2) NOT NULL,
        "currency_id" varchar(3) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_order_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_order_items_order_id"
          FOREIGN KEY ("order_id")
          REFERENCES "marketplace_orders" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_order_items_order_id"
        ON "marketplace_order_items" ("order_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_order_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_orders"`);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_sync_runs_active_run_per_account"
    `);
    await queryRunner.query(`
      ALTER TABLE "sync_runs"
        DROP COLUMN IF EXISTS "pages_fetched",
        DROP COLUMN IF EXISTS "items_persisted"
    `);
  }
}
