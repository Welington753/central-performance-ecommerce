import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2: tabela de tentativas OAuth do Mercado Livre e colunas de
 * bookkeeping em `marketplace_accounts` (design §4). Isolada da migration
 * inicial da Fase 1 — nunca a modifica.
 */
export class MercadoLivreOAuth1787900000000 implements MigrationInterface {
  name = 'MercadoLivreOAuth1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -----------------------------------------------------------------
    // marketplace_accounts: novas colunas
    // -----------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        ADD COLUMN "error_summary" varchar(500),
        ADD COLUMN "failure_code" varchar,
        ADD COLUMN "connected_by_user_id" uuid,
        ADD COLUMN "token_version" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        ADD CONSTRAINT "FK_marketplace_accounts_connected_by_user_id"
        FOREIGN KEY ("connected_by_user_id") REFERENCES "users" ("id")
        ON DELETE SET NULL
    `);

    // -----------------------------------------------------------------
    // oauth_authorization_requests
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "oauth_authorization_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_account_id" uuid NOT NULL,
        "initiated_by_user_id" uuid,
        "marketplace" varchar NOT NULL,
        "state_hash" varchar(64) NOT NULL,
        "encrypted_code_verifier" text,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "failure_code" varchar,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "processing_started_at" TIMESTAMPTZ,
        "consumed_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oauth_authorization_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_oauth_authorization_requests_marketplace_account_id"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_oauth_authorization_requests_initiated_by_user_id"
          FOREIGN KEY ("initiated_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_oauth_authorization_requests_state_hash"
        ON "oauth_authorization_requests" ("state_hash")
    `);
    // Índice único parcial: só uma tentativa PENDING/PROCESSING ativa por
    // conta — proteção final contra corrida em POST .../connect.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_oauth_authorization_requests_active_attempt"
        ON "oauth_authorization_requests" ("marketplace_account_id")
        WHERE "status" IN ('PENDING', 'PROCESSING')
    `);
    // Índices parciais SEPARADOS para PENDING vs PROCESSING (design §4 —
    // correção explícita: um único índice (status, expires_at) não serve
    // para localizar PROCESSING abandonadas, que usam processing_started_at).
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_pending_expiry"
        ON "oauth_authorization_requests" ("status", "expires_at")
        WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_processing_started"
        ON "oauth_authorization_requests" ("status", "processing_started_at")
        WHERE "status" = 'PROCESSING'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_marketplace_account_id"
        ON "oauth_authorization_requests" ("marketplace_account_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_initiated_by_user_id"
        ON "oauth_authorization_requests" ("initiated_by_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "oauth_authorization_requests"`,
    );
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        DROP CONSTRAINT IF EXISTS "FK_marketplace_accounts_connected_by_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        DROP COLUMN IF EXISTS "error_summary",
        DROP COLUMN IF EXISTS "failure_code",
        DROP COLUMN IF EXISTS "connected_by_user_id",
        DROP COLUMN IF EXISTS "token_version"
    `);
  }
}
