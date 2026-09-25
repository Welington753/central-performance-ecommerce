import { formatBRL, formatDateTimeSaoPaulo } from "@/lib/kpi-format";

export const NOT_AVAILABLE = "N/D";

/** Ausência nunca vira "R$ 0,00". */
export function formatMoneyOrNA(value: string | null): string {
  return value === null ? NOT_AVAILABLE : formatBRL(value);
}

export function formatRatioOrNA(value: number | null): string {
  if (value === null) return NOT_AVAILABLE;
  return `${(value * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export function formatDateOrNA(value: string | null): string {
  return formatDateTimeSaoPaulo(value) ?? NOT_AVAILABLE;
}

export function textOrNA(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? NOT_AVAILABLE : value;
}
