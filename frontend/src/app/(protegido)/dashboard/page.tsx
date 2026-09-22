"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdditionalKpiCards } from "@/components/AdditionalKpiCards";
import { CancellationsPanel } from "@/components/CancellationsPanel";
import { DailyRevenueChart } from "@/components/DailyRevenueChart";
import { DataCoverageBanner } from "@/components/DataCoverageBanner";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { EmptyStateIcon } from "@/components/EmptyState";
import { ExpensesAndResultSection } from "@/components/ExpensesAndResultSection";
import { FinancialKpiCards } from "@/components/FinancialKpiCards";
import { FullPerformanceSection } from "@/components/FullPerformanceSection";
import { KpiSummaryCards } from "@/components/KpiSummaryCards";
import { LogisticsScopeFilter } from "@/components/LogisticsScopeFilter";
import { LogisticsScopeCoverageNotice } from "@/components/LogisticsScopeCoverageNotice";
import { MarketplacePanel } from "@/components/MarketplacePanel";
import { OperationalKpiCards } from "@/components/OperationalKpiCards";
import { ProductRankingTabs } from "@/components/ProductRankingTabs";
import { ScopeFilters } from "@/components/ScopeFilters";
import {
  ApiFetchError,
  UnauthorizedAnalyticsApiError,
  fetchMarketplaceAnalyticsKpis,
  syncMercadoLivreOrders,
} from "@/lib/api";
import {
  DATE_RANGE_ERROR_MESSAGES,
  dateOnlyToString,
  resolvePreset,
  validateDateRangeStrings,
} from "@/lib/date-range";
import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type {
  AccountBreakdownEntry,
  AnalyticsComparison,
  LogisticsScopeFilter as LogisticsScopeValue,
  MarketplaceAnalyticsKpisDto,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

// Usado só quando `allTime` está ativo e `comparison` do backend é `null`
// (Fase 4, "Todo o período" nunca calcula comparação) — todo card de
// comparação já trata cada `*Pct: null` renderizando "—"/"Sem base no
// período anterior", então isto apenas evita passar `null` para
// componentes cujo `comparison` ainda é obrigatório, sem tocar em nenhum
// deles.
const EMPTY_COMPARISON: AnalyticsComparison = {
  grossRevenuePct: null,
  ordersPct: null,
  unitsPct: null,
  averageTicketPct: null,
  cancelledOrdersPct: null,
  cancellationRateDiffPp: 0,
  distinctProductsPct: null,
  unitsPerOrderPct: null,
  grossSalesRevenuePct: null,
  grossSalesOrdersPct: null,
  grossSalesUnitsPct: null,
  grossSalesAverageTicketPct: null,
  grossSalesAvgUnitPricePct: null,
  cancelledUnitsPct: null,
  cancelledRevenuePct: null,
};

const MARKETPLACE_FILTER_VALUES: MarketplaceFilter[] = [
  "ALL",
  "MERCADO_LIVRE",
  "AMAZON",
  "SHOPEE",
];

// Mensagens específicas por código sanitizado devolvido pelo backend (ver
// `SyncOrdersErrorCode` em `mercado-livre-orders-sync.service.ts`) — nunca
// exibe o código cru nem qualquer detalhe interno; `SYNC_FAILED` e qualquer
// código não mapeado caem no fallback genérico já lançado por
// `syncMercadoLivreOrders` (`error.message`).
const SYNC_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_CONNECTED:
    "Esta conta não está mais conectada ao Mercado Livre. Reconecte-a em Integrações.",
  SYNC_ALREADY_RUNNING:
    "Já existe uma sincronização em andamento para esta conta. Aguarde a conclusão.",
  TOKEN_EXPIRED:
    "O Mercado Livre encerrou o acesso desta conta. Reconecte-a em Integrações.",
  ACCOUNT_BUSY:
    "Esta conta está processando outra operação agora. Tente novamente em instantes.",
  PROVIDER_RATE_LIMITED:
    "O Mercado Livre limitou as requisições no momento. Tente novamente em alguns minutos.",
  INVALID_PROVIDER_RESPONSE:
    "O Mercado Livre retornou uma resposta inesperada. Tente novamente mais tarde.",
  PROVIDER_UNAVAILABLE:
    "O Mercado Livre está indisponível no momento. Tente novamente mais tarde.",
};

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
        role="status"
        aria-label={label}
      />
      <p className="text-sm text-foreground/60">{label}</p>
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-xl border border-red-500/40 bg-red-500/10 px-6 py-10 text-center text-sm text-red-700"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm font-medium hover:bg-red-500/10"
      >
        Tentar novamente
      </button>
    </div>
  );
}

