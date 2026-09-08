import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 ("Backfill durável"): tabela de coordenação para o backfill
 * histórico executado por um worker do backend (nunca mais por um `while`
 * no frontend chamando `next-chunk` em loop). Puramente ADITIVA — nenhuma
 * tabela/coluna existente é alterada ou removida; `sync_runs` continua sendo
 * a fonte de verdade de cobertura/progresso real (via
 * `getAccountSyncCoverage`), e esta tabela guarda só o estado de
 * ORQUESTRAÇÃO (fila, lease, pausa, tentativas) de um job por conta.
 *
 * `marketplace_backfill_jobs` NUNCA guarda token, payload ou mensagem bruta
 * de provedor — só `last_error_code`, um código já sanitizado (mesmo
 * vocabulário fechado de `BackfillErrorCode`).
 *
 * Índice único parcial `UQ_marketplace_backfill_jobs_active_per_account`:
 * garante, mesmo sob concorrência real entre processos, que uma conta nunca
 * tenha mais de um job "ativo" (QUEUED/RUNNING/RETRY_WAIT/PAUSED)
 * simultaneamente — o mesmo padrão já usado por
 * `UQ_sync_runs_active_run_per_account` (migration da Fase 3). `FAILED` e
 * `SAFETY_LIMIT_REACHED` são terminais: fora do índice, permitem uma nova
 * tentativa (`start`) criar um job novo depois.
 */
export class MarketplaceBackfillJobs1788500000000 implements MigrationInterface {
  name = 'MarketplaceBackfillJobs1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_backfill_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_account_id" uuid NOT NULL,
        "marketplace" varchar NOT NULL,
        "status" varchar NOT NULL,
        "chunks_processed" integer NOT NULL DEFAULT 0,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "started_at" TIMESTAMPTZ,
        "last_activity_at" TIMESTAMPTZ,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ,
        "last_error_code" varchar,
        "pause_requested" boolean NOT NULL DEFAULT false,
        "lease_owner" varchar,
        "lease_expires_at" TIMESTAMPTZ,
        "version" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_marketplace_backfill_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_marketplace_backfill_jobs_marketplace_account_id"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_marketplace_backfill_jobs_status" CHECK (
          "status" IN (
            'QUEUED', 'RUNNING', 'RETRY_WAIT', 'PAUSED', 'FAILED',
            'SAFETY_LIMIT_REACHED'
          )
        )
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_marketplace_backfill_jobs_active_per_account"
        ON "marketplace_backfill_jobs" ("marketplace_account_id")
        WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'PAUSED')
    `);

    // Cobre a query de claim do worker: `WHERE status IN (...) AND
    // next_attempt_at <= now()` (ver `BackfillJobsPersistenceService.claimJobs`).
    await queryRunner.query(`
      CREATE INDEX "IX_marketplace_backfill_jobs_claimable"
        ON "marketplace_backfill_jobs" ("status", "next_attempt_at")
    `);

    // Cobre a busca do job mais recente de uma conta (status/retomada).
    await queryRunner.query(`
      CREATE INDEX "IX_marketplace_backfill_jobs_account_created"
        ON "marketplace_backfill_jobs" ("marketplace_account_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IX_marketplace_backfill_jobs_account_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IX_marketplace_backfill_jobs_claimable"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_marketplace_backfill_jobs_active_per_account"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_backfill_jobs"`);
  }
}
