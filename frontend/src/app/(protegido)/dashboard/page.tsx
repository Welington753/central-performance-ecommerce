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
import { ProductRankingTabs } from "@/components/ProductRankingTabs";
import {
  fetchMarketplaceAccounts,
  fetchMercadoLivreKpis,
  syncMercadoLivreOrders,
} from "@/lib/api";
import {
  DATE_RANGE_ERROR_MESSAGES,
  dateOnlyToString,
  resolvePreset,
  validateDateRangeStrings,
} from "@/lib/date-range";
import { formatDateTimeSaoPaulo } from "@/lib/kpi-format";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { MercadoLivreKpisDto } from "@/types/mercado-livre-kpis";

function accountLabel(account: MarketplaceAccountDto): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.id.slice(0, 8)}`;
}

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

function DashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [accounts, setAccounts] = useState<MarketplaceAccountDto[] | null>(
    null,
  );
  const [accountsError, setAccountsError] = useState(false);
  const [manualAccountId, setManualAccountId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<MercadoLivreKpisDto | null>(null);
  const [kpisError, setKpisError] = useState(false);
  const [kpisRequestKey, setKpisRequestKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const loadAccounts = useCallback(async () => {
    try {
      const all = await fetchMarketplaceAccounts();
      setAccounts(all);
      setAccountsError(false);
    } catch {
      setAccountsError(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadAccounts();
    })();
  }, [loadAccounts]);

  const connectedAccounts = (accounts ?? []).filter(
    (account) =>
      account.marketplace === "MERCADO_LIVRE" && account.status === "CONNECTED",
  );
  const selectedAccountId =
    manualAccountId &&
    connectedAccounts.some((account) => account.id === manualAccountId)
      ? manualAccountId
      : (connectedAccounts[0]?.id ?? null);

  const period = readPeriodFromSearchParams(searchParams);
  const effectivePeriod = resolveEffectivePeriod(period);
  const requestKey =
    selectedAccountId && effectivePeriod
      ? `${selectedAccountId}|${effectivePeriod.from}|${effectivePeriod.to}`
      : null;

  const loadKpis = useCallback(
    async (accountId: string, from: string, to: string) => {
      const key = `${accountId}|${from}|${to}`;
      try {
        const data = await fetchMercadoLivreKpis(accountId, { from, to });
        setKpis(data);
        setKpisError(false);
      } catch {
        setKpis(null);
        setKpisError(true);
      } finally {
        setKpisRequestKey(key);
      }
    },
    [],
  );

  const effectiveFrom = effectivePeriod?.from ?? null;
  const effectiveTo = effectivePeriod?.to ?? null;

  useEffect(() => {
    if (!selectedAccountId || !effectiveFrom || !effectiveTo) return;
    void (async () => {
      await loadKpis(selectedAccountId, effectiveFrom, effectiveTo);
    })();
  }, [selectedAccountId, effectiveFrom, effectiveTo, loadKpis]);

  const kpisLoading = requestKey !== null && kpisRequestKey !== requestKey;

  function handlePeriodChange(range: { from: string; to: string }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", range.from);
    params.set("to", range.to);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  async function handleSync() {
    if (!selectedAccountId || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      await syncMercadoLivreOrders(selectedAccountId);
      if (effectivePeriod) {
        await loadKpis(selectedAccountId, effectivePeriod.from, effectivePeriod.to);
      }
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
        Central de Performance E-commerce
      </h1>
      <p className="mt-1 text-sm text-foreground/60">
        Visão geral consolidada dos seus marketplaces.
      </p>
    </div>
  );

  const accountsLoading = accounts === null && !accountsError;

  if (accountsLoading) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <LoadingBlock label="Carregando..." />
      </div>
    );
  }

  if (accountsError) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <ErrorBlock
          message="Não foi possível carregar suas contas de marketplace. Tente novamente mais tarde."
          onRetry={() => void loadAccounts()}
        />
      </div>
    );
  }

  if (connectedAccounts.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        {header}
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
          <EmptyStateIcon />
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">
              Nenhuma conta do Mercado Livre conectada
            </p>
            <p className="text-sm text-foreground/60">
              Conecte uma conta para ver seus KPIs de vendas aqui.
            </p>
          </div>
          <Link
            href="/integracoes"
            className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5"
          >
            Conectar Mercado Livre
          </Link>
        </div>
      </div>
    );
  }

  const lastSyncLabel = kpis
    ? (formatDateTimeSaoPaulo(kpis.lastSync) ?? "Nunca sincronizado")
    : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {header}

        {connectedAccounts.length > 1 ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/60">Conta do Mercado Livre</span>
            <select
              aria-label="Conta do Mercado Livre"
              value={selectedAccountId ?? ""}
              onChange={(event) => setManualAccountId(event.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-3 py-1.5"
            >
              {connectedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountLabel(account)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface px-5 py-4">
        <p className="text-sm text-foreground/60">
          Última sincronização:{" "}
          <span className="font-medium text-foreground">
            {lastSyncLabel ?? "—"}
          </span>
        </p>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing}
          className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {syncing ? "Sincronizando..." : "Sincronizar agora"}
        </button>
      </div>

      {syncError ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
        >
          {syncError}
        </div>
      ) : null}

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
      ) : kpisLoading ? (
        <LoadingBlock label="Carregando KPIs..." />
      ) : kpisError ? (
        <ErrorBlock
          message="Não foi possível carregar os KPIs agora."
          onRetry={() =>
            selectedAccountId &&
            effectivePeriod &&
            void loadKpis(
              selectedAccountId,
              effectivePeriod.from,
              effectivePeriod.to,
            )
          }
        />
      ) : kpis ? (
        <div className="flex flex-col gap-6">
          <DataCoverageBanner coverage={kpis.dataCoverage} />

          <KpiSummaryCards summary={kpis.summary} comparison={kpis.comparison} />
          <p className="text-xs text-foreground/50">
            Faturamento bruto: soma dos pedidos pagos antes de tarifas,
            fretes, reembolsos, impostos e Ads.
          </p>

          <AdditionalKpiCards
            summary={kpis.summary}
            comparison={kpis.comparison}
            bestDay={kpis.bestDay}
          />

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Faturamento diário</h2>
            <DailyRevenueChart dailySeries={kpis.dailySeries} />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Ranking de produtos</h2>
            <ProductRankingTabs
              bySku={kpis.topProductsBySku}
              byListing={kpis.topListings}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function defaultPeriodStrings(): { from: string; to: string } {
  const range = resolvePreset("last30");
  return { from: dateOnlyToString(range.from), to: dateOnlyToString(range.to) };
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
