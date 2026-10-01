import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AccountScope } from '../../users/account-scope.types';
import {
  buildProblemsWhere,
  OVERDUE_ACTION_SQL,
  PENDING_ACTION_SQL,
  PROBLEMS_FROM,
  type ProblemsWhere,
} from './marketplace-problems-query.filters';
import type {
  MarketplaceProblemsHistoricalStatus,
  MarketplaceProblemsSyncJobStatus,
} from './marketplace-problems-sync-jobs.types';
import type {
  ProblemReasonOptionDto,
  ProblemResponsibility,
  ProblemsCoverageAccountDto,
  ProblemsFilters,
  ProblemsSummaryDto,
} from './marketplace-problems.types';

const TOP_REASONS_LIMIT = 10;
const REASON_OPTIONS_LIMIT = 200;
/** Único marketplace com sincronização de problemas implementada. */
const SUPPORTED_MARKETPLACE = 'MERCADO_LIVRE';

type Row = Record<string, unknown>;

const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : null;

function withCondition(where: ProblemsWhere, condition: string): string {
  return where.sql ? `${where.sql} AND ${condition}` : `WHERE ${condition}`;
}

/**
 * Resumo e motivos de "Problemas" — usam a MESMA construção de WHERE
 * (`buildProblemsWhere`, com account scope na query) da lista, então os
 * números sempre batem com o que a tabela mostra para os mesmos filtros.
 */
