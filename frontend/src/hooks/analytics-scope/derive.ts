import { formatLoadedAtLabel, type ScopeSlotState } from "@/hooks/analytics-scope/key";
import type { MarketplaceAnalyticsKpisDto } from "@/types/marketplace-analytics";

/**
 * Derivação pura do estado "para exibição" (loading/updating/stale/erro
 * fatal) a partir dos dois slots de dados (`scopeSlot`/`accountScopedSlot`)
 * e das chaves de escopo atuais — mesma lógica usada pelo hook de
 * orquestração, só extraída para não inflar aquele arquivo.
 */

export interface DisplayState {
  displayData: MarketplaceAnalyticsKpisDto | null;
  displayLoadedAtLabel: string | null;
  displayLoading: boolean;
  displayUpdating: boolean;
  displayStaleWarning: boolean;
  displayFatalError: boolean;
  displayAuthFatal: boolean;
  scopeFailedForKey: boolean;
}

export function deriveDisplayState(input: {
  scopeSlot: ScopeSlotState;
  accountScopedSlot: ScopeSlotState;
  scopeKey: string | null;
  accountScopeKey: string | null;
  accountId: string | null;
}): DisplayState {
  const { scopeSlot, accountScopedSlot, scopeKey, accountScopeKey, accountId } = input;

  // Cada slot só é considerado "dado válido" quando `dataKey` bate
  // exatamente com a chave canônica do escopo atual — nunca reaproveita
  // (nem exibe como se fosse atual) um resultado obtido para outro
  // marketplace, conta, período ou filtro logístico.
  const scopeHasValidData = scopeKey !== null && scopeSlot.dataKey === scopeKey;
  const scopeFetching = scopeKey !== null && scopeSlot.pendingKey === scopeKey;
  const scopeFailedForKey =
    scopeKey !== null &&
    scopeSlot.lastRequestFailed &&
    scopeSlot.lastRequestKey === scopeKey;
  const scopeAuthFatal = scopeFailedForKey && scopeSlot.lastRequestAuthError;

  const accountHasValidData =
    accountScopeKey !== null && accountScopedSlot.dataKey === accountScopeKey;
  const accountFetching =
    accountScopeKey !== null && accountScopedSlot.pendingKey === accountScopeKey;
  const accountFailedForKey =
    accountScopeKey !== null &&
    accountScopedSlot.lastRequestFailed &&
    accountScopedSlot.lastRequestKey === accountScopeKey;
  const accountAuthFatal = accountFailedForKey && accountScopedSlot.lastRequestAuthError;

  const displaySlot = accountId ? accountScopedSlot : scopeSlot;
  const displayHasValidData = accountId ? accountHasValidData : scopeHasValidData;
  const displayFetching = accountId ? accountFetching : scopeFetching;
  const displayFailedForKey = accountId ? accountFailedForKey : scopeFailedForKey;
  const displayAuthFatal = accountId ? accountAuthFatal : scopeAuthFatal;

  // Nunca exibe `data` de um `dataKey` que não bate com o escopo atual —
  // mesmo durante um `pendingKey` de uma nova requisição para outro escopo.
  const displayData = displayHasValidData ? displaySlot.data : null;
  const displayLoadedAtLabel = displayHasValidData
    ? formatLoadedAtLabel(displaySlot.dataLoadedAt)
    : null;
  // "Atualização em andamento" (dado válido + nova busca em voo) não deve
  // reduzir a tela a um spinner — mantém cards/gráficos/rankings visíveis.
  const displayLoading = displayFetching && !displayHasValidData;
  const displayUpdating = displayFetching && displayHasValidData;
  // Aviso de atualização: já existe um resultado válido para este escopo
  // exato, e a última requisição para essa MESMA chave falhou — nunca por
  // 401/403 (aí é erro fatal, nunca finge que a sessão continua válida).
  const displayStaleWarning =
    !displayFetching && displayHasValidData && displayFailedForKey && !displayAuthFatal;
  // Erro fatal: a última requisição para esta chave falhou e (a) não há
  // nenhum resultado válido para o escopo atual, OU (b) foi 401/403 — nesse
  // caso é sempre fatal, mesmo que `data` ainda bata com a chave atual
  // (nunca finge que a sessão continua válida por já ter dado em tela).
  const displayFatalError =
    !displayFetching &&
    displayFailedForKey &&
    (displayAuthFatal || !displayHasValidData);

  return {
    displayData,
    displayLoadedAtLabel,
    displayLoading,
    displayUpdating,
    displayStaleWarning,
    displayFatalError,
    displayAuthFatal,
    scopeFailedForKey,
  };
}
