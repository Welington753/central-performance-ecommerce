import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration inicial da Fase 1 (Fundação).
 *
 * Cria as 4 tabelas do núcleo: users, user_sessions, marketplace_accounts e
 * sync_runs, com todos os índices obrigatórios, as foreign keys e o índice
 * único parcial de (marketplace, external_seller_id).
 *
 * Requer PostgreSQL >= 13 (usa a extensão `uuid-ossp` para gerar UUIDs via
 * `uuid_generate_v4()`, o mesmo default que o TypeORM usa para colunas
 * `@PrimaryGeneratedColumn('uuid')` no driver postgres).
 */
export class InitSchema1787837395713 implements MigrationInterface {
  name = 'InitSchema1787837395713';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // ---------------------------------------------------------------------
    // users
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "email" varchar NOT NULL,
        "password_hash" varchar NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email")
    `);

    // ---------------------------------------------------------------------
    // user_sessions
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "user_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "refresh_token_hash" varchar NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ip" varchar,
        "user_agent" varchar,
        CONSTRAINT "PK_user_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_sessions_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_sessions_user_id" ON "user_sessions" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_sessions_refresh_token_hash" ON "user_sessions" ("refresh_token_hash")
    `);

    // ---------------------------------------------------------------------
    // marketplace_accounts
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "marketplace_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace" varchar NOT NULL,
        "external_seller_id" varchar,
        "nickname" varchar,
        "status" varchar NOT NULL DEFAULT 'DISCONNECTED',
        "encrypted_access_token" text,
        "encrypted_refresh_token" text,
        "encrypted_credential_metadata" text,
        "token_expires_at" TIMESTAMPTZ,
        "last_successful_sync_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_accounts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_accounts_marketplace" ON "marketplace_accounts" ("marketplace")
    `);
    // Índice único PARCIAL: só aplica quando external_seller_id não é nulo.
    // Permite múltiplas contas do mesmo marketplace ainda não conectadas
    // (sem external_seller_id), mas proíbe duplicar a mesma conta externa
    // já conectada.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_marketplace_accounts_marketplace_external_seller_id"
        ON "marketplace_accounts" ("marketplace", "external_seller_id")
        WHERE "external_seller_id" IS NOT NULL
    `);

    // ---------------------------------------------------------------------
    // sync_runs
    // ---------------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "sync_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_account_id" uuid,
        "marketplace" varchar NOT NULL,
        "type" varchar NOT NULL,
        "status" varchar NOT NULL,
        "started_at" TIMESTAMPTZ NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "date_from" TIMESTAMPTZ,
        "date_to" TIMESTAMPTZ,
        "records_read" integer NOT NULL DEFAULT 0,
        "records_created" integer NOT NULL DEFAULT 0,
        "records_updated" integer NOT NULL DEFAULT 0,
        "records_failed" integer NOT NULL DEFAULT 0,
        "error_code" varchar,
        "error_summary" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sync_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sync_runs_marketplace_account_id" FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sync_runs_marketplace" ON "sync_runs" ("marketplace")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sync_runs_status" ON "sync_runs" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sync_runs_started_at" ON "sync_runs" ("started_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_sync_runs_marketplace_account_id" ON "sync_runs" ("marketplace_account_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sync_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    // A extensão "uuid-ossp" não é removida propositalmente: pode estar em
    // uso por outros objetos do banco em ambientes hospedados/compartilhados.
  }
}