@Injectable()
export class MarketplaceProblemsSummaryQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async summary(
    filters: ProblemsFilters,
    scope: AccountScope,
  ): Promise<ProblemsSummaryDto> {
    const coverage = await this.coverage(filters, scope);
    const where = buildProblemsWhere(filters, scope);
    if (where === null) {
      return {
        total: 0,
        open: 0,
        resolved: 0,
        reputationAffected: 0,
        pendingAction: 0,
        overdueAction: 0,
        unknownResponsibility: 0,
        byResponsibility: [],
        topReasons: [],
        coverage,
      };
    }
    const [totals] = await this.dataSource.query<Row[]>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE p.resolution_date IS NULL)::int AS open,
              count(*) FILTER (WHERE p.resolution_date IS NOT NULL)::int AS resolved,
              count(*) FILTER (WHERE p.reputation_impact = 'affected')::int AS reputation_affected,
              count(*) FILTER (WHERE ${PENDING_ACTION_SQL})::int AS pending_action,
              count(*) FILTER (WHERE ${OVERDUE_ACTION_SQL})::int AS overdue_action,
              count(*) FILTER (WHERE p.responsibility = 'UNKNOWN')::int AS unknown_responsibility
         ${PROBLEMS_FROM} ${where.sql}`,
      where.params,
    );
    const byResponsibility = await this.dataSource.query<Row[]>(
      `SELECT p.responsibility, count(*)::int AS count
         ${PROBLEMS_FROM} ${where.sql}
        GROUP BY p.responsibility ORDER BY count DESC, p.responsibility`,
      where.params,
    );
    return {
      total: Number(totals.total),
      open: Number(totals.open),
      resolved: Number(totals.resolved),
      reputationAffected: Number(totals.reputation_affected),
      pendingAction: Number(totals.pending_action),
      overdueAction: Number(totals.overdue_action),
      unknownResponsibility: Number(totals.unknown_responsibility),
      byResponsibility: byResponsibility.map((row) => ({
        responsibility: row.responsibility as ProblemResponsibility,
        count: Number(row.count),
      })),
      topReasons: await this.reasons(filters, scope, TOP_REASONS_LIMIT),
      coverage,
    };
  }

  /** Motivos presentes no recorte filtrado (mesmos filtros/escopo do resumo e da lista). */
  async reasons(
    filters: ProblemsFilters,
    scope: AccountScope,
    limit: number = REASON_OPTIONS_LIMIT,
  ): Promise<ProblemReasonOptionDto[]> {
    const where = buildProblemsWhere(filters, scope);
    if (where === null) return [];
    const rows = await this.dataSource.query<Row[]>(
      `SELECT p.reason_id, max(r.name) AS name, count(*)::int AS count
         ${PROBLEMS_FROM}
        ${withCondition(where, 'p.reason_id IS NOT NULL')}
        GROUP BY p.reason_id
        ORDER BY count DESC, p.reason_id
        LIMIT $${where.params.length + 1}`,
      [...where.params, limit],
    );
    return rows.map((row) => ({
      reasonId: row.reason_id as string,
      name: typeof row.name === 'string' ? row.name : null,
      count: Number(row.count),
    }));
  }

  /**
   * Cobertura por conta (contas Mercado Livre no escopo) — honesta: mostra o
   * início da próxima janela do job e o último censo COMPLETO; `NOT_STARTED`
   * quando o job nunca foi iniciado. Respeita escopo, conta e marketplace.
   */
  private async coverage(
    filters: ProblemsFilters,
    scope: AccountScope,
  ): Promise<ProblemsCoverageAccountDto[]> {
    if (scope.mode === 'NONE') return [];
    if (scope.mode === 'SELECTED' && scope.accountIds.length === 0) return [];
    if (filters.marketplace && filters.marketplace !== SUPPORTED_MARKETPLACE) {
      return [];
    }
    const params: unknown[] = [SUPPORTED_MARKETPLACE];
    const clauses = ['a.marketplace = $1'];
    if (scope.mode === 'SELECTED') {
      params.push(scope.accountIds);
      clauses.push(`a.id = ANY($${params.length}::uuid[])`);
    }
    if (filters.accountId) {
      params.push(filters.accountId);
      clauses.push(`a.id = $${params.length}`);
    }
    const rows = await this.dataSource.query<Row[]>(
      `SELECT a.id, a.nickname, a.marketplace,
              COALESCE(pc.total, 0)::int AS total, COALESCE(pc.open, 0)::int AS open,
              j.status, j.window_cursor_at, j.last_census_at, j.last_activity_at,
              j.last_error_code, j.historical_covered_from, j.historical_target_from,
              j.historical_status, j.historical_completed_at,
              j.historical_last_error_code,
              COALESCE(qc.pending, 0)::int AS quarantined
         FROM marketplace_accounts a
         LEFT JOIN marketplace_problems_sync_jobs j ON j.marketplace_account_id = a.id
         LEFT JOIN (
           SELECT marketplace_account_id, count(*) AS total,
                  count(*) FILTER (WHERE resolution_date IS NULL) AS open
             FROM marketplace_problems GROUP BY marketplace_account_id
         ) pc ON pc.marketplace_account_id = a.id
         LEFT JOIN (
           SELECT marketplace_account_id, count(*) AS pending
             FROM marketplace_problem_claim_quarantine
            WHERE resolved_at IS NULL GROUP BY marketplace_account_id
         ) qc ON qc.marketplace_account_id = a.id
        WHERE ${clauses.join(' AND ')}
        ORDER BY a.nickname NULLS LAST, a.id`,
      params,
    );
    return rows.map((row) => ({
      accountId: row.id as string,
      accountNickname: typeof row.nickname === 'string' ? row.nickname : null,
      marketplace: row.marketplace as string,
      problemsTotal: Number(row.total),
      problemsOpen: Number(row.open),
      jobStatus:
        (row.status as MarketplaceProblemsSyncJobStatus | null) ??
        'NOT_STARTED',
      windowCursorAt: iso(row.window_cursor_at),
      lastCompleteCensusAt: iso(row.last_census_at),
      lastActivityAt: iso(row.last_activity_at),
      lastErrorCode:
        typeof row.last_error_code === 'string' ? row.last_error_code : null,
      incrementalCoveredThrough: iso(row.window_cursor_at),
      historicalCoveredFrom: iso(row.historical_covered_from),
      historicalTargetFrom: iso(row.historical_target_from),
      historicalCompletedAt: iso(row.historical_completed_at),
      historicalStatus:
        (row.historical_status as MarketplaceProblemsHistoricalStatus | null) ??
        'NOT_STARTED',
      historicalLastErrorCode:
        typeof row.historical_last_error_code === 'string'
          ? row.historical_last_error_code
          : null,
      quarantinedClaimsCount: Number(row.quarantined),
    }));
  }
}
