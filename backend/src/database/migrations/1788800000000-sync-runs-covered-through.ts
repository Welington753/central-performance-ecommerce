import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkpoint CP2K-5C-1 ("fundação PARTIAL"): coluna aditiva e opcional,
 * nunca alterando nenhuma coluna/constraint/status existente de
 * `sync_runs`. `covered_through` representa até onde a janela requisitada
 * (`date_from`/`date_to`, inalterados) foi de fato ENUMERADA POR INTEIRO
 * quando um safety cap interrompe uma sincronização — nunca a janela
 * requisitada inteira, nunca inferido de `date_to`.
 *
 * `NULL` (o único valor possível em toda linha pré-existente, já que a
 * coluna nasce sem valor) representa "nenhum prefixo da janela foi provado"
 * — nenhum backfill necessário, nenhum default.
 *
 * O CHECK só garante a FAIXA (`covered_through` dentro de
 * `[date_from, date_to]` quando não nulo) — nunca amarra a um `status`
 * específico, porque `sync_runs.status` é `varchar` livre sem CHECK próprio
 * (schema pré-existente com dados reais, fora de escopo alterar agora).
 * Proteção contra cobertura FALSA: sem isto, uma escrita futura com
 * `covered_through` fora da janela reivindicaria cobertura inexistente,
 * violando o invariante central deste checkpoint ("nenhuma lacuna").
 */
export class SyncRunsCoveredThrough1788800000000 implements MigrationInterface {
  name = 'SyncRunsCoveredThrough1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sync_runs"
        ADD COLUMN "covered_through" TIMESTAMPTZ,
        ADD CONSTRAINT "CK_sync_runs_covered_through_within_period" CHECK (
          "covered_through" IS NULL OR (
            "date_from" IS NOT NULL
            AND "date_to" IS NOT NULL
            AND "covered_through" >= "date_from"
            AND "covered_through" <= "date_to"
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sync_runs"
        DROP CONSTRAINT IF EXISTS "CK_sync_runs_covered_through_within_period"
    `);
    await queryRunner.query(`
      ALTER TABLE "sync_runs"
        DROP COLUMN IF EXISTS "covered_through"
    `);
  }
}
