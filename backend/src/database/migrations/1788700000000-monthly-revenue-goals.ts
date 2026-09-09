import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkpoint BI-1 ("Metas e Ritmo"): meta mensal CONSOLIDADA de faturamento
 * — nunca por conta/marketplace individual (escopo explícito deste
 * checkpoint; ver `MonthlyRevenueGoalsController`). Puramente ADITIVA:
 * nenhuma tabela de pedido é tocada, nenhuma linha é inserida por esta
 * migration (nunca hardcoda um valor de meta real).
 *
 * Unicidade `(year, month, currency_id)`: uma única meta consolidada por
 * mês/moeda — um `PUT` repetido para o mesmo ano/mês atualiza a linha
 * existente (`ON CONFLICT`), nunca duplica.
 *
 * `year` limitado a [2020, 2100] — faixa generosa e documentada, só para
 * rejeitar erro de digitação óbvio (ex.: ano de 2 dígitos), nunca uma regra
 * de negócio real sobre até quando o sistema deve operar.
 */
export class MonthlyRevenueGoals1788700000000 implements MigrationInterface {
  name = 'MonthlyRevenueGoals1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "monthly_revenue_goals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "year" integer NOT NULL,
        "month" integer NOT NULL,
        "currency_id" varchar(3) NOT NULL,
        "target_amount" numeric(14,2) NOT NULL,
        "created_by_user_id" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_monthly_revenue_goals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_monthly_revenue_goals_created_by_user_id"
          FOREIGN KEY ("created_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_monthly_revenue_goals_month" CHECK ("month" BETWEEN 1 AND 12),
        CONSTRAINT "CK_monthly_revenue_goals_year" CHECK ("year" BETWEEN 2020 AND 2100),
        CONSTRAINT "CK_monthly_revenue_goals_target_amount_positive" CHECK ("target_amount" > 0),
        CONSTRAINT "CK_monthly_revenue_goals_currency_id" CHECK ("currency_id" = 'BRL')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_monthly_revenue_goals_year_month_currency"
        ON "monthly_revenue_goals" ("year", "month", "currency_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_monthly_revenue_goals_year_month_currency"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "monthly_revenue_goals"`);
  }
}
