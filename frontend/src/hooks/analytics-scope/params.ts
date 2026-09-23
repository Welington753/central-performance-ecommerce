import {
  DATE_RANGE_ERROR_MESSAGES,
  dateOnlyToString,
  resolvePreset,
  validateDateRangeStrings,
} from "@/lib/date-range";
import type {
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

/**
 * Leitura/normalização pura dos parâmetros de URL do escopo de analytics
 * (período, marketplace, conta, filtro logístico) — nenhum estado, nenhum
 * efeito, só funções puras reutilizadas pelo hook de orquestração.
 */

export type PeriodState =
  | { kind: "default" }
  | { kind: "valid"; from: string; to: string }
  | { kind: "invalid"; message: string };

const MARKETPLACE_FILTER_VALUES: MarketplaceFilter[] = [
  "ALL",
  "MERCADO_LIVRE",
  "AMAZON",
  "SHOPEE",
];

const LOGISTICS_SCOPE_VALUES: LogisticsScopeValue[] = ["ALL", "FULL", "NON_FULL"];

export function readPeriodFromSearchParams(
  searchParams: URLSearchParams,
): PeriodState {
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from && !to) return { kind: "default" };
  if (!from || !to) {
    return {
      kind: "invalid",
      message:
        'Informe as duas datas ("de" e "até") na URL, ou nenhuma delas.',
    };
  }
  const result = validateDateRangeStrings(from, to);
  if (!result.valid) {
    return { kind: "invalid", message: DATE_RANGE_ERROR_MESSAGES[result.error] };
  }
  return {
    kind: "valid",
    from: dateOnlyToString(result.range.from),
    to: dateOnlyToString(result.range.to),
  };
}

export function resolveEffectivePeriod(period: PeriodState): {
  from: string;
  to: string;
} | null {
  if (period.kind === "invalid") return null;
  if (period.kind === "valid") return { from: period.from, to: period.to };
  const defaultRange = resolvePreset("last30");
  return {
    from: dateOnlyToString(defaultRange.from),
    to: dateOnlyToString(defaultRange.to),
  };
}

export function defaultPeriodStrings(): { from: string; to: string } {
  const range = resolvePreset("last30");
  return { from: dateOnlyToString(range.from), to: dateOnlyToString(range.to) };
}

export function readMarketplaceFromParams(searchParams: URLSearchParams): MarketplaceFilter {
  const raw = searchParams.get("marketplace");
  if (raw && (MARKETPLACE_FILTER_VALUES as string[]).includes(raw)) {
    return raw as MarketplaceFilter;
  }
  // Seleção inválida (ou ausente) é tratada como o padrão, sem quebrar a tela.
  return "ALL";
}

export function readAccountIdFromParams(searchParams: URLSearchParams): string | null {
  return searchParams.get("accountId") || null;
}

export function readAllTimeFromParams(searchParams: URLSearchParams): boolean {
  return searchParams.get("period") === "all";
}

/**
 * `FULL`/`NON_FULL` só existem dentro do escopo Mercado Livre ou Shopee
 * (Fase 4, item 2; correção da auditoria Full estendeu à Shopee) — qualquer
 * outro marketplace (ou "Todos os marketplaces") sempre restaura `ALL`,
 * mesmo que a URL traga um valor diferente.
 */
export function marketplaceSupportsLogisticsScope(
  marketplace: MarketplaceFilter,
): boolean {
  return marketplace === "MERCADO_LIVRE" || marketplace === "SHOPEE";
}

export function readLogisticsScopeFromParams(
  searchParams: URLSearchParams,
  marketplace: MarketplaceFilter,
): LogisticsScopeValue {
  if (!marketplaceSupportsLogisticsScope(marketplace)) return "ALL";
  const raw = searchParams.get("logistics");
  if (raw && (LOGISTICS_SCOPE_VALUES as string[]).includes(raw)) {
    return raw as LogisticsScopeValue;
  }
  return "ALL";
}
