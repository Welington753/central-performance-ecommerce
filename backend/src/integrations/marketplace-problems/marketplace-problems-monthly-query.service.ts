import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AccountScope } from '../../users/account-scope.types';
import { MarketplaceProblemClaimQuarantineRepository } from './marketplace-problem-claim-quarantine.repository';
import { problemReasonLabel } from './marketplace-problem-reason-labels';
import {
  monthlyCoverage,
  percentage,
  problemsPer100Orders,
} from './marketplace-problems-monthly-coverage.util';
import {
  assertRealDate,
  INVALID_PROBLEMS_FILTER_MESSAGE,
} from './marketplace-problems-query.filters';
import type {
  ProblemsMonthlyDto,
  ProblemsMonthlyItemDto,
  ProblemsMonthlyReasonDto,
} from './marketplace-problems.types';

const TZ = 'America/Sao_Paulo';
const TOP_REASONS_PER_MONTH = 5;
/** Único marketplace com sincronização de problemas implementada. */
const SUPPORTED_MARKETPLACE = 'MERCADO_LIVRE';

export interface ProblemsMonthlyFilters {
  marketplace?: string;
  accountId?: string;
  /** `YYYY-MM-DD` (dia em America/Sao_Paulo, inclusivo). */
  dateFrom?: string;
  dateTo?: string;
}

type Row = Record<string, unknown>;

const monthKey = (column: string): string =>
  `to_char(${column} AT TIME ZONE '${TZ}', 'YYYY-MM')`;
const pair = (accountId: unknown, yearMonth: unknown): string =>
  `${String(accountId)}|${String(yearMonth)}`;
const roundTo = (value: number, digits: number): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Análise mensal de "Problemas" por conta (CP4). O mês de um problema é o da
 * sua DATA DE CRIAÇÃO e o de um pedido é `marketplace_orders.date_created`,
 * ambos em America/Sao_Paulo. O account scope é aplicado NA PRÓPRIA query
 * (nunca só pelo `accountId` do cliente) e a unicidade
 * `(conta, external_claim_id)` de `marketplace_problems` garante que um
 * problema conta uma vez. Quarentena não entra: não é problema sincronizado.
 * Somente leitura — nada aqui chama o Mercado Livre.
 */
