import { formatBRL } from "@/lib/kpi-format";

/** UNAVAILABLE (`null`) some sempre como texto explícito — nunca "R$ 0,00" fingindo ser um valor medido. */
export const UNAVAILABLE_LABEL = "Indisponível";

export function formatBRLOrUnavailable(value: string | null): string {
  return value === null ? UNAVAILABLE_LABEL : formatBRL(value);
}

/** Percentual de meta atingida — pode passar de 100%, nunca tem sinal +/- (não é uma variação). */
export function formatAchievementPercentage(value: number | null): string {
  if (value === null) return UNAVAILABLE_LABEL;
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

const MONTH_LABELS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function formatMonthYearLabel(year: number, month: number): string {
  const label = MONTH_LABELS[month - 1] ?? String(month);
  return `${label} de ${year}`;
}
