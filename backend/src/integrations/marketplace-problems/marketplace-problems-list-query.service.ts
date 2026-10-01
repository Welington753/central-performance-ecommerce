import { problemReasonLabel } from './marketplace-problem-reason-labels';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AccountScope } from '../../users/account-scope.types';
import {
  buildProblemsWhere,
  PROBLEMS_FROM,
} from './marketplace-problems-query.filters';
import type {
  ProblemActionDto,
  ProblemDetailDto,
  ProblemListItemDto,
  ProblemResponsibility,
  ProblemSortField,
  ProblemsFilters,
  ProblemsPageDto,
} from './marketplace-problems.types';

/** 404 GENÉRICO e idêntico para "inexistente" e "fora do account scope". */
export const PROBLEM_NOT_FOUND_MESSAGE = 'Problema não encontrado.';

const DEFAULT_PAGE_SIZE = 25;

/** Allowlist: o nome da coluna nunca vem do cliente. */
const SORT_COLUMNS: Record<ProblemSortField, string> = {
  dateCreated: 'p.date_created',
  lastUpdated: 'p.last_updated',
  nextActionDueDate: 'na.due_date',
};

/** Próxima ação do VENDEDOR (a de vencimento mais próximo) + total de ações pendentes. */
const NEXT_ACTION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT pa.action_code, pa.due_date, count(*) OVER () AS pending_count
      FROM marketplace_problem_actions pa
     WHERE pa.marketplace_problem_id = p.id
       AND pa.player_role = 'respondent'
       AND p.resolution_date IS NULL
     ORDER BY pa.due_date ASC NULLS LAST, pa.mandatory DESC, pa.id
     LIMIT 1
  ) na ON true`;

const LIST_COLUMNS = `
  p.id, a.marketplace, p.marketplace_account_id AS account_id,
  a.nickname AS account_nickname,
  COALESCE(mo.external_order_id,
           CASE WHEN p.resource = 'order' THEN p.resource_id END) AS order_external_id,
  p.status, p.stage, p.type, p.reason_id, r.name AS reason_name,
  p.date_created, p.last_updated, p.resolution_date, p.reputation_impact,
  na.action_code AS next_action_code, na.due_date AS next_action_due_date,
  COALESCE(na.pending_count, 0) AS pending_actions_count,
  p.responsibility, p.responsibility_confidence`;

const DETAIL_COLUMNS = `${LIST_COLUMNS},
  p.external_claim_id, r.flow AS reason_flow, r.detail AS reason_detail,
  p.detail_title, p.detail_problem, p.detail_responsible, p.detail_due_date,
  p.reputation_has_incentive, p.reputation_due_date, p.resolution_reason,
  p.resolution_closed_by, p.last_checked_at, p.responsibility_source,
  p.responsibility_overridden_at, p.responsibility_override_reason,
  mo.status AS order_status`;

type Row = Record<string, unknown>;

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : null;
const str = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** Código = nome do motivo no cache (ou o `reason_id`); rótulo SEMPRE do catálogo central. */
function reasonLabelOf(
  reasonId: string | null,
  name: string | null,
): string | null {
  const code = name ?? reasonId;
  return code === null ? null : problemReasonLabel(code);
}

function mapListItem(row: Row): ProblemListItemDto {
  return {
    id: row.id as string,
    marketplace: row.marketplace as string,
    accountId: row.account_id as string,
    accountNickname: str(row.account_nickname),
    orderExternalId: str(row.order_external_id),
    status: row.status as string,
    stage: row.stage as string,
    type: row.type as string,
    reasonId: str(row.reason_id),
    reasonName: str(row.reason_name),
    reasonLabel: reasonLabelOf(str(row.reason_id), str(row.reason_name)),
    dateCreated: iso(row.date_created) as string,
    lastUpdated: iso(row.last_updated) as string,
    resolutionDate: iso(row.resolution_date),
    reputationImpact: str(row.reputation_impact),
    nextActionCode: str(row.next_action_code),
    nextActionDueDate: iso(row.next_action_due_date),
    pendingActionsCount: Number(row.pending_actions_count),
    responsibility: row.responsibility as ProblemResponsibility,
    responsibilityConfidence: row.responsibility_confidence as string,
  };
}

/**
 * Consultas paginadas de "Problemas" (lista e detalhe) — SEMPRE no
 * PostgreSQL, com o account scope aplicado na própria query (nunca filtragem
 * em memória). Só devolve campos necessários: nenhum token, payload bruto ou
 * PII (sem comprador, endereço, mensagens nem `detail_description`).
 */
@Injectable()
export class MarketplaceProblemsListQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(
    filters: ProblemsFilters,
    scope: AccountScope,
    paging: {
      page?: number;
      pageSize?: number;
      sortBy?: ProblemSortField;
      sortDir?: 'asc' | 'desc';
    },
  ): Promise<ProblemsPageDto> {
    const page = paging.page ?? 1;
    const pageSize = paging.pageSize ?? DEFAULT_PAGE_SIZE;
    const empty: ProblemsPageDto = {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
    };
    const where = buildProblemsWhere(filters, scope);
    if (where === null) return empty;

    const [{ total }] = await this.dataSource.query<Array<{ total: string }>>(
      `SELECT count(*) AS total ${PROBLEMS_FROM} ${where.sql}`,
      where.params,
    );
    const totalCount = Number(total);
    if (totalCount === 0) return empty;

    const dir = paging.sortDir === 'asc' ? 'ASC' : 'DESC';
    const column = SORT_COLUMNS[paging.sortBy ?? 'dateCreated'];
    const limitIdx = where.params.length + 1;
    const rows = await this.dataSource.query<Row[]>(
      `SELECT ${LIST_COLUMNS} ${PROBLEMS_FROM} ${NEXT_ACTION_JOIN} ${where.sql}
        ORDER BY ${column} ${dir} NULLS LAST, p.id ${dir}
        LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
      [...where.params, pageSize, (page - 1) * pageSize],
    );
    return {
      items: rows.map(mapListItem),
      page,
      pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }

  /**
   * Detalhe por id com o scope na MESMA query: um id inexistente e um id de
   * conta fora do escopo produzem exatamente a mesma resposta (404 genérico).
   */
  async findOne(id: string, scope: AccountScope): Promise<ProblemDetailDto> {
    const where = buildProblemsWhere({}, scope);
    if (where === null) throw new NotFoundException(PROBLEM_NOT_FOUND_MESSAGE);
    const idParam = `$${where.params.length + 1}`;
    const condition = where.sql
      ? `${where.sql} AND p.id = ${idParam}`
      : `WHERE p.id = ${idParam}`;

    const rows = await this.dataSource.query<Row[]>(
      `SELECT ${DETAIL_COLUMNS} ${PROBLEMS_FROM} ${NEXT_ACTION_JOIN} ${condition}`,
      [...where.params, id],
    );
    if (rows.length === 0)
      throw new NotFoundException(PROBLEM_NOT_FOUND_MESSAGE);
    const row = rows[0];

    const actionRows = await this.dataSource.query<Row[]>(
      `SELECT player_role, action_code, mandatory, due_date
         FROM marketplace_problem_actions
        WHERE marketplace_problem_id = $1
        ORDER BY due_date ASC NULLS LAST, mandatory DESC, id`,
      [id],
    );
    const actions: ProblemActionDto[] = actionRows.map((action) => ({
      playerRole: action.player_role as string,
      actionCode: action.action_code as string,
      mandatory: action.mandatory as boolean,
      dueDate: iso(action.due_date),
    }));
    const orderStatus = str(row.order_status);
    const orderExternalId = str(row.order_external_id);
    return {
      ...mapListItem(row),
      externalClaimId: row.external_claim_id as string,
      reasonFlow: str(row.reason_flow),
      reasonDetail: str(row.reason_detail),
      detailTitle: str(row.detail_title),
      detailProblem: str(row.detail_problem),
      detailResponsible: str(row.detail_responsible),
      detailDueDate: iso(row.detail_due_date),
      reputationHasIncentive:
        typeof row.reputation_has_incentive === 'boolean'
          ? row.reputation_has_incentive
          : null,
      reputationDueDate: iso(row.reputation_due_date),
      resolutionReason: str(row.resolution_reason),
      resolutionClosedBy: str(row.resolution_closed_by),
      lastCheckedAt: iso(row.last_checked_at),
      actions,
      // Pedido associado só quando existe de fato (`marketplace_order_id`).
      order:
        orderStatus !== null && orderExternalId !== null
          ? { externalOrderId: orderExternalId, status: orderStatus }
          : null,
      responsibilitySource: str(row.responsibility_source),
      responsibilityOverriddenAt: iso(row.responsibility_overridden_at),
      responsibilityOverrideReason: str(row.responsibility_override_reason),
    };
  }
}
