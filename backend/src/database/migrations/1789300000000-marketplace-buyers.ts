import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Função "Clientes" (Mercado Livre + Shopee). Puramente ADITIVA para os dados
 * existentes: nenhuma coluna existente é removida/alterada de tipo e nenhum
 * pedido é reescrito — `marketplace_orders.marketplace_buyer_id` nasce `NULL`
 * e só é preenchido por sincronização/enriquecimento posterior.
 *
 * `marketplace_buyers`: identidade = `(marketplace_account_id,
 * external_buyer_id)` — o mesmo id externo em contas/marketplaces diferentes
 * é sempre um comprador diferente; nunca há deduplicação por nome, e-mail,
 * telefone, endereço ou documento. Nome do comprador (Mercado Livre), nome e
 * telefone do DESTINATÁRIO (Shopee, `recipient_address` — pode não ser o
 * comprador), e-mail e CEP de entrega ficam criptografados (`*_encrypted`,
 * formato do `EncryptionService`); nenhum documento, endereço completo, dado
 * de pagamento ou payload bruto existe nesta tabela. `has_*` são só booleanos
 * derivados ("presente e não mascarado") para filtrar/contar em SQL sem
 * descriptografar — nunca índice ou cópia do valor pessoal.
 *
 * `customer_export_audits`: quem exportou, quando, filtros e contagens —
 * nunca os valores pessoais exportados. Contagens e `completed_at` ficam
 * `NULL` enquanto o arquivo é gerado ou se o download foi interrompido.
 *
 * `marketplace_backfill_jobs.mode`/`cursor_before`: o enriquecimento
 * histórico de compradores reaproveita a MESMA tabela/worker do backfill
 * durável (modo `BUYER_ENRICHMENT`, cursor próprio), já que o backfill
 * existente só avança para períodos mais antigos que a cobertura e nunca
 * reprocessa pedidos já sincronizados. `COMPLETED` é o terminal desse modo.
 */
export class MarketplaceBuyers1789300000000 implements MigrationInterface {
  name = 'MarketplaceBuyers1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_buyers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_account_id" uuid NOT NULL,
        "external_buyer_id" varchar NOT NULL,
        "username" varchar,
        "buyer_name_encrypted" text,
        "recipient_name_encrypted" text,
        "email_encrypted" text,
        "recipient_phone_encrypted" text,
        "city" varchar,
        "state" varchar,
        "postal_code_encrypted" text,
        "has_buyer_name" boolean NOT NULL DEFAULT false,
        "has_recipient_name" boolean NOT NULL DEFAULT false,
        "has_email" boolean NOT NULL DEFAULT false,
        "has_recipient_phone" boolean NOT NULL DEFAULT false,
        "data_source" varchar NOT NULL,
        "personal_data_last_updated_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_buyers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_buyers_marketplace_account_id"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_marketplace_buyers_data_source" CHECK (
          "data_source" IN ('MERCADO_LIVRE_ORDERS', 'SHOPEE_ORDER_DETAIL')
        ),
        CONSTRAINT "CK_marketplace_buyers_external_buyer_id_not_blank" CHECK (
          length(btrim("external_buyer_id")) > 0
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_marketplace_buyers_account_external_buyer_id"
        ON "marketplace_buyers" ("marketplace_account_id", "external_buyer_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        ADD COLUMN "marketplace_buyer_id" uuid,
        ADD CONSTRAINT "FK_marketplace_orders_marketplace_buyer_id"
          FOREIGN KEY ("marketplace_buyer_id")
          REFERENCES "marketplace_buyers" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_orders_marketplace_buyer_id"
        ON "marketplace_orders" ("marketplace_buyer_id")
        WHERE "marketplace_buyer_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "customer_export_audits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "exported_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "filters" jsonb NOT NULL,
        "buyers_count" integer,
        "detail_rows_count" integer,
        "included_personal_data" boolean NOT NULL,
        "completed_at" TIMESTAMPTZ,
        CONSTRAINT "PK_customer_export_audits" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_customer_export_audits_exported_at"
        ON "customer_export_audits" ("exported_at" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "marketplace_backfill_jobs"
        ADD COLUMN "mode" varchar NOT NULL DEFAULT 'HISTORY',
        ADD COLUMN "cursor_before" TIMESTAMPTZ,
        ADD CONSTRAINT "CK_marketplace_backfill_jobs_mode" CHECK (
          "mode" IN ('HISTORY', 'BUYER_ENRICHMENT')
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_backfill_jobs"
        DROP CONSTRAINT "CK_marketplace_backfill_jobs_status",
        ADD CONSTRAINT "CK_marketplace_backfill_jobs_status" CHECK (
          "status" IN (
            'QUEUED', 'RUNNING', 'RETRY_WAIT', 'PAUSED', 'FAILED',
            'SAFETY_LIMIT_REACHED', 'COMPLETED'
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "marketplace_backfill_jobs" WHERE "mode" = 'BUYER_ENRICHMENT'`,
    );
    await queryRunner.query(`
      ALTER TABLE "marketplace_backfill_jobs"
        DROP CONSTRAINT "CK_marketplace_backfill_jobs_status",
        ADD CONSTRAINT "CK_marketplace_backfill_jobs_status" CHECK (
          "status" IN (
            'QUEUED', 'RUNNING', 'RETRY_WAIT', 'PAUSED', 'FAILED',
            'SAFETY_LIMIT_REACHED'
          )
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_backfill_jobs"
        DROP CONSTRAINT IF EXISTS "CK_marketplace_backfill_jobs_mode",
        DROP COLUMN IF EXISTS "cursor_before",
        DROP COLUMN IF EXISTS "mode"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_export_audits"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_marketplace_orders_marketplace_buyer_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "marketplace_orders"
        DROP CONSTRAINT IF EXISTS "FK_marketplace_orders_marketplace_buyer_id",
        DROP COLUMN IF EXISTS "marketplace_buyer_id"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_buyers"`);
  }
}
