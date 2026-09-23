"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { AdditionalKpiCards } from "@/components/AdditionalKpiCards";
import { CancellationsPanel } from "@/components/CancellationsPanel";
import { DailyRevenueChart } from "@/components/DailyRevenueChart";
import { DataCoverageBanner } from "@/components/DataCoverageBanner";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { EmptyStateIcon } from "@/components/EmptyState";
import { ExpensesAndResultSection } from "@/components/ExpensesAndResultSection";
import { FinancialKpiCards } from "@/components/FinancialKpiCards";
import { KpiSummaryCards } from "@/components/KpiSummaryCards";
import { LogisticsScopeFilter } from "@/components/LogisticsScopeFilter";
import { LogisticsScopeCoverageNotice } from "@/components/LogisticsScopeCoverageNotice";
import { MarketplacePanel } from "@/components/MarketplacePanel";
import { OperationalKpiCards } from "@/components/OperationalKpiCards";
import { ProductRankingTabs } from "@/components/ProductRankingTabs";
import { ScopeFilters } from "@/components/ScopeFilters";
import { ApiFetchError, syncMercadoLivreOrders } from "@/lib/api";
import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import {
  defaultPeriodStrings,
  marketplaceSupportsLogisticsScope,
  useMarketplaceAnalyticsScope,
} from "@/hooks/useMarketplaceAnalyticsScope";
import type {
  AccountBreakdownEntry,
  AnalyticsComparison,
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
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const {
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
    retryScopeLoad,
  } = useMarketplaceAnalyticsScope();

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
          onRetry={retryScopeLoad}
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

      {marketplaceSupportsLogisticsScope(marketplace) ? (
        <>
          <LogisticsScopeFilter
            value={logisticsScope}
            onChange={handleLogisticsScopeChange}
          />
          <LogisticsScopeCoverageNotice
            logisticsScope={logisticsScope}
            full={
              (marketplace === "SHOPEE"
                ? displayData?.shopeeFull
                : displayData?.full) ?? null
            }
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
