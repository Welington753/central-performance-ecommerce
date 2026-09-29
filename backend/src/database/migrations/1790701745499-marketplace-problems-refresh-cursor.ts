import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CP2-A da funcionalidade "Problemas": acrescenta `last_checked_at` a
 * `marketplace_problems` — última vez que o estado de um claim foi
 * confirmado com o Mercado Livre, por qualquer fonte (janela de criação,
 * censo de abertos ou refresh individual). Puramente aditiva, nenhum dado
 * existente é tocado.
 *
 * O índice cobre exatamente `ORDER BY last_checked_at ASC NULLS FIRST, id ASC`
 * filtrado por `resolution_date IS NULL` — a fila de refresh de problemas
 * não-terminais (CP2-B/C, futuro) não precisa de nenhum cursor persistido:
 * todo upsert aceito grava `last_checked_at = now()`, o que já manda o
 * registro para o fim da fila sozinho.
 */
export class MarketplaceProblemsRefreshCursor1790701745499 implements MigrationInterface {
  name = 'MarketplaceProblemsRefreshCursor1790701745499';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_problems"
        ADD COLUMN "last_checked_at" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      CREATE INDEX "IX_marketplace_problems_refresh_queue"
        ON "marketplace_problems" ("marketplace_account_id", "last_checked_at" ASC NULLS FIRST, "id" ASC)
        WHERE "resolution_date" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IX_marketplace_problems_refresh_queue"
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_problems"
        DROP COLUMN IF EXISTS "last_checked_at"
    `);
  }
}
