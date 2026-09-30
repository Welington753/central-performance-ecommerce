import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CP2-C da funcionalidade "Problemas": job durável de sincronização
 * incremental do Mercado Livre Claims — UMA linha por conta, MESMO padrão de
 * `ml_logistics_reclassification_jobs` (lease + CAS por `version` +
 * `lease_owner`, claim via `FOR UPDATE SKIP LOCKED`).
 *
 * A sincronização incremental é PERENE: não existe status `COMPLETED` — o job
 * volta sempre a `RUNNING` (com `next_attempt_at` no futuro) depois de cada
 * tick bem-sucedido. `FAILED_AUTH` (autorização terminal, exige reconexão) e
 * `FAILED` (limite de tentativas, `SAFETY_LIMIT_REACHED` ou configuração
 * terminal) só saem por retomada explícita.
 *
 * `window_cursor_at` é o início da próxima janela de criação (cursor durável
 * do CP2-B). NÃO há `refresh_cursor_problem_id`: o refresh de problemas
 * não-terminais segue a fila de `marketplace_problems`
 * (`ORDER BY last_checked_at ASC NULLS FIRST, id ASC`, índice do CP2-A) — todo
 * upsert aceito já move o registro para o fim da fila sozinho.
 * `last_census_at` = último censo COMPLETO e bem-sucedido de claims abertos;
 * só regula a cadência desse censo (mais caro). NULL = nunca completou.
 *
 * Contadores acumulam a vida inteira da conta (bigint, sem teto prático).
 * `last_error_code` guarda só um código do vocabulário fechado do worker —
 * nunca mensagem, token, payload ou PII.
 */
export class MarketplaceProblemsSyncJobs1790767941589 implements MigrationInterface {
  name = 'MarketplaceProblemsSyncJobs1790767941589';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_problems_sync_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "marketplace_account_id" uuid NOT NULL,
        "status" varchar NOT NULL DEFAULT 'RUNNING',
        "window_cursor_at" timestamptz NOT NULL,
        "claims_processed_count" bigint NOT NULL DEFAULT 0,
        "claims_persisted_count" bigint NOT NULL DEFAULT 0,
        "claims_failed_count" bigint NOT NULL DEFAULT 0,
        "calls_made_count" bigint NOT NULL DEFAULT 0,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "last_error_code" varchar,
        "pause_requested" boolean NOT NULL DEFAULT false,
        "lease_owner" varchar,
        "lease_expires_at" timestamptz,
        "version" integer NOT NULL DEFAULT 0,
        "last_activity_at" timestamptz,
        "last_census_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_marketplace_problems_sync_jobs_account"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_marketplace_problems_sync_jobs_account"
          UNIQUE ("marketplace_account_id"),
        CONSTRAINT "CK_marketplace_problems_sync_jobs_status"
          CHECK ("status" IN (
            'RUNNING', 'PAUSED', 'WAITING_RETRY', 'FAILED', 'FAILED_AUTH'
          ))
      )
    `);
    // Índice do claim do worker — mesmo par filtrado pela query de
    // `FOR UPDATE SKIP LOCKED`. Uma linha por conta: escala pequena.
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problems_sync_jobs_claim"
        ON "marketplace_problems_sync_jobs" ("status", "next_attempt_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_marketplace_problems_sync_jobs_claim"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "marketplace_problems_sync_jobs"
    `);
  }
}
