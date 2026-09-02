"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AdditionalKpiCards } from "@/components/AdditionalKpiCards";
import { DailyRevenueChart } from "@/components/DailyRevenueChart";
import { DataCoverageBanner } from "@/components/DataCoverageBanner";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { EmptyStateIcon } from "@/components/EmptyState";
import { KpiSummaryCards } from "@/components/KpiSummaryCards";
import { MarketplacePanel } from "@/components/MarketplacePanel";
import { ProductRankingTabs } from "@/components/ProductRankingTabs";
import { ScopeFilters } from "@/components/ScopeFilters";
import { fetchMarketplaceAnalyticsKpis, syncMercadoLivreOrders } from "@/lib/api";
import {
  DATE_RANGE_ERROR_MESSAGES,
  dateOnlyToString,
  resolvePreset,
  validateDateRangeStrings,
} from "@/lib/date-range";
import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type {
  AccountBreakdownEntry,
  MarketplaceAnalyticsKpisDto,
  MarketplaceFilter,
} from "@/types/marketplace-analytics";

const MARKETPLACE_FILTER_VALUES: MarketplaceFilter[] = [
  "ALL",
  "MERCADO_LIVRE",
  "AMAZON",
  "SHOPEE",
];

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

function accountDisplayLabel(account: AccountBreakdownEntry): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.accountId.slice(0, 8)}`;
}

function DashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [scopeData, setScopeData] = useState<MarketplaceAnalyticsKpisDto | null>(null);
  const [scopeError, setScopeError] = useState(false);
  const [scopeRequestKey, setScopeRequestKey] = useState<string | null>(null);

  const [accountScopedData, setAccountScopedData] =
    useState<MarketplaceAnalyticsKpisDto | null>(null);
  const [accountScopedError, setAccountScopedError] = useState(false);
  const [accountScopedRequestKey, setAccountScopedRequestKey] = useState<
    string | null
  >(null);

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

  const loadScope = useCallback(
    async (from: string, to: string, mkt: MarketplaceFilter) => {
      const seq = ++scopeRequestSeqRef.current;
      const key = `${mkt}|${from}|${to}`;
      try {
        const data = await fetchMarketplaceAnalyticsKpis({ from, to, marketplace: mkt });
        // Uma requisição mais nova já começou enquanto esta estava em voo —
        // esta resposta chegou tarde demais e nunca pode substituir o
        // escopo atual (nem sucesso, nem erro, nem a chave de carregamento).
        if (scopeRequestSeqRef.current !== seq) return;
        setScopeData(data);
        setScopeError(false);
      } catch {
        if (scopeRequestSeqRef.current !== seq) return;
        setScopeData(null);
        setScopeError(true);
      } finally {
        if (scopeRequestSeqRef.current === seq) {
          setScopeRequestKey(key);
        }
      }
    },
    [],
  );

  useEffect(() => {
    // Primeira instrução é o `await` dentro de `loadScope` — nenhum
    // `setState` roda de forma síncrona no corpo deste efeito.
    if (!effectiveFrom || !effectiveTo) return;
    void (async () => {
      await loadScope(effectiveFrom, effectiveTo, marketplace);
    })();
  }, [effectiveFrom, effectiveTo, marketplace, loadScope]);

  const loadAccountScoped = useCallback(
    async (from: string, to: string, mkt: MarketplaceFilter, account: string) => {
      const seq = ++accountScopedRequestSeqRef.current;
      const key = `${mkt}|${account}|${from}|${to}`;
      try {
        const data = await fetchMarketplaceAnalyticsKpis({
          from,
          to,
          marketplace: mkt,
          accountId: account,
        });
        if (accountScopedRequestSeqRef.current !== seq) return;
        setAccountScopedData(data);
        setAccountScopedError(false);
      } catch {
        if (accountScopedRequestSeqRef.current !== seq) return;
        setAccountScopedData(null);
        setAccountScopedError(true);
      } finally {
        if (accountScopedRequestSeqRef.current === seq) {
          setAccountScopedRequestKey(key);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!effectiveFrom || !effectiveTo || !accountId) return;
    void (async () => {
      await loadAccountScoped(effectiveFrom, effectiveTo, marketplace, accountId);
    })();
  }, [effectiveFrom, effectiveTo, marketplace, accountId, loadAccountScoped]);

  const scopeRequestExpectedKey =
    effectiveFrom && effectiveTo ? `${marketplace}|${effectiveFrom}|${effectiveTo}` : null;
  const scopeLoading =
    scopeRequestExpectedKey !== null && scopeRequestKey !== scopeRequestExpectedKey;

  const accountRequestExpectedKey =
    effectiveFrom && effectiveTo && accountId
      ? `${marketplace}|${accountId}|${effectiveFrom}|${effectiveTo}`
      : null;
  const accountScopedLoading =
    accountRequestExpectedKey !== null &&
    accountScopedRequestKey !== accountRequestExpectedKey;

  const displayData = accountId ? accountScopedData : scopeData;
  const displayLoading = accountId ? accountScopedLoading : scopeLoading;
  const displayError = accountId ? accountScopedError : scopeError;

  function handlePeriodChange(range: { from: string; to: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", range.from);
    params.set("to", range.to);
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
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function reloadCurrentScope() {
    if (!effectiveFrom || !effectiveTo) return;
    if (accountId) {
      await loadAccountScoped(effectiveFrom, effectiveTo, marketplace, accountId);
    } else {
      await loadScope(effectiveFrom, effectiveTo, marketplace);
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
    } catch {
      setSyncError("Não foi possível sincronizar agora. Tente novamente.");
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

  const scopeInitialLoading = scopeData === null && !scopeError && scopeLoading;

  if (scopeInitialLoading) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <LoadingBlock label="Carregando..." />
      </div>
    );
  }

  if (scopeError && scopeData === null) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <ErrorBlock
          message="Não foi possível carregar os dados de marketplaces. Tente novamente mais tarde."
          onRetry={() =>
            effectiveFrom && effectiveTo && void loadScope(effectiveFrom, effectiveTo, marketplace)
          }
        />
      </div>
    );
  }

  // Nada elegível em lugar nenhum do sistema (nenhuma conta conectada nem
  // com histórico, para nenhum marketplace) — mesmo estado vazio de antes,
  // agora derivado da disponibilidade do escopo ALL.
  if (
    scopeData &&
    scopeData.scope.marketplace === "ALL" &&
    scopeData.availability === "NOT_CONNECTED"
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

  const dropdownAccounts = scopeData?.breakdownByAccount ?? [];
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
  const connectedMlAccounts = scopedAccounts.filter(
    (a) => a.marketplace === "MERCADO_LIVRE" && a.status === "CONNECTED",
  );
  const historicalAccounts = scopedAccounts.filter(
    (a) => a.availability === "HISTORICAL_ONLY",
  );

  const lastSyncLabel = displayData
    ? (formatDateTimeSaoPaulo(displayData.lastSync) ?? "Nunca sincronizado")
    : null;

  return (
    <div className="flex flex-col gap-8">
      {header}

      <MarketplacePanel breakdown={breakdownByMarketplace} />
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

      {effectivePeriod ? (
        <DateRangeFilter
          from={effectivePeriod.from}
          to={effectivePeriod.to}
          onChange={handlePeriodChange}
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
          ) : displayError ? (
            <ErrorBlock
              message="Não foi possível carregar os KPIs agora."
              onRetry={() => void reloadCurrentScope()}
            />
          ) : displayData?.summary && displayData.comparison ? (
            <div className="flex flex-col gap-6">
              <DataCoverageBanner coverage={displayData.dataCoverage} />

              <KpiSummaryCards
                summary={displayData.summary}
                comparison={displayData.comparison}
              />
              <p className="text-xs text-foreground/50">
                Faturamento bruto: soma dos pedidos pagos antes de tarifas,
                fretes, reembolsos, impostos e Ads.
              </p>

              <AdditionalKpiCards
                summary={displayData.summary}
                comparison={displayData.comparison}
                bestDay={displayData.bestDay}
              />

              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Faturamento diário</h2>
                <DailyRevenueChart dailySeries={displayData.dailySeries} />
              </div>

              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">Ranking de produtos</h2>
                <ProductRankingTabs
                  bySku={displayData.topProductsBySku}
                  byListing={displayData.topListings}
                />
              </div>
            </div>
          ) : displayData ? (
            <div className="flex flex-col gap-4">
              <DataCoverageBanner coverage={displayData.dataCoverage} />
              <p className="text-sm text-foreground/60">
                {displayData.availability === "NOT_CONNECTED"
                  ? "Nenhuma conta elegível para este filtro."
                  : "Esta conta ainda não tem nenhuma sincronização concluída — nenhum KPI para exibir ainda."}
              </p>
            </div>
          ) : null}
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