type PeriodState =
  | { kind: "default" }
  | { kind: "valid"; from: string; to: string }
  | { kind: "invalid"; message: string };

function readPeriodFromSearchParams(
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

function resolveEffectivePeriod(period: PeriodState): {
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

function defaultPeriodStrings(): { from: string; to: string } {
  const range = resolvePreset("last30");
  return { from: dateOnlyToString(range.from), to: dateOnlyToString(range.to) };
}

function readMarketplaceFromParams(searchParams: URLSearchParams): MarketplaceFilter {
  const raw = searchParams.get("marketplace");
  if (raw && (MARKETPLACE_FILTER_VALUES as string[]).includes(raw)) {
    return raw as MarketplaceFilter;
  }
  // Seleção inválida (ou ausente) é tratada como o padrão, sem quebrar a tela.
  return "ALL";
}

function readAccountIdFromParams(searchParams: URLSearchParams): string | null {
  return searchParams.get("accountId") || null;
}

function readAllTimeFromParams(searchParams: URLSearchParams): boolean {
  return searchParams.get("period") === "all";
}

const LOGISTICS_SCOPE_VALUES: LogisticsScopeValue[] = ["ALL", "FULL", "NON_FULL"];

/**
 * `FULL`/`NON_FULL` só existem dentro do escopo Mercado Livre (Fase 4, item
 * 2) — qualquer outro marketplace (ou "Todos os marketplaces") sempre
 * restaura `ALL`, mesmo que a URL traga um valor diferente.
 */
function readLogisticsScopeFromParams(
  searchParams: URLSearchParams,
  marketplace: MarketplaceFilter,
): LogisticsScopeValue {
  if (marketplace !== "MERCADO_LIVRE") return "ALL";
  const raw = searchParams.get("logistics");
  if (raw && (LOGISTICS_SCOPE_VALUES as string[]).includes(raw)) {
    return raw as LogisticsScopeValue;
  }
  return "ALL";
}

function scopeTitle(marketplace: MarketplaceFilter): string {
  switch (marketplace) {
    case "ALL":
      return "Visão consolidada dos marketplaces";
    case "MERCADO_LIVRE":
      return "Desempenho do Mercado Livre";
    case "AMAZON":
      return "Desempenho da Amazon";
    case "SHOPEE":
      return "Desempenho da Shopee";
  }
}

/**
 * Marketplace efetivo dos três cartões financeiros (CP2K-8D, item 6): com
 * `marketplace` = ALL e uma conta selecionada, é o marketplace DESSA conta
 * (não "ALL") — nunca finge que uma conta Amazon/Shopee tem dado financeiro
 * só porque o filtro geral está em "Todos".
 */
function resolveEffectiveMarketplace(
  marketplace: MarketplaceFilter,
  accountId: string | null,
  accounts: AccountBreakdownEntry[],
): MarketplaceFilter {
  if (marketplace !== "ALL") return marketplace;
  if (!accountId) return "ALL";
  const selected = accounts.find((a) => a.accountId === accountId);
  return selected ? selected.marketplace : "ALL";
}

function accountDisplayLabel(account: AccountBreakdownEntry): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.accountId.slice(0, 8)}`;
}

/**
 * Chave canônica do escopo de uma consulta de KPIs (marketplace, conta,
 * tipo de período, `from`/`to`, `allTime` e filtro logístico) — usada para
 * nunca reaproveitar (nem exibir como se fosse atual) um resultado obtido
 * para um escopo diferente. `accountId: null` identifica o slot "sem conta"
 * (visão agregada usada para o painel/dropdown), distinto do slot da conta
 * selecionada.
 */
function buildScopeKey(input: {
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

interface ScopeSlotState {
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

const INITIAL_SCOPE_SLOT: ScopeSlotState = {
  data: null,
  dataKey: null,
  dataLoadedAt: null,
  lastRequestKey: null,
  lastRequestFailed: false,
  lastRequestAuthError: false,
  pendingKey: null,
};

/** "DD/MM/AAAA às HH:mm" — nunca "DD/MM/AAAA, HH:mm" (formato padrão do Intl pt-BR). */
function formatLoadedAtLabel(iso: string | null): string | null {
  const formatted = formatDateTimeSaoPaulo(iso);
  if (!formatted) return null;
  return formatted.replace(", ", " às ");
}

function StaleDataBanner({
  loadedAtLabel,
  onRetry,
}: {
  loadedAtLabel: string | null;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800"
    >
      <p>
        Não foi possível atualizar agora. Exibindo os últimos dados carregados
        {loadedAtLabel ? ` em ${loadedAtLabel}` : ""}.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-amber-500/40 px-3 py-1.5 text-sm font-medium hover:bg-amber-500/10"
      >
        Tentar novamente
      </button>
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [scopeSlot, setScopeSlot] = useState<ScopeSlotState>(INITIAL_SCOPE_SLOT);
  const [accountScopedSlot, setAccountScopedSlot] =
    useState<ScopeSlotState>(INITIAL_SCOPE_SLOT);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncingRef = useRef(false);

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
      const seq = ++scopeRequestSeqRef.current;
      const key = buildScopeKey({
        marketplace: mkt,
        accountId: null,
        allTime: allTimeFlag,
        from,
        to,
        logisticsScope: logistics,
      });
      setScopeSlot((prev) => ({ ...prev, pendingKey: key }));
      let outcome:
        | { data: MarketplaceAnalyticsKpisDto }
        | { authError: boolean };
      try {
        const data = await fetchMarketplaceAnalyticsKpis(
          allTimeFlag
            ? { marketplace: mkt, allTime: true, logisticsScope: logistics }
            : {
                from: from as string,
                to: to as string,
                marketplace: mkt,
                logisticsScope: logistics,
              },
        );
        outcome = { data };
      } catch (error) {
        outcome = { authError: error instanceof UnauthorizedAnalyticsApiError };
      }
      // Uma requisição mais nova já começou enquanto esta estava em voo —
      // esta resposta chegou tarde demais e nunca pode substituir o
      // escopo atual (nem sucesso, nem erro, nem a chave de carregamento).
      if (scopeRequestSeqRef.current !== seq) return;
      if ("data" in outcome) {
        setScopeSlot((prev) => ({
          ...prev,
          data: outcome.data,
          dataKey: key,
          dataLoadedAt: new Date().toISOString(),
          lastRequestKey: key,
          lastRequestFailed: false,
          lastRequestAuthError: false,
          pendingKey: null,
        }));
      } else {
        // Nunca zera `data`/`dataKey` já carregados com sucesso — uma
        // recarga que falha (ex.: após "Sincronizar agora") deve manter o
        // último retrato bom na tela com um aviso pontual, nunca apagar
        // painéis, filtros e o próprio botão de sincronizar por trás de uma
        // tela de erro em branco. 401/403 é a exceção: nunca deve parecer
        // que a sessão continua válida.
        setScopeSlot((prev) => ({
          ...prev,
          lastRequestKey: key,
          lastRequestFailed: true,
          lastRequestAuthError: outcome.authError,
          pendingKey: null,
        }));
      }
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
      const seq = ++accountScopedRequestSeqRef.current;
      const key = buildScopeKey({
        marketplace: mkt,
        accountId: account,
        allTime: allTimeFlag,
        from,
        to,
        logisticsScope: logistics,
      });
      setAccountScopedSlot((prev) => ({ ...prev, pendingKey: key }));
      let outcome:
        | { data: MarketplaceAnalyticsKpisDto }
        | { authError: boolean };
      try {
        const data = await fetchMarketplaceAnalyticsKpis(
          allTimeFlag
            ? {
                marketplace: mkt,
                accountId: account,
                allTime: true,
                logisticsScope: logistics,
              }
            : {
                from: from as string,
                to: to as string,
                marketplace: mkt,
                accountId: account,
                logisticsScope: logistics,
              },
        );
        outcome = { data };
      } catch (error) {
        outcome = { authError: error instanceof UnauthorizedAnalyticsApiError };
      }
      if (accountScopedRequestSeqRef.current !== seq) return;
      if ("data" in outcome) {
        setAccountScopedSlot((prev) => ({
          ...prev,
          data: outcome.data,
          dataKey: key,
          dataLoadedAt: new Date().toISOString(),
          lastRequestKey: key,
          lastRequestFailed: false,
          lastRequestAuthError: false,
          pendingKey: null,
        }));
      } else {
        // Mesmo raciocínio de `loadScope` acima: preserva o último dado bom,
        // exceto em 401/403.
        setAccountScopedSlot((prev) => ({
          ...prev,
          lastRequestKey: key,
          lastRequestFailed: true,
          lastRequestAuthError: outcome.authError,
          pendingKey: null,
        }));
      }
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

  // Cada slot (`scopeSlot`/`accountScopedSlot`) só é considerado "dado
  // válido" quando `dataKey` bate exatamente com a chave canônica do escopo
  // atual — nunca reaproveita (nem exibe como se fosse atual) um resultado
  // obtido para outro marketplace, conta, período ou filtro logístico.
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

  function handlePeriodChange(range: { from: string; to: string }) {
    const params = new URLSearchParams(searchParams.toString());
    // Escolher um período explícito sempre sai de "Todo o período".
    params.delete("period");
    params.set("from", range.from);
    params.set("to", range.to);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleAllTimeChange() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", "all");
    params.delete("from");
    params.delete("to");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleScopeChange(next: { marketplace: MarketplaceFilter; accountId: string | null }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.marketplace === "ALL") {
      params.delete("marketplace");
    } else {
      params.set("marketplace", next.marketplace);
    }
    if (next.accountId) {
      params.set("accountId", next.accountId);
    } else {
      params.delete("accountId");
    }
    // Trocar para qualquer marketplace/escopo que não seja Mercado Livre
    // restaura o filtro "Tipo de venda" para "Todas as vendas" (Fase 4,
    // item 2) — nunca deixa `logistics=FULL`/`NON_FULL` pendurado na URL
    // fora do escopo em que faz sentido.
    if (next.marketplace !== "MERCADO_LIVRE") {
      params.delete("logistics");
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function handleLogisticsScopeChange(next: LogisticsScopeValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "ALL") {
      params.delete("logistics");
    } else {
      params.set("logistics", next);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

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

  async function handleSync(mlAccountId: string) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      await syncMercadoLivreOrders(mlAccountId);
      await reloadCurrentScope();
    } catch (error) {
      if (error instanceof ApiFetchError) {
        setSyncError(
          (error.code && SYNC_ERROR_MESSAGES[error.code]) || error.message,
        );
      } else {
        setSyncError("Não foi possível sincronizar agora. Tente novamente.");
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  const header = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {scopeTitle(marketplace)}
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        Central de Performance E-commerce.
      </p>
    </div>
  );

  // Este gate cobre só o carregamento "sem conta" que alimenta o painel de
  // marketplaces/dropdown de contas — nunca aconteceu nenhum sucesso ainda
  // (`scopeSlot.data === null`) para NENHUM escopo, nem só o atual.
  const scopeNeverLoaded = scopeSlot.data === null;
  const scopeInitialLoading =
    scopeNeverLoaded && scopeKey !== null && !scopeFailedForKey;

  if (scopeInitialLoading) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <LoadingBlock label="Carregando..." />
      </div>
    );
  }

  if (scopeNeverLoaded && scopeFailedForKey) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <ErrorBlock
          message="Não foi possível carregar os dados de marketplaces. Tente novamente mais tarde."
          onRetry={() =>
            (allTime || (effectiveFrom && effectiveTo)) &&
            void loadScope(effectiveFrom, effectiveTo, marketplace, allTime, logisticsScope)
          }
        />
      </div>
    );
  }

  // Nada elegível em lugar nenhum do sistema (nenhuma conta conectada nem
  // com histórico, para nenhum marketplace) — mesmo estado vazio de antes,
  // agora derivado da disponibilidade do escopo ALL.
  if (
    scopeSlot.data &&
    scopeSlot.data.scope.marketplace === "ALL" &&
    scopeSlot.data.availability === "NOT_CONNECTED"
  ) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
          <EmptyStateIcon />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">Nenhum marketplace conectado</p>
            <p className="text-sm text-foreground/60">
              Conecte uma conta para ver seus KPIs de vendas aqui.
            </p>
          </div>
          <Link
            href="/integracoes"
            className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
          >
            Ir para integrações
          </Link>
        </div>
      </div>
    );
  }

  const dropdownAccounts = scopeSlot.data?.breakdownByAccount ?? [];
  const breakdownByMarketplace = displayData?.breakdownByMarketplace ?? [];
  // "Integração ativa": a conexão em si está boa (com ou sem dado ainda) —
  // HISTORICAL_ONLY fica de fora porque representa justamente uma conexão
  // com problema (precisa de atenção), mesmo tendo dado histórico.
  const activeMarketplaces = breakdownByMarketplace.filter(
    (m) => m.availability === "AVAILABLE" || m.availability === "CONNECTED_NO_DATA",
  ).length;
  // "Dados disponíveis": existe `summary` real para mostrar, independente
  // do estado da conexão — inclui HISTORICAL_ONLY (histórico legível apesar
  // da conexão precisar de atenção), nunca CONNECTED_NO_DATA (nunca haveria
  // uma sincronização provando os números).
  const marketplacesWithData = breakdownByMarketplace.filter(
    (m) => m.summary !== null,
  ).length;

  const scopedAccounts = displayData?.breakdownByAccount ?? [];
  // "Visão consolidada dos marketplaces" (Fase 4, "cartões por conta ML"):
  // sempre `breakdownByAccountUnscoped`, nunca `breakdownByAccount` — este
  // último é filtrado pelo escopo (marketplace/conta) selecionado acima, e
  // o painel precisa continuar mostrando TODAS as contas, igual ao painel
  // por marketplace.
  const mercadoLivreAccounts = (
    displayData?.breakdownByAccountUnscoped ?? []
  ).filter((account) => account.marketplace === "MERCADO_LIVRE");
  const connectedMlAccounts = scopedAccounts.filter(
    (a) => a.marketplace === "MERCADO_LIVRE" && a.status === "CONNECTED",
  );
  const historicalAccounts = scopedAccounts.filter(
    (a) => a.availability === "HISTORICAL_ONLY",
  );
  const effectiveFinancialMarketplace = resolveEffectiveMarketplace(
    marketplace,
    accountId,
    scopedAccounts,
  );

  const lastSyncLabel = displayData
    ? (formatDateTimeSaoPaulo(displayData.lastSync) ?? "Nunca sincronizado")
    : null;

  return (
    <div className="flex flex-col gap-8">
      {header}

      <MarketplacePanel
        breakdown={breakdownByMarketplace}
        mercadoLivreAccounts={mercadoLivreAccounts}
      />
      <p className="text-xs text-foreground/60">
        {activeMarketplaces} de 3 marketplaces com integração ativa
        {" · "}
        {marketplacesWithData} de 3 com dados disponíveis
      </p>

      <ScopeFilters
        marketplace={marketplace}
        accountId={accountId}
        accounts={dropdownAccounts}
        onChange={handleScopeChange}
      />

      {marketplace === "MERCADO_LIVRE" ? (
        <>
          <LogisticsScopeFilter
            value={logisticsScope}
            onChange={handleLogisticsScopeChange}
          />
          <LogisticsScopeCoverageNotice
            logisticsScope={logisticsScope}
            full={displayData?.full ?? null}
          />
        </>
      ) : null}

      {effectivePeriod ? (
        <DateRangeFilter
          from={effectivePeriod.from}
          to={effectivePeriod.to}
          allTime={allTime}
          resolvedAllTimePeriod={
            allTime && displayData
              ? { from: displayData.period.from, to: displayData.period.to }
              : undefined
          }
          onChange={handlePeriodChange}
          onAllTimeChange={handleAllTimeChange}
        />
      ) : null}

      {period.kind === "invalid" ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
        >
          <p>Período inválido na URL: {period.message}</p>
          <button
            type="button"
            onClick={() => handlePeriodChange(defaultPeriodStrings())}
            className="mt-2 rounded-md border border-red-500/40 px-3 py-1.5 text-sm font-medium hover:bg-red-500/10"
          >
            Voltar aos últimos 30 dias
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface px-5 py-4">
            <p className="text-sm text-foreground/60">
              Última sincronização:{" "}
              <span className="font-medium text-foreground">
                {lastSyncLabel ?? "—"}
              </span>
            </p>
            {connectedMlAccounts.length === 1 ? (
              <button
                type="button"
                onClick={() => void handleSync(connectedMlAccounts[0].accountId)}
                disabled={syncing}
                className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {syncing ? "Sincronizando..." : "Sincronizar agora"}
              </button>
            ) : connectedMlAccounts.length > 1 ? (
              <Link
                href="/sincronizacoes"
                className="text-sm font-medium text-brand hover:underline"
              >
                Várias contas neste escopo — sincronize por lá
              </Link>
            ) : null}
          </div>

          {syncError ? (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
            >
              {syncError}
            </div>
          ) : null}

          {historicalAccounts.length > 0 ? (
            <div
              role="status"
              className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800"
            >
              {historicalAccounts.map((account) => (
                <p key={account.accountId}>
                  A conexão da conta &quot;{accountDisplayLabel(account)}&quot; precisa de
                  atenção — o histórico já sincronizado continua disponível abaixo.{" "}
                  <Link href="/integracoes" className="font-medium underline">
                    Reconectar
                  </Link>
                </p>
              ))}
            </div>
          ) : null}

          {displayLoading ? (
            <LoadingBlock label="Carregando KPIs..." />
          ) : displayFatalError ? (
            <ErrorBlock
              message={
                displayAuthFatal
                  ? "Sessão expirada ou sem permissão para este escopo. Entre novamente."
                  : "Não foi possível carregar os KPIs agora."
              }
              onRetry={() => void reloadCurrentScope()}
            />
          ) : (
            <>
              {displayUpdating ? (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-4 py-3 text-sm text-foreground/60"
                >
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
                    aria-hidden="true"
                  />
                  Atualizando dados...
                </div>
              ) : null}
              {displayStaleWarning ? (
                <StaleDataBanner
                  loadedAtLabel={displayLoadedAtLabel}
                  onRetry={() => void reloadCurrentScope()}
                />
              ) : null}
              {displayData?.summary &&
              (displayData.comparison || displayData.scope.allTime) ? (
                <div className="flex flex-col gap-6">
                  <DataCoverageBanner
                    coverage={displayData.dataCoverage}
                    requestedPeriod={
                      !allTime && effectivePeriod ? effectivePeriod : undefined
                    }
                  />

                  <KpiSummaryCards
                    summary={displayData.summary}
                    comparison={displayData.comparison ?? EMPTY_COMPARISON}
                  />
                  <p className="text-xs text-foreground/50">
                    Vendas brutas: pedidos pagos + pedidos cancelados com
                    valor válido, equivalente ao indicador do marketplace.
                  </p>

                  <OperationalKpiCards
                    summary={displayData.summary}
                    comparison={displayData.comparison ?? EMPTY_COMPARISON}
                  />

                  <FinancialKpiCards
                    summary={displayData.summary}
                    effectiveMarketplace={effectiveFinancialMarketplace}
                  />

                  <ExpensesAndResultSection
                    summary={displayData.summary}
                    effectiveMarketplace={effectiveFinancialMarketplace}
                  />

                  <AdditionalKpiCards
                    summary={displayData.summary}
                    comparison={displayData.comparison ?? EMPTY_COMPARISON}
                    bestDay={displayData.bestDay}
                  />

                  <CancellationsPanel
                    summary={displayData.summary}
                    comparison={displayData.comparison ?? EMPTY_COMPARISON}
                  />

                  <div className="flex flex-col gap-3">
                    <h2 className="text-lg font-semibold">
                      Faturamento diário
                    </h2>
                    <DailyRevenueChart dailySeries={displayData.dailySeries} />
                  </div>

                  <div className="flex flex-col gap-3">
                    <h2 className="text-lg font-semibold">
                      Ranking de produtos
                    </h2>
                    <ProductRankingTabs
                      bySku={displayData.topProductsBySku}
                      byListing={displayData.topListings}
                    />
                  </div>

                  {/*
                    Correção da auditoria Full: a seção só existe dentro do
                    escopo Mercado Livre. O backend já devolve `full: null`
                    para Amazon/Shopee, mas o gate aqui é explícito e
                    independente — nenhum escopo Amazon/Shopee pode renderizar
                    um cabeçalho "Mercado Livre Full" nem o aviso sugerindo
                    que os pedidos seriam classificados numa próxima
                    sincronização (o que nunca aconteceria). Mesma regra já
                    aplicada ao `LogisticsScopeFilter` acima; com
                    `marketplace = ALL` a seção aparece e o backend calcula
                    tudo só sobre as contas Mercado Livre.
                  */}
                  {displayData.full &&
                  effectiveFinancialMarketplace !== "AMAZON" &&
                  effectiveFinancialMarketplace !== "SHOPEE" ? (
                    <FullPerformanceSection full={displayData.full} />
                  ) : null}
                </div>
              ) : displayData ? (
                <div className="flex flex-col gap-4">
                  <DataCoverageBanner
                    coverage={displayData.dataCoverage}
                    requestedPeriod={
                      !allTime && effectivePeriod ? effectivePeriod : undefined
                    }
                  />
                  <p className="text-sm text-foreground/60">
                    {displayData.availability === "NOT_CONNECTED"
                      ? "Nenhuma conta elegível para este filtro."
                      : "Esta conta ainda não tem nenhuma sincronização concluída — nenhum KPI para exibir ainda."}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-8">
          <LoadingBlock label="Carregando..." />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
