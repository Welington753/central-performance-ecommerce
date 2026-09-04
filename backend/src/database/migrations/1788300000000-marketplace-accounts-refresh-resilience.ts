import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Correção de resiliência da renovação OAuth do Mercado Livre: uma falha
 * temporária/ambígua de renovação (timeout, DNS, 429/5xx, conexão
 * interrompida) não deve mais exigir reconexão manual. Três colunas
 * aditivas, todas com default seguro — nenhuma reescrita de linha existente
 * além do preenchimento do default do Postgres:
 *
 * - `refresh_failure_count integer NOT NULL DEFAULT 0`: falhas recuperáveis
 *   consecutivas, para o backoff exponencial.
 * - `refresh_retry_at timestamptz NULL`: `ensureValidAccessToken` nunca
 *   tenta renovar antes deste instante.
 * - `last_refresh_attempt_at timestamptz NULL`: observabilidade.
 */
export class MarketplaceAccountsRefreshResilience1788300000000 implements MigrationInterface {
  name = 'MarketplaceAccountsRefreshResilience1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        ADD COLUMN "refresh_failure_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "refresh_retry_at" TIMESTAMPTZ,
        ADD COLUMN "last_refresh_attempt_at" TIMESTAMPTZ
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        DROP COLUMN "refresh_failure_count",
        DROP COLUMN "refresh_retry_at",
        DROP COLUMN "last_refresh_attempt_at"
    `);
  }
}
