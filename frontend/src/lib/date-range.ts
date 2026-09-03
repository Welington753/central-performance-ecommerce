/**
 * Utilitários de período (Checkpoint 2, "Filtro por data") — espelham
 * exatamente a semântica do backend (`period.util.ts`): dias-calendário em
 * `America/Sao_Paulo`, deslocamento fixo -03:00 (sem horário de verão desde
 * 2019, mesma premissa documentada no backend). Nenhuma lib de fuso horário.
 */

const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Fase 4 ("Todo o período"): sem limite artificial de ~1 ano no
// personalizado — mantém apenas um teto de sanidade bem acima de qualquer
// intervalo real (espelha `NO_PRACTICAL_RANGE_CAP_DAYS` no backend,
// `marketplace-analytics.service.ts`), nunca usado como cálculo de negócio.
export const MAX_RANGE_DAYS = 36500;

export interface DateOnly {
  year: number;
  month: number;
  day: number;
}

export function todaySaoPaulo(now: Date = new Date()): DateOnly {
  const shifted = new Date(now.getTime() - SAO_PAULO_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function dateOnlyToString(date: DateOnly): string {
  const y = String(date.year).padStart(4, "0");
  const m = String(date.month).padStart(2, "0");
  const d = String(date.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `null` quando o formato é inválido ou a data não existe no calendário. */
export function parseDateOnly(value: string): DateOnly | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const isReal =
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;

  return isReal ? { year, month, day } : null;
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const base = Date.UTC(date.year, date.month - 1, date.day);
  const shifted = new Date(base + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function diffDaysInclusive(from: DateOnly, to: DateOnly): number {
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / DAY_MS) + 1;
}

export interface DateRange {
  from: DateOnly;
  to: DateOnly;
}

export type PeriodPresetKey =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth";

export const PERIOD_PRESETS: Array<{ key: PeriodPresetKey; label: string }> = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "last7", label: "Últimos 7 dias" },
  { key: "last30", label: "Últimos 30 dias" },
  { key: "thisMonth", label: "Mês atual" },
  { key: "lastMonth", label: "Mês anterior" },
];

export function resolvePreset(
  key: PeriodPresetKey,
  now: Date = new Date(),
): DateRange {
  const today = todaySaoPaulo(now);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "thisMonth":
      return { from: { ...today, day: 1 }, to: today };
    case "lastMonth": {
      const firstOfThisMonth = { ...today, day: 1 };
      const lastOfPrevMonth = addDays(firstOfThisMonth, -1);
      const firstOfPrevMonth = { ...lastOfPrevMonth, day: 1 };
      return { from: firstOfPrevMonth, to: lastOfPrevMonth };
    }
  }
}

export type DateRangeErrorCode =
  | "INVALID_FORMAT"
  | "FROM_AFTER_TO"
  | "TO_IN_FUTURE"
  | "RANGE_TOO_LONG";

export const DATE_RANGE_ERROR_MESSAGES: Record<DateRangeErrorCode, string> = {
  INVALID_FORMAT: "Use o formato AAAA-MM-DD para as duas datas.",
  FROM_AFTER_TO: 'A "data inicial" não pode ser depois da "data final".',
  TO_IN_FUTURE: 'A "data final" não pode estar no futuro.',
  RANGE_TOO_LONG: `O período não pode ter mais de ${MAX_RANGE_DAYS} dias.`,
};

export type ValidateDateRangeResult =
  | { valid: true; range: DateRange }
  | { valid: false; error: DateRangeErrorCode };

export function validateDateRangeStrings(
  fromStr: string,
  toStr: string,
  now: Date = new Date(),
): ValidateDateRangeResult {
  const from = parseDateOnly(fromStr);
  const to = parseDateOnly(toStr);
  if (!from || !to) return { valid: false, error: "INVALID_FORMAT" };

  if (compareDateOnly(from, to) > 0) {
    return { valid: false, error: "FROM_AFTER_TO" };
  }
  const today = todaySaoPaulo(now);
  if (compareDateOnly(to, today) > 0) {
    return { valid: false, error: "TO_IN_FUTURE" };
  }
  if (diffDaysInclusive(from, to) > MAX_RANGE_DAYS) {
    return { valid: false, error: "RANGE_TOO_LONG" };
  }
  return { valid: true, range: { from, to } };
}
