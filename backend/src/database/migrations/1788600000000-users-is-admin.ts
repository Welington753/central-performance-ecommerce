import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkpoint BI-1 ("Metas e Ritmo"): introduz o primeiro conceito de papel
 * (`is_admin`) neste sistema — até aqui, qualquer usuário autenticado e
 * ativo podia operar qualquer recurso (Fase 1, "sem RBAC/ownership",
 * documentado em `mercado-livre-oauth.service.ts`). Necessário porque a
 * criação/alteração de meta mensal exige "somente administrador", e não
 * havia nenhum mecanismo real de papel no backend para isso — nunca uma
 * checagem inventada só no frontend.
 *
 * Puramente ADITIVA: coluna nova com `DEFAULT false`, nenhum usuário
 * promovido automaticamente por esta migration (nunca decide sozinha quem é
 * administrador). Promover o primeiro admin é uma ação operacional manual,
 * fora desta migration — ver README/relatório de implementação.
 */
export class UsersIsAdmin1788600000000 implements MigrationInterface {
  name = 'UsersIsAdmin1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "is_admin" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_admin"`);
  }
}
