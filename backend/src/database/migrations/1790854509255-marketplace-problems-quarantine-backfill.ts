import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CP4 da funcionalidade "Problemas": quarentena durável de claims cujo
 * `fetch_core` falha de forma por-claim (`CORE_FORBIDDEN`/`CORE_NOT_FOUND`)
 * e cursor de backfill histórico.
 *
 * `marketplace_problem_claim_quarantine`: UMA linha por
 * `(marketplace_account_id, external_claim_id)`. Guarda SÓ um `failure_code`
 * sanitizado (CHECK por regex — nunca mensagem, URL, token, payload ou PII),
 * `claim_date_created` (vem do resultado VALIDADO da busca, que já traz
 * `date_created` mesmo quando o core falha; `NULL` em linha legada), as
 * datas da primeira/última ocorrência, o número de tentativas, a próxima
 * tentativa (backoff) e `resolved_at` (preenchido quando um fetch futuro
 * funciona). Não é problema sincronizado: nunca entra em KPI.
 *
 * Backfill histórico: colunas `historical_*` na MESMA linha do job (mesmo
 * lease/CAS do incremental — nenhum worker novo). `historical_covered_from`
 * é o cursor (anda para trás) e, ao mesmo tempo, a menor data coberta;
 * nasce com o início da cobertura incremental (`window_cursor_at` inicial =
 * `created_at - 60 dias`, ver `INITIAL_WINDOW_DAYS`). Para jobs já existentes
 * o valor é reconstituído assim (nunca além do cursor atual).
 * `historical_attempt_count`/`historical_next_attempt_at`: espera durável do
 * histórico quando uma janela falha por motivo por-claim (ex.:
 * `invalid_response`) — impede retry a cada tick (sem hot loop).
 */
export class MarketplaceProblemsQuarantineBackfill1790854509255 implements MigrationInterface {
  name = 'MarketplaceProblemsQuarantineBackfill1790854509255';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_problem_claim_quarantine" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "marketplace_account_id" uuid NOT NULL,
        "external_claim_id" varchar NOT NULL,
        "failure_code" varchar NOT NULL,
        "claim_date_created" timestamptz,
        "first_seen_at" timestamptz NOT NULL,
        "last_seen_at" timestamptz NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 1,
        "next_attempt_at" timestamptz NOT NULL,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_marketplace_problem_claim_quarantine_account"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_marketplace_problem_claim_quarantine_account_claim"
          UNIQUE ("marketplace_account_id", "external_claim_id"),
        CONSTRAINT "CK_marketplace_problem_claim_quarantine_failure_code"
          CHECK ("failure_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'),
        CONSTRAINT "CK_marketplace_problem_claim_quarantine_attempts"
          CHECK ("attempt_count" >= 1)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_marketplace_problem_claim_quarantine_pending"
        ON "marketplace_problem_claim_quarantine"
          ("marketplace_account_id", "next_attempt_at")
        WHERE "resolved_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "marketplace_problems_sync_jobs"
        ADD COLUMN "historical_covered_from" timestamptz,
        ADD COLUMN "historical_target_from" timestamptz,
        ADD COLUMN "historical_status" varchar NOT NULL DEFAULT 'RUNNING',
        ADD COLUMN "historical_completed_at" timestamptz,
        ADD COLUMN "historical_last_error_code" varchar,
        ADD COLUMN "historical_attempt_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "historical_next_attempt_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "marketplace_problems_sync_jobs"
         SET "historical_covered_from" =
               LEAST("window_cursor_at", "created_at" - interval '60 days')
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_problems_sync_jobs"
        ALTER COLUMN "historical_covered_from" SET NOT NULL,
        ADD CONSTRAINT "CK_marketplace_problems_sync_jobs_historical_status"
          CHECK ("historical_status" IN (
            'RUNNING', 'PAUSED', 'COMPLETED', 'NO_TARGET', 'FAILED'
          ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_problems_sync_jobs"
        DROP CONSTRAINT IF EXISTS "CK_marketplace_problems_sync_jobs_historical_status",
        DROP COLUMN IF EXISTS "historical_next_attempt_at",
        DROP COLUMN IF EXISTS "historical_attempt_count",
        DROP COLUMN IF EXISTS "historical_last_error_code",
        DROP COLUMN IF EXISTS "historical_completed_at",
        DROP COLUMN IF EXISTS "historical_status",
        DROP COLUMN IF EXISTS "historical_target_from",
        DROP COLUMN IF EXISTS "historical_covered_from"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_marketplace_problem_claim_quarantine_pending"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "marketplace_problem_claim_quarantine"
    `);
  }
}
