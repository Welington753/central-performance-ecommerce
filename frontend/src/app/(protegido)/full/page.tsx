"use client";

import { Suspense } from "react";
import Link from "next/link";
import { DataCoverageBanner } from "@/components/DataCoverageBanner";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { EmptyStateIcon } from "@/components/EmptyState";
import { FullPerformanceSection } from "@/components/FullPerformanceSection";
import { ScopeFilters } from "@/components/ScopeFilters";
import {
  defaultPeriodStrings,
  useMarketplaceAnalyticsScope,
} from "@/hooks/useMarketplaceAnalyticsScope";

/**
 * Página dedicada às seções Mercado Livre Full / Shopee Full, extraídas do
 * Dashboard (que passa a ser resumo executivo) — reutiliza o mesmo hook de
 * escopo (`useMarketplaceAnalyticsScope`), o mesmo `FullPerformanceSection`
 * e os mesmos tipos/API do Dashboard, nunca duplicando consultas ou
 * fórmulas.
 */

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

const header = (
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Full</h1>
    <p className="mt-1 text-sm text-foreground/60">
      Desempenho da logística Full do Mercado Livre e da Shopee.
    </p>
  </div>
);

function FullContent() {
  const {
    period,
    effectivePeriod,
    marketplace,
    accountId,
    allTime,
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
    effectiveFinancialMarketplace,
    handlePeriodChange,
    handleAllTimeChange,
    handleScopeChange,
    reloadCurrentScope,
    retryScopeLoad,
  } = useMarketplaceAnalyticsScope();

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
              Conecte uma conta para ver o desempenho Full aqui.
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

  const showMercadoLivreFull =
    displayData?.full != null &&
    effectiveFinancialMarketplace !== "AMAZON" &&
    effectiveFinancialMarketplace !== "SHOPEE";
  const showShopeeFull =
    displayData?.shopeeFull != null &&
    effectiveFinancialMarketplace !== "AMAZON" &&
    effectiveFinancialMarketplace !== "MERCADO_LIVRE";

  return (
    <div className="flex flex-col gap-8">
      {header}

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
      ) : displayLoading ? (
        <LoadingBlock label="Carregando dados do Full..." />
      ) : displayFatalError ? (
        <ErrorBlock
          message={
            displayAuthFatal
              ? "Sessão expirada ou sem permissão para este escopo. Entre novamente."
              : "Não foi possível carregar os dados do Full agora."
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

          {displayData ? (
            <DataCoverageBanner
              coverage={displayData.dataCoverage}
              requestedPeriod={!allTime && effectivePeriod ? effectivePeriod : undefined}
            />
          ) : null}

          {showMercadoLivreFull || showShopeeFull ? (
            <div className="flex flex-col gap-10">
              {showMercadoLivreFull && displayData?.full ? (
                <FullPerformanceSection full={displayData.full} title="Mercado Livre Full" />
              ) : null}
              {showShopeeFull && displayData?.shopeeFull ? (
                <FullPerformanceSection
                  full={displayData.shopeeFull}
                  title="Shopee Full"
                  description="Pedidos processados pela logística Full da Shopee."
                />
              ) : null}
            </div>
          ) : displayData ? (
            <p className="text-sm text-foreground/60">
              {displayData.availability === "NOT_CONNECTED"
                ? "Nenhuma conta elegível para este filtro."
                : "Nenhum dado de Full disponível para este escopo."}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function FullPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-8">
          <LoadingBlock label="Carregando..." />
        </div>
      }
    >
      <FullContent />
    </Suspense>
  );
}
