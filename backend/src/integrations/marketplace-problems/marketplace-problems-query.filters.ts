import { BadRequestException } from '@nestjs/common';
import type { AccountScope } from '../../users/account-scope.types';
import type { ProblemsFilters } from './marketplace-problems.types';

export const INVALID_PROBLEMS_FILTER_MESSAGE = 'Filtro inválido.';

/** FROM/JOIN único das consultas de "Problemas" — lista, resumo e motivos partilham a MESMA base. */
export const PROBLEMS_FROM = `
  FROM marketplace_problems p
  JOIN marketplace_accounts a ON a.id = p.marketplace_account_id
  LEFT JOIN marketplace_orders mo ON mo.id = p.marketplace_order_id
  LEFT JOIN marketplace_problem_reasons r
    ON r.marketplace = a.marketplace
   AND r.site_id = p.site_id
   AND r.reason_id = p.reason_id`;

/**
 * Ação "pendente" = ação disponível ao VENDEDOR (`respondent`) num problema
 * ainda não resolvido. Fragmentos reutilizados pelo WHERE e pelo resumo.
 */
const SELLER_ACTION = `pa.marketplace_problem_id = p.id AND pa.player_role = 'respondent'`;
export const PENDING_ACTION_SQL = `(p.resolution_date IS NULL AND EXISTS (
  SELECT 1 FROM marketplace_problem_actions pa WHERE ${SELLER_ACTION}))`;
export const OVERDUE_ACTION_SQL = `(p.resolution_date IS NULL AND EXISTS (
  SELECT 1 FROM marketplace_problem_actions pa
   WHERE ${SELLER_ACTION} AND pa.due_date < now()))`;
const NEXT_7_DAYS_ACTION_SQL = `(p.resolution_date IS NULL AND EXISTS (
  SELECT 1 FROM marketplace_problem_actions pa
   WHERE ${SELLER_ACTION} AND pa.due_date >= now()
     AND pa.due_date < now() + interval '7 days'))`;

export interface ProblemsWhere {
  /** Sempre começa com `WHERE`. */
  sql: string;
  params: unknown[];
}

function assertRealDate(value: string): void {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(INVALID_PROBLEMS_FILTER_MESSAGE);
  }
}

/**
 * Monta o WHERE PARAMETRIZADO (nunca interpolação de valor do cliente) com o
 * account scope aplicado NA PRÓPRIA query. Devolve `null` quando o resultado
 * é vazio por construção (`NONE`, `SELECTED` vazio, ou `accountId` fora do
 * escopo) — o chamador responde vazio SEM consultar o banco e sem revelar
 * a existência de nada fora do escopo.
 */
export function buildProblemsWhere(
  filters: ProblemsFilters,
  scope: AccountScope,
): ProblemsWhere | null {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };

  if (scope.mode === 'NONE') return null;
  if (scope.mode === 'SELECTED') {
    if (scope.accountIds.length === 0) return null;
    if (filters.accountId && !scope.accountIds.includes(filters.accountId)) {
      return null;
    }
    add('p.marketplace_account_id = ANY(?::uuid[])', scope.accountIds);
  }
  if (filters.accountId) add('p.marketplace_account_id = ?', filters.accountId);
  if (filters.marketplace) add('a.marketplace = ?', filters.marketplace);

  if (filters.from) {
    assertRealDate(filters.from);
    add(
      `p.date_created >= (?::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'`,
      filters.from,
    );
  }
  if (filters.to) {
    assertRealDate(filters.to);
    add(
      `p.date_created < ((?::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
      filters.to,
    );
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new BadRequestException(INVALID_PROBLEMS_FILTER_MESSAGE);
  }

  if (filters.status) add('p.status = ?', filters.status);
  if (filters.type) add('p.type = ?', filters.type);
  if (filters.stage) add('p.stage = ?', filters.stage);
  if (filters.reasonId) add('p.reason_id = ?', filters.reasonId);
  if (filters.responsibility) {
    add('p.responsibility = ?', filters.responsibility);
  }
  if (filters.reputationImpact) {
    add('p.reputation_impact = ?', filters.reputationImpact);
  }
  if (filters.pendingAction === true) clauses.push(PENDING_ACTION_SQL);
  if (filters.pendingAction === false) {
    clauses.push(`NOT ${PENDING_ACTION_SQL}`);
  }
  if (filters.actionDue === 'overdue') clauses.push(OVERDUE_ACTION_SQL);
  if (filters.actionDue === 'next7days') clauses.push(NEXT_7_DAYS_ACTION_SQL);
  if (filters.orderId) {
    params.push(filters.orderId);
    const n = `$${params.length}`;
    clauses.push(`(mo.external_order_id = ${n} OR p.resource_id = ${n})`);
  }

  return {
    sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}
