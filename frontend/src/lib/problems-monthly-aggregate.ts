import { accountDisplayName } from "@/lib/problems-format";
import type { MonthCoverageLabel } from "@/lib/problems-monthly-format";
import type { ProblemsMonthlyCoverage, ProblemsMonthlyItemDto } from "@/types/problems";

export interface MonthlyTotals {
  totalProblems: number;
  totalOrders: number;
  openProblems: number;
  resolvedProblems: number;
  reputationImpactCount: number;
  /** soma dos problemas / soma dos pedidos × 100 — nunca média das taxas mensais. */
  problemsPer100Orders: number | null;
  resolutionRate: number | null;
  reputationImpactRate: number | null;
  averageResolutionHours: number | null;
  /** Alguma linha incluída não é COMPLETE: os números são provisórios. */
  partial: boolean;
}

const ratio = (part: number, whole: number): number | null =>
  whole > 0 ? (part / whole) * 100 : null;

export function aggregateMonthly(items: ProblemsMonthlyItemDto[]): MonthlyTotals {
  let totalProblems = 0;
  let totalOrders = 0;
  let openProblems = 0;
  let resolvedProblems = 0;
  let reputationImpactCount = 0;
  let weightedHours = 0;
  let hoursWeight = 0;
  for (const item of items) {
    totalProblems += item.totalProblems;
    totalOrders += item.totalOrders;
    openProblems += item.openProblems;
    resolvedProblems += item.resolvedProblems;
    reputationImpactCount += item.reputationImpactCount;
    if (item.averageResolutionHours !== null && item.resolvedProblems > 0) {
      weightedHours += item.averageResolutionHours * item.resolvedProblems;
      hoursWeight += item.resolvedProblems;
    }
  }
  return {
    totalProblems,
    totalOrders,
    openProblems,
    resolvedProblems,
    reputationImpactCount,
    problemsPer100Orders: ratio(totalProblems, totalOrders),
    resolutionRate: ratio(resolvedProblems, totalProblems),
    reputationImpactRate: ratio(reputationImpactCount, totalProblems),
    averageResolutionHours: hoursWeight > 0 ? weightedHours / hoursWeight : null,
    partial: items.some((item) => item.coverage !== "COMPLETE"),
  };
}

const COVERAGE_SEVERITY: Record<ProblemsMonthlyCoverage, number> = {
  COMPLETE: 0,
  PARTIAL: 1,
  UNKNOWN: 2,
};

/** Pior cobertura entre as linhas; sem linha = `NO_DATA` (nunca "completo" por omissão). */
export function worstCoverage(items: ProblemsMonthlyItemDto[]): MonthCoverageLabel {
  if (items.length === 0) return "NO_DATA";
  return items.reduce<ProblemsMonthlyCoverage>(
    (worst, item) => (COVERAGE_SEVERITY[item.coverage] > COVERAGE_SEVERITY[worst] ? item.coverage : worst),
    "COMPLETE",
  );
}

export interface AccountSeries {
  accountId: string;
  label: string;
  byMonth: Map<string, ProblemsMonthlyItemDto>;
}

export interface MonthlySeries {
  /** Meses em ordem cronológica, SEM buracos entre o primeiro e o último. */
  months: string[];
  accounts: AccountSeries[];
}

function monthRange(first: string, last: string): string[] {
  const months: string[] = [];
  let [year, month] = first.split("-").map(Number);
  const [lastYear, lastMonth] = last.split("-").map(Number);
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Mês ausente numa conta continua ausente (`byMonth.get` = undefined) — nunca vira zero. */
export function buildMonthlySeries(items: ProblemsMonthlyItemDto[]): MonthlySeries {
  const sorted = items.map((item) => item.yearMonth).sort();
  const months = sorted.length > 0 ? monthRange(sorted[0], sorted[sorted.length - 1]) : [];
  const accounts = new Map<string, AccountSeries>();
  for (const item of items) {
    const entry = accounts.get(item.accountId) ?? {
      accountId: item.accountId,
      label: accountDisplayName(item.accountNickname, item.marketplace),
      byMonth: new Map<string, ProblemsMonthlyItemDto>(),
    };
    entry.byMonth.set(item.yearMonth, item);
    accounts.set(item.accountId, entry);
  }
  return {
    months,
    accounts: [...accounts.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  };
}

export interface AccountComparisonRow {
  accountId: string;
  label: string;
  totals: MonthlyTotals;
  coverage: MonthCoverageLabel;
}

export function compareAccounts(series: MonthlySeries): AccountComparisonRow[] {
  return series.accounts.map((account) => {
    const rows = [...account.byMonth.values()];
    return { accountId: account.accountId, label: account.label, totals: aggregateMonthly(rows), coverage: worstCoverage(rows) };
  });
}

/** Linhas de um mês entre as contas da série (conta sem linha no mês não entra). */
export function itemsOfMonth(series: MonthlySeries, month: string): ProblemsMonthlyItemDto[] {
  return series.accounts.flatMap((account) => {
    const item = account.byMonth.get(month);
    return item ? [item] : [];
  });
}
