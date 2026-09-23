import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  AccountBreakdownEntry,
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceAnalyticsKpisDto,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";
import {
  type PeriodState,
  defaultPeriodStrings,
  marketplaceSupportsLogisticsScope,
  readAccountIdFromParams,
  readAllTimeFromParams,
  readLogisticsScopeFromParams,
  readMarketplaceFromParams,
  readPeriodFromSearchParams,
  resolveEffectivePeriod,
} from "@/hooks/analytics-scope/params";
import {
  INITIAL_SCOPE_SLOT,
  type ScopeSlotState,
  buildScopeKey,
  resolveEffectiveMarketplace,
} from "@/hooks/analytics-scope/key";
import { loadSlotData } from "@/hooks/analytics-scope/load-slot";
import { deriveDisplayState } from "@/hooks/analytics-scope/derive";
import { createScopeUrlHandlers } from "@/hooks/analytics-scope/url-handlers";

/**
 * Escopo de consulta de analytics de marketplace (período, marketplace,
 * conta e filtro logístico), compartilhado por qualquer página que consuma
 * `fetchMarketplaceAnalyticsKpis` (Dashboard, Full, e futuras páginas
 * analíticas) — extraído do Dashboard para nunca duplicar esta lógica de
 * busca/corrida de requisições entre páginas.
 *
 * Este arquivo concentra só estado, efeitos e orquestração; normalização de
 * parâmetros de URL vive em `analytics-scope/params.ts`, chave de escopo e
 * estado de slot em `analytics-scope/key.ts`, e a busca/tratamento de erro
 * em `analytics-scope/fetch.ts`.
 */

export type { PeriodState };
export { defaultPeriodStrings, marketplaceSupportsLogisticsScope, resolveEffectiveMarketplace };

export interface UseMarketplaceAnalyticsScopeResult {
  period: PeriodState;
  effectivePeriod: { from: string; to: string } | null;
  marketplace: MarketplaceFilter;
  accountId: string | null;
  allTime: boolean;
  logisticsScope: LogisticsScopeValue;

  scopeSlot: ScopeSlotState;
  displayData: MarketplaceAnalyticsKpisDto | null;
  displayLoading: boolean;
  displayUpdating: boolean;
  displayStaleWarning: boolean;
  displayFatalError: boolean;
  displayAuthFatal: boolean;
  displayLoadedAtLabel: string | null;

  scopeNeverLoaded: boolean;
  scopeInitialLoading: boolean;
  scopeFailedForKey: boolean;

  dropdownAccounts: AccountBreakdownEntry[];
  scopedAccounts: AccountBreakdownEntry[];
  effectiveFinancialMarketplace: MarketplaceFilter;

  handlePeriodChange: (range: { from: string; to: string }) => void;
  handleAllTimeChange: () => void;
  handleScopeChange: (next: { marketplace: MarketplaceFilter; accountId: string | null }) => void;
  handleLogisticsScopeChange: (next: LogisticsScopeValue) => void;
  reloadCurrentScope: () => Promise<void>;
  /** Reconsulta só o slot "sem conta" — usado pelo retry do gate de carregamento inicial. */
  retryScopeLoad: () => void;
}

