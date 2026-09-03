import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 ("Renomear contas"): reaproveita a coluna `nickname` já existente
 * (Fase 1) como nome visual persistente da conta — nenhuma coluna nova é
 * criada.
 *
 * Aditiva e não destrutiva:
 * - `ALTER COLUMN ... TYPE varchar(60)`: só formaliza no schema o limite já
 *   imposto pela aplicação (rota de rename). Nenhum dado existente é
 *   truncado ou perdido — `nickname` continua nullable e os valores
 *   inseridos até aqui (Fase 1/3, `CreateMarketplaceAccountDto`) já são
 *   validados a no máximo 120 chars pela aplicação, mas nunca gravados via
 *   rename; sem risco de estouro em ambientes reais desta fase.
 * - Índice único PARCIAL por `(marketplace, lower(nickname))`, só quando
 *   `nickname` não é nulo: duas contas do mesmo marketplace não podem ter o
 *   mesmo apelido (comparação case-insensitive), mas o mesmo apelido é
 *   permitido em marketplaces diferentes, e múltiplas contas sem apelido
 *   coexistem livremente. A aplicação sempre grava `nickname` já normalizado
 *   (trim + espaços internos colapsados — ver `nickname.util.ts`), então
 *   `lower(nickname)` no índice é suficiente sem repetir essa normalização
 *   em SQL.
 */
export class MarketplaceAccountsNicknameUniqueness1788200000000 implements MigrationInterface {
  name = 'MarketplaceAccountsNicknameUniqueness1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        ALTER COLUMN "nickname" TYPE varchar(60)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_marketplace_accounts_marketplace_nickname"
        ON "marketplace_accounts" ("marketplace", lower("nickname"))
        WHERE "nickname" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_marketplace_accounts_marketplace_nickname"
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        ALTER COLUMN "nickname" TYPE varchar
    `);
  }
}
