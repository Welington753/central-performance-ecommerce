import type { ProblemsMonthlyCoverage, ProblemsHistoricalStatus } from "@/types/problems";

export const NOT_AVAILABLE = "N/D";

const MONTH_ABBREVIATIONS = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];

export function formatInteger(value: number | null): string {
  return value === null ? NOT_AVAILABLE : value.toLocaleString("pt-BR");
}

/** Número com até 2 casas decimais, separador pt-BR. */
export function formatDecimal(value: number | null): string {
  return value === null
    ? NOT_AVAILABLE
    : value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function formatPercent(value: number | null): string {
  return value === null ? NOT_AVAILABLE : `${formatDecimal(value)}%`;
}

/** Duração média: horas até 48h, depois dias — sempre com no máximo 1 casa. */
export function formatDuration(hours: number | null): string {
  if (hours === null) return NOT_AVAILABLE;
  if (hours < 48) return `${hours.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
  return `${(hours / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`;
}

/** `2026-05` → `mai/2026` (sem `Date`: o fuso do navegador nunca desloca o mês). */
export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return `${MONTH_ABBREVIATIONS[Number(month) - 1] ?? month}/${year}`;
}

export type MonthCoverageLabel = ProblemsMonthlyCoverage | "NO_DATA";

export const COVERAGE_LABELS: Record<MonthCoverageLabel, string> = {
  COMPLETE: "Completo",
  PARTIAL: "Parcial",
  UNKNOWN: "Indeterminado",
  NO_DATA: "Sem dados",
};

export const HISTORICAL_STATUS_LABELS: Record<ProblemsHistoricalStatus, string> = {
  COMPLETED: "Completo",
  RUNNING: "Em andamento",
  PAUSED: "Pausado",
  NO_TARGET: "Sem alvo",
  FAILED: "Erro",
  NOT_STARTED: "Não iniciado",
};