export function useMarketplaceAnalyticsScope(): UseMarketplaceAnalyticsScopeResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [scopeSlot, setScopeSlot] = useState<ScopeSlotState>(INITIAL_SCOPE_SLOT);
  const [accountScopedSlot, setAccountScopedSlot] =
    useState<ScopeSlotState>(INITIAL_SCOPE_SLOT);

  // Proteção contra corrida entre requisições (geração monotônica): cada
  // chamada a `loadScope`/`loadAccountScoped` incrementa seu próprio
  // contador antes do `fetch` e só aplica `setState` se, quando a resposta
  // chega, nenhuma chamada mais nova já foi iniciada. Sem isso, trocar
  // marketplace/conta/período rapidamente permite que uma resposta antiga
  // (que demorou mais) sobrescreva uma resposta mais nova que já chegou —
  // tanto com dado stale quanto travando a tela em "Carregando" para sempre
  // se a mais nova nunca "vencer" a comparação de chave.
  const scopeRequestSeqRef = useRef(0);
  const accountScopedRequestSeqRef = useRef(0);

  const period = readPeriodFromSearchParams(searchParams);
  const effectivePeriod = resolveEffectivePeriod(period);
  const effectiveFrom = effectivePeriod?.from ?? null;
  const effectiveTo = effectivePeriod?.to ?? null;
  const marketplace = readMarketplaceFromParams(searchParams);
  const accountId = readAccountIdFromParams(searchParams);
  const allTime = readAllTimeFromParams(searchParams);
  const logisticsScope = readLogisticsScopeFromParams(searchParams, marketplace);

  const loadScope = useCallback(
    async (
      from: string | null,
      to: string | null,
      mkt: MarketplaceFilter,
      allTimeFlag: boolean,
      logistics: LogisticsScopeValue,
    ) => {
      const key = buildScopeKey({
        marketplace: mkt,
        accountId: null,
        allTime: allTimeFlag,
        from,
        to,
        logisticsScope: logistics,
      });
      await loadSlotData({
        key,
        seqRef: scopeRequestSeqRef,
        setSlot: setScopeSlot,
        from,
        to,
        marketplace: mkt,
        allTime: allTimeFlag,
        logisticsScope: logistics,
      });
    },
    [],
  );

  useEffect(() => {
    // Primeira instrução é o `await` dentro de `loadScope` — nenhum
    // `setState` roda de forma síncrona no corpo deste efeito.
    if (!allTime && (!effectiveFrom || !effectiveTo)) return;
    void (async () => {
      await loadScope(effectiveFrom, effectiveTo, marketplace, allTime, logisticsScope);
    })();
  }, [effectiveFrom, effectiveTo, marketplace, allTime, logisticsScope, loadScope]);

  const loadAccountScoped = useCallback(
    async (
      from: string | null,
      to: string | null,
      mkt: MarketplaceFilter,
      account: string,
      allTimeFlag: boolean,
      logistics: LogisticsScopeValue,
    ) => {
      const key = buildScopeKey({
        marketplace: mkt,
        accountId: account,
        allTime: allTimeFlag,
        from,
        to,
        logisticsScope: logistics,
      });
      await loadSlotData({
        key,
        seqRef: accountScopedRequestSeqRef,
        setSlot: setAccountScopedSlot,
        from,
        to,
        marketplace: mkt,
        accountId: account,
        allTime: allTimeFlag,
        logisticsScope: logistics,
      });
    },
    [],
  );

  useEffect(() => {
    if (!accountId) return;
    if (!allTime && (!effectiveFrom || !effectiveTo)) return;
    void (async () => {
      await loadAccountScoped(
        effectiveFrom,
        effectiveTo,
        marketplace,
        accountId,
        allTime,
        logisticsScope,
      );
    })();
  }, [
    effectiveFrom,
    effectiveTo,
    marketplace,
    accountId,
    allTime,
    logisticsScope,
    loadAccountScoped,
  ]);

  const periodReady = allTime || (effectiveFrom !== null && effectiveTo !== null);
  const scopeKey = periodReady
    ? buildScopeKey({
        marketplace,
        accountId: null,
        allTime,
        from: effectiveFrom,
        to: effectiveTo,
        logisticsScope,
      })
    : null;
  const accountScopeKey =
    accountId && periodReady
      ? buildScopeKey({
          marketplace,
          accountId,
          allTime,
          from: effectiveFrom,
          to: effectiveTo,
          logisticsScope,
        })
      : null;

  const {
    displayData,
    displayLoadedAtLabel,
    displayLoading,
    displayUpdating,
    displayStaleWarning,
    displayFatalError,
    displayAuthFatal,
    scopeFailedForKey,
  } = deriveDisplayState({ scopeSlot, accountScopedSlot, scopeKey, accountScopeKey, accountId });

  const {
    handlePeriodChange,
    handleAllTimeChange,
    handleScopeChange,
    handleLogisticsScopeChange,
  } = createScopeUrlHandlers({ router, pathname, searchParams });

  async function reloadCurrentScope() {
    if (!allTime && (!effectiveFrom || !effectiveTo)) return;
    if (accountId) {
      await loadAccountScoped(
        effectiveFrom,
        effectiveTo,
        marketplace,
        accountId,
        allTime,
        logisticsScope,
      );
    } else {
      await loadScope(effectiveFrom, effectiveTo, marketplace, allTime, logisticsScope);
    }
  }

  // Este gate cobre só o carregamento "sem conta" que alimenta o painel de
  // marketplaces/dropdown de contas — nunca aconteceu nenhum sucesso ainda
  // (`scopeSlot.data === null`) para NENHUM escopo, nem só o atual.
  const scopeNeverLoaded = scopeSlot.data === null;
  const scopeInitialLoading =
    scopeNeverLoaded && scopeKey !== null && !scopeFailedForKey;

  const dropdownAccounts = scopeSlot.data?.breakdownByAccount ?? [];
  const scopedAccounts = displayData?.breakdownByAccount ?? [];
  const effectiveFinancialMarketplace = resolveEffectiveMarketplace(
    marketplace,
    accountId,
    scopedAccounts,
  );

  return {
    period,
    effectivePeriod,
    marketplace,
    accountId,
    allTime,
    logisticsScope,

    scopeSlot,
    displayData,
    displayLoading,
    displayUpdating,
    displayStaleWarning,
    displayFatalError,
    displayAuthFatal,
    displayLoadedAtLabel,

    scopeNeverLoaded,
    scopeInitialLoading,
    scopeFailedForKey,

    dropdownAccounts,
    scopedAccounts,
    effectiveFinancialMarketplace,

    handlePeriodChange,
    handleAllTimeChange,
    handleScopeChange,
    handleLogisticsScopeChange,
    reloadCurrentScope,
    retryScopeLoad: () => {
      if (allTime || (effectiveFrom && effectiveTo)) {
        void loadScope(effectiveFrom, effectiveTo, marketplace, allTime, logisticsScope);
      }
    },
  };
}