@Injectable()
export class MarketplaceProblemsMonthlyQueryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly quarantine: MarketplaceProblemClaimQuarantineRepository,
  ) {}

  async monthly(
    filters: ProblemsMonthlyFilters,
    scope: AccountScope,
  ): Promise<ProblemsMonthlyDto> {
    const empty: ProblemsMonthlyDto = { timezone: TZ, items: [] };
    this.assertDates(filters);
    if (scope.mode === 'NONE') return empty;
    if (filters.marketplace && filters.marketplace !== SUPPORTED_MARKETPLACE) {
      return empty;
    }
    if (scope.mode === 'SELECTED') {
      if (scope.accountIds.length === 0) return empty;
      if (filters.accountId && !scope.accountIds.includes(filters.accountId)) {
        return empty;
      }
    }

    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const accountClauses: string[] = [
      `a.marketplace = ${bind(SUPPORTED_MARKETPLACE)}`,
    ];
    if (scope.mode === 'SELECTED') {
      accountClauses.push(`a.id = ANY(${bind(scope.accountIds)}::uuid[])`);
    }
    if (filters.accountId)
      accountClauses.push(`a.id = ${bind(filters.accountId)}`);
    const from = filters.dateFrom ? bind(filters.dateFrom) : null;
    const to = filters.dateTo ? bind(filters.dateTo) : null;
    const where = (column: string, extra?: string): string => {
      const clauses = [...accountClauses];
      if (from) {
        clauses.push(
          `${column} >= (${from}::date)::timestamp AT TIME ZONE '${TZ}'`,
        );
      }
      if (to) {
        clauses.push(
          `${column} < ((${to}::date + 1)::timestamp AT TIME ZONE '${TZ}')`,
        );
      }
      if (extra) clauses.push(extra);
      return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    };

    const months = await this.dataSource.query<Row[]>(
      `WITH pm AS (
         SELECT p.marketplace_account_id AS account_id, ${monthKey('p.date_created')} AS ym,
                count(*)::int AS total,
                count(*) FILTER (WHERE p.resolution_date IS NULL)::int AS open,
                count(*) FILTER (WHERE p.resolution_date IS NOT NULL)::int AS resolved,
                count(*) FILTER (WHERE p.reputation_impact = 'affected')::int AS reputation,
                avg(extract(epoch FROM (p.resolution_date - p.date_created)) / 3600.0)
                  FILTER (WHERE p.resolution_date IS NOT NULL
                            AND p.resolution_date >= p.date_created) AS avg_hours
           FROM marketplace_problems p
           JOIN marketplace_accounts a ON a.id = p.marketplace_account_id
           ${where('p.date_created')}
          GROUP BY 1, 2
       ), om AS (
         SELECT o.marketplace_account_id AS account_id, ${monthKey('o.date_created')} AS ym,
                count(*)::int AS orders
           FROM marketplace_orders o
           JOIN marketplace_accounts a ON a.id = o.marketplace_account_id
           ${where('o.date_created')}
          GROUP BY 1, 2
       )
       SELECT COALESCE(pm.account_id, om.account_id) AS account_id,
              COALESCE(pm.ym, om.ym) AS ym,
              COALESCE(pm.total, 0) AS total, COALESCE(pm.open, 0) AS open,
              COALESCE(pm.resolved, 0) AS resolved,
              COALESCE(pm.reputation, 0) AS reputation, pm.avg_hours,
              COALESCE(om.orders, 0) AS orders,
              ((COALESCE(pm.ym, om.ym) || '-01')::date::timestamp
                 AT TIME ZONE '${TZ}') AS month_start,
              (((COALESCE(pm.ym, om.ym) || '-01')::date + interval '1 month')::timestamp
                 AT TIME ZONE '${TZ}') AS month_end
         FROM pm FULL OUTER JOIN om ON om.account_id = pm.account_id AND om.ym = pm.ym
        ORDER BY ym, account_id`,
      params,
    );
    if (months.length === 0) return empty;

    const reasonRows = await this.dataSource.query<Row[]>(
      `SELECT account_id, ym, code, cnt FROM (
         SELECT account_id, ym, code, cnt,
                row_number() OVER (PARTITION BY account_id, ym ORDER BY cnt DESC, code) AS rn
           FROM (
             SELECT p.marketplace_account_id AS account_id,
                    ${monthKey('p.date_created')} AS ym,
                    COALESCE(r.name, p.reason_id) AS code, count(*)::int AS cnt
               FROM marketplace_problems p
               JOIN marketplace_accounts a ON a.id = p.marketplace_account_id
               LEFT JOIN marketplace_problem_reasons r
                 ON r.marketplace = a.marketplace AND r.site_id = p.site_id
                AND r.reason_id = p.reason_id
               ${where('p.date_created', 'p.reason_id IS NOT NULL')}
              GROUP BY 1, 2, 3
           ) g
       ) t WHERE rn <= ${TOP_REASONS_PER_MONTH}
       ORDER BY account_id, ym, rn`,
      params,
    );
    const reasonsByKey = new Map<string, ProblemsMonthlyReasonDto[]>();
    for (const row of reasonRows) {
      const key = pair(row.account_id, row.ym);
      const list = reasonsByKey.get(key) ?? [];
      const code = String(row.code);
      list.push({
        code,
        label: problemReasonLabel(code),
        count: Number(row.cnt),
      });
      reasonsByKey.set(key, list);
    }

    const accountIds = [...new Set(months.map((m) => String(m.account_id)))];
    const accounts = await this.loadAccounts(accountIds);
    const pending = await this.quarantine.pendingSummaryByAccount(accountIds);

    const items = months.map((row): ProblemsMonthlyItemDto => {
      const accountId = String(row.account_id);
      const account = accounts.get(accountId);
      const totalProblems = Number(row.total);
      const totalOrders = Number(row.orders);
      const quarantine = pending.get(accountId);
      const inMonth = quarantine?.byMonth.get(String(row.ym)) ?? 0;
      const unknownDate = quarantine?.unknownDate ?? 0;
      const coverage = monthlyCoverage({
        monthStart: row.month_start as Date,
        monthEnd: row.month_end as Date,
        coverage: account?.coverage ?? null,
        quarantinedInMonth: inMonth,
        quarantinedUnknownDate: unknownDate,
      });
      const resolved = Number(row.resolved);
      return {
        yearMonth: String(row.ym),
        accountId,
        accountNickname: account?.nickname ?? null,
        marketplace: account?.marketplace ?? '',
        totalProblems,
        openProblems: Number(row.open),
        resolvedProblems: resolved,
        reputationImpactCount: Number(row.reputation),
        totalOrders,
        problemsPer100Orders: problemsPer100Orders(totalProblems, totalOrders),
        resolutionRate: percentage(resolved, totalProblems),
        averageResolutionHours:
          row.avg_hours === null || row.avg_hours === undefined
            ? null
            : roundTo(Number(row.avg_hours), 2),
        topReasons: reasonsByKey.get(pair(accountId, row.ym)) ?? [],
        coverage,
        rateDefinitive: coverage === 'COMPLETE' && totalOrders > 0,
        quarantinedClaimsCount: quarantine?.total ?? 0,
        quarantinedClaimsInMonthCount: inMonth,
        quarantinedUnknownDateCount: unknownDate,
      };
    });
    items.sort(
      (a, b) =>
        a.yearMonth.localeCompare(b.yearMonth) ||
        (a.accountNickname ?? '￿').localeCompare(b.accountNickname ?? '￿') ||
        a.accountId.localeCompare(b.accountId),
    );
    return { timezone: TZ, items };
  }

  private assertDates(filters: ProblemsMonthlyFilters): void {
    if (filters.dateFrom) assertRealDate(filters.dateFrom);
    if (filters.dateTo) assertRealDate(filters.dateTo);
    if (
      filters.dateFrom &&
      filters.dateTo &&
      filters.dateFrom > filters.dateTo
    ) {
      throw new BadRequestException(INVALID_PROBLEMS_FILTER_MESSAGE);
    }
  }

  private async loadAccounts(accountIds: string[]): Promise<
    Map<
      string,
      {
        nickname: string | null;
        marketplace: string;
        coverage: { coveredFrom: Date; coveredThrough: Date } | null;
      }
    >
  > {
    const rows = await this.dataSource.query<Row[]>(
      `SELECT a.id, a.nickname, a.marketplace,
              j.historical_covered_from, j.window_cursor_at
         FROM marketplace_accounts a
         LEFT JOIN marketplace_problems_sync_jobs j ON j.marketplace_account_id = a.id
        WHERE a.id = ANY($1::uuid[])`,
      [accountIds],
    );
    return new Map(
      rows.map((row) => [
        String(row.id),
        {
          nickname: typeof row.nickname === 'string' ? row.nickname : null,
          marketplace: String(row.marketplace),
          coverage:
            row.historical_covered_from instanceof Date &&
            row.window_cursor_at instanceof Date
              ? {
                  coveredFrom: row.historical_covered_from,
                  coveredThrough: row.window_cursor_at,
                }
              : null,
        },
      ]),
    );
  }
}
