import type { QueryRunner } from 'typeorm';
import { deriveAdvisoryLockKey } from '../integrations/shared/advisory-lock.util';

/**
 * Chave FIXA (nenhuma variável de entrada) — de propósito: TODA operação
 * administrativa que possa reduzir o número de admins ativos precisa
 * serializar contra QUALQUER outra, nunca só contra a mesma linha/conta
 * (ao contrário do lock por `accountId` já usado no OAuth). Reaproveita a
 * mesma derivação sha256->bigint já usada por
 * `integrations/shared/advisory-lock.util.ts`, sem duplicar a técnica.
 */
const LAST_ADMIN_LOCK_KEY = deriveAdvisoryLockKey(
  'central-performance:last-admin-guard',
).toString();

export class LastActiveAdminRequiredError extends Error {
  constructor() {
    super('LAST_ACTIVE_ADMIN_REQUIRED');
    this.name = 'LastActiveAdminRequiredError';
  }
}

/**
 * `pg_advisory_xact_lock` (transaction-scoped — liberado sozinho no COMMIT
 * ou ROLLBACK, nunca precisa de unlock manual, ao contrário do lock
 * session-level do OAuth). Bloqueia até qualquer outra transação que também
 * chame isto liberar a sua — serializa a seção crítica "contar admins
 * ativos + decidir + escrever" contra concorrência real, mesmo sob READ
 * COMMITTED (o isolamento padrão do Postgres): a segunda transação só
 * consegue prosseguir DEPOIS que a primeira já commitou, então a contagem
 * que ela lê já reflete a escrita da primeira.
 */
export async function acquireLastAdminGuardLock(
  queryRunner: QueryRunner,
): Promise<void> {
  await queryRunner.query('SELECT pg_advisory_xact_lock($1::bigint)', [
    LAST_ADMIN_LOCK_KEY,
  ]);
}

/**
 * Deve ser chamada DEPOIS de `acquireLastAdminGuardLock`, dentro da mesma
 * transação, e SÓ quando `excludeUserId` já é hoje um admin ativo (o
 * chamador decide isso antes de gastar o lock). Conta quantos OUTROS
 * admins ativos existiriam — se zero, a operação removeria o último admin
 * ativo do sistema, e lança em vez de deixar prosseguir.
 */
export async function assertOtherActiveAdminExists(
  queryRunner: QueryRunner,
  adminRoleId: string,
  excludeUserId: string,
): Promise<void> {
  const rows = (await queryRunner.query(
    `SELECT count(*)::text AS count FROM "users"
     WHERE "role_id" = $1 AND "active" = true AND "id" != $2`,
    [adminRoleId, excludeUserId],
  )) as Array<{ count: string }>;

  if (Number(rows[0].count) === 0) {
    throw new LastActiveAdminRequiredError();
  }
}
