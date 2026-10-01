export type ProblemsPeriodPreset = "3m" | "6m" | "12m" | "year" | "all" | "custom";

export const DEFAULT_PERIOD_PRESET: ProblemsPeriodPreset = "12m";

export const PERIOD_OPTIONS: Array<{ value: ProblemsPeriodPreset; label: string }> = [
  { value: "3m", label: "Últimos 3 meses" },
  { value: "6m", label: "Últimos 6 meses" },
  { value: "12m", label: "Últimos 12 meses" },
  { value: "year", label: "Ano atual" },
  { value: "all", label: "Todo o histórico" },
  { value: "custom", label: "Personalizado" },
];

export interface ProblemsPeriod {
  preset: ProblemsPeriodPreset;
  /** Só usados em `custom` (`YYYY-MM-DD`). */
  customFrom: string;
  customTo: string;
}

export const DEFAULT_PERIOD: ProblemsPeriod = {
  preset: DEFAULT_PERIOD_PRESET,
  customFrom: "",
  customTo: "",
};

export interface PeriodRange {
  /** `YYYY-MM-DD` em America/Sao_Paulo; vazio = sem limite. */
  dateFrom: string;
  dateTo: string;
}

const MONTHS_BY_PRESET: Partial<Record<ProblemsPeriodPreset, number>> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

const spFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Ano e mês (1–12) de hoje em America/Sao_Paulo — nunca o fuso do navegador. */
function spYearMonth(now: Date): { year: number; month: number } {
  const [year, month] = spFormatter.format(now).split("-").map(Number);
  return { year, month };
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Janela em MESES CHEIOS, sempre a partir do dia 1 (a análise é mensal). O mês
 * corrente conta como o último: "Últimos 12 meses" = mês corrente + 11 meses
 * anteriores (em 15/09/2026: 01/10/2025 em diante); 3 e 6 seguem a mesma regra.
 * "Ano atual" = 01/01 do ano corrente. Os dias são INCLUSIVOS e calculados em
 * America/Sao_Paulo (nunca no fuso do navegador); o fim fica em aberto (hoje).
 * "Personalizado" repassa as datas escolhidas, ambas inclusivas.
 */
export function periodRange(period: ProblemsPeriod, now: Date = new Date()): PeriodRange {
  if (period.preset === "all") return { dateFrom: "", dateTo: "" };
  if (period.preset === "custom") {
    return { dateFrom: period.customFrom, dateTo: period.customTo };
  }
  const { year, month } = spYearMonth(now);
  if (period.preset === "year") return { dateFrom: `${year}-01-01`, dateTo: "" };
  const months = MONTHS_BY_PRESET[period.preset] ?? 12;
  const index = year * 12 + (month - 1) - (months - 1);
  return { dateFrom: `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`, dateTo: "" };
}

/** Período personalizado só é aplicável com datas coerentes (inicial <= final quando ambas existem). */
export function customPeriodError(period: ProblemsPeriod): string | null {
  if (period.preset !== "custom") return null;
  if (period.customFrom && period.customTo && period.customFrom > period.customTo) {
    return "A data inicial não pode ser posterior à data final.";
  }
  return null;
}
