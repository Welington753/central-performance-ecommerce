import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type {
  AccountBreakdownEntry,
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceAnalyticsKpisDto,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

/**
 * Chave canônica de escopo, estado de cada "slot" de dados e normalização
 * de marketplace efetivo — construção de parâmetros/chaves usada pelo hook
 * de orquestração para nunca reaproveitar dado de um escopo diferente.
 */

/**
 * Marketplace efetivo dos cartões financeiros/seções Full (CP2K-8D, item 6):
 * com `marketplace` = ALL e uma conta selecionada, é o marketplace DESSA
 * conta (não "ALL") — nunca finge que uma conta Amazon/Shopee tem dado
 * financeiro/Full só porque o filtro geral está em "Todos".
 */
export function resolveEffectiveMarketplace(
  marketplace: MarketplaceFilter,
  accountId: string | null,
  accounts: AccountBreakdownEntry[],
): MarketplaceFilter {
  if (marketplace !== "ALL") return marketplace;
  if (!accountId) return "ALL";
  const selected = accounts.find((a) => a.accountId === accountId);
  return selected ? selected.marketplace : "ALL";
}

/**
 * Chave canônica do escopo de uma consulta de KPIs (marketplace, conta,
 * tipo de período, `from`/`to`, `allTime` e filtro logístico) — usada para
 * nunca reaproveitar (nem exibir como se fosse atual) um resultado obtido
 * para um escopo diferente. `accountId: null` identifica o slot "sem conta"
 * (visão agregada usada para o painel/dropdown), distinto do slot da conta
 * selecionada.
 */
export function buildScopeKey(input: {
  marketplace: MarketplaceFilter;
  accountId: string | null;
  allTime: boolean;
  from: string | null;
  to: string | null;
  logisticsScope: LogisticsScopeValue;
}): string {
  const periodPart = input.allTime
    ? "ALLTIME"
    : `RANGE|${input.from ?? ""}|${input.to ?? ""}`;
  return [
    input.marketplace,
    input.accountId ?? "",
    periodPart,
    input.logisticsScope,
  ].join("|");
}

export interface ScopeSlotState {
  data: MarketplaceAnalyticsKpisDto | null;
  /** Chave do escopo ao qual `data` pertence (null enquanto nada foi carregado). */
  dataKey: string | null;
  /** ISO 8601 de quando `data` foi carregado com sucesso — rótulo "Dados carregados em". */
  dataLoadedAt: string | null;
  /** Chave da última requisição concluída (sucesso ou falha), para saber se já há uma resposta assentada para o escopo atual. */
  lastRequestKey: string | null;
  lastRequestFailed: boolean;
  /** 401/403: nunca deve ser tratado como "atualização que falhou, mantém dado antigo". */
  lastRequestAuthError: boolean;
  /** Chave da requisição em voo agora, ou null se nenhuma está pendente. */
  pendingKey: string | null;
}

export const INITIAL_SCOPE_SLOT: ScopeSlotState = {
  data: null,
  dataKey: null,
  dataLoadedAt: null,
  lastRequestKey: null,
  lastRequestFailed: false,
  lastRequestAuthError: false,
  pendingKey: null,
};

/** "DD/MM/AAAA às HH:mm" — nunca "DD/MM/AAAA, HH:mm" (formato padrão do Intl pt-BR). */
export function formatLoadedAtLabel(iso: string | null): string | null {
  const formatted = formatDateTimeSaoPaulo(iso);
  if (!formatted) return null;
  return formatted.replace(", ", " às ");
}
