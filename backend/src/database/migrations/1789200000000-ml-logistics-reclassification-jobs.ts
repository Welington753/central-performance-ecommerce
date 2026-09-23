import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estado persistente por conta Mercado Livre do worker de reclassificação
 * histórica Full (correção da auditoria Full — Render free sem Shell).
 * MESMO padrão já provado por `marketplace_backfill_jobs` (Fase 4,
 * "Backfill durável"): uma linha por conta, `FOR UPDATE SKIP LOCKED` para
 * claim, lease (`lease_owner`/`lease_expires_at`) para detectar processo
 * derrubado no meio de um tick, e CAS por `version` para nunca perder update
 * concorrente. Nenhuma coluna nova em `marketplace_orders`/`sync_runs` — o
 * progresso REAL de classificação continua sendo `logistics_classification`
 * (migration 1789000000000); esta tabela guarda só a ORQUESTRAÇÃO do worker.
 *
 * `UNIQUE (marketplace_account_id)`: no máximo uma linha por conta (não um
 * histórico de jobs como o backfill) — o requisito pede estado atual por
 * conta, não histórico de execuções.
 *
 * `last_error_code` é sempre um código fechado (vocabulário de
 * `ReclassificationAccountOutcome`/erro de token, nunca resposta bruta do
 * provedor, nunca token, nunca identificador de pedido/envio).
 *
 * `queue1_cursor_id`/`queue2_cursor_id`/`pass_resolved_count` (correção
 * "sem starvation", revisão crítica pós-implementação): cursor durável das
 * duas filas do serviço reaproveitado (`marketplace_orders.id`, mesmo
 * identificador usado pela paginação já existente — nunca um novo esquema
 * de ordenação). Sem isto, cada tick reiniciaria a varredura do zero e
 * pedidos permanentemente inválidos (`not_found`/resposta inválida) sempre
 * na frente da fila impediriam pedidos válidos mais adiante de serem
 * alcançados. `pass_resolved_count` conta quantas resoluções reais
 * (Full/não Full) aconteceram na "passada" atual (do cursor `NULL` até
 * esgotar as duas filas); ao esgotar sem NENHUMA resolução nova, a conta
 * está `COMPLETED` de fato (tudo que sobrou é permanentemente
 * inclassificável) — ao esgotar COM alguma resolução, os cursores voltam a
 * `NULL` para uma nova passada (nova varredura pode alcançar pedidos cujo
 * `external_shipment_id` só foi recuperado tarde demais para a passada
 * anterior). Nunca identificam pedido/envio fora do próprio
 * `marketplace_orders` — são só ponteiros de paginação.
 */
export class MlLogisticsReclassificationJobs1789200000000 implements MigrationInterface {
  name = 'MlLogisticsReclassificationJobs1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ml_logistics_reclassification_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "marketplace_account_id" uuid NOT NULL,
        "status" varchar NOT NULL DEFAULT 'RUNNING',
        "initial_unknown_count" integer NOT NULL DEFAULT 0,
        "remaining_unknown_count" integer NOT NULL DEFAULT 0,
        "resolved_full_count" integer NOT NULL DEFAULT 0,
        "resolved_not_full_count" integer NOT NULL DEFAULT 0,
        "calls_made_count" integer NOT NULL DEFAULT 0,
        "queue1_cursor_id" uuid,
        "queue2_cursor_id" uuid,
        "pass_resolved_count" integer NOT NULL DEFAULT 0,
        "last_activity_at" timestamptz,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "last_error_code" varchar,
        "pause_requested" boolean NOT NULL DEFAULT false,
        "lease_owner" varchar,
        "lease_expires_at" timestamptz,
        "version" integer NOT NULL DEFAULT 0,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_ml_logistics_reclassification_jobs_account"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_ml_logistics_reclassification_jobs_account"
          UNIQUE ("marketplace_account_id"),
        CONSTRAINT "CK_ml_logistics_reclassification_jobs_status"
          CHECK ("status" IN (
            'IDLE', 'RUNNING', 'PAUSED', 'WAITING_RETRY', 'COMPLETED', 'FAILED_AUTH'
          ))
      )
    `);
    // Índice do claim do worker (`status`/`next_attempt_at`) — o mesmo par
    // filtrado pela query de `FOR UPDATE SKIP LOCKED`. Não cobre o caso
    // "RUNNING com lease expirado" à parte: com poucas linhas (uma por
    // conta Mercado Livre) um índice adicional não paga o custo de
    // manutenção — a claim query varre a tabela inteira sem problema nesta
    // escala.
    await queryRunner.query(`
      CREATE INDEX "IDX_ml_logistics_reclassification_jobs_claim"
        ON "ml_logistics_reclassification_jobs" ("status", "next_attempt_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_ml_logistics_reclassification_jobs_claim"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "ml_logistics_reclassification_jobs"
    `);
  }
}
