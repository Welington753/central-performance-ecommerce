"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmptyStateIcon } from "@/components/EmptyState";
import { KpiSummaryCards } from "@/components/KpiSummaryCards";
import { TopProductsRanking } from "@/components/TopProductsRanking";
import {
  fetchMarketplaceAccounts,
  fetchMercadoLivreKpis,
  syncMercadoLivreOrders,
} from "@/lib/api";
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

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<MarketplaceAccountDto[] | null>(
    null,
  );
  const [accountsError, setAccountsError] = useState(false);
  const [manualAccountId, setManualAccountId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<MercadoLivreKpisDto | null>(null);
  const [kpisError, setKpisError] = useState(false);
  // Conta a que `kpis`/`kpisError` atualmente se referem — permite derivar o
  // estado de carregamento (`kpisLoading` abaixo) sem `setState` síncrono
  // dentro do efeito de busca (ver comentário no efeito).
  const [kpisAccountId, setKpisAccountId] = useState<string | null>(null);
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
  // Derivado a cada render (nunca sincronizado via efeito): a conta manual
  // só "gruda" enquanto ainda estiver entre as conectadas; caso contrário
  // cai de volta para a primeira conectada.
  const selectedAccountId =
    manualAccountId &&
    connectedAccounts.some((account) => account.id === manualAccountId)
      ? manualAccountId
      : (connectedAccounts[0]?.id ?? null);

  const loadKpis = useCallback(async (accountId: string) => {
    try {
      const data = await fetchMercadoLivreKpis(accountId);
      setKpis(data);
      setKpisError(false);
    } catch {
      setKpis(null);
      setKpisError(true);
    } finally {
      setKpisAccountId(accountId);
    }
  }, []);

  useEffect(() => {
    // Primeira instrução é o `await` dentro de `loadKpis` — nenhum
    // `setState` roda de forma síncrona no corpo deste efeito.
    if (!selectedAccountId) return;
    void (async () => {
      await loadKpis(selectedAccountId);
    })();
  }, [selectedAccountId, loadKpis]);

  const kpisLoading =
    selectedAccountId !== null && kpisAccountId !== selectedAccountId;

  async function handleSync() {
    if (!selectedAccountId || syncingRef.current) return; // trava síncrona: impede clique duplo em voo
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    try {
      await syncMercadoLivreOrders(selectedAccountId);
      await loadKpis(selectedAccountId);
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

      {kpisLoading ? (
        <LoadingBlock label="Carregando KPIs..." />
      ) : kpisError ? (
        <ErrorBlock
          message="Não foi possível carregar os KPIs agora."
          onRetry={() => selectedAccountId && void loadKpis(selectedAccountId)}
        />
      ) : kpis ? (
        <div className="flex flex-col gap-6">
          <KpiSummaryCards
            summary={kpis.summary}
            comparison={kpis.comparison}
          />
          <p className="text-xs text-foreground/50">
            Faturamento bruto: soma dos pedidos pagos antes de tarifas,
            fretes, reembolsos, impostos e Ads.
          </p>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Produtos mais vendidos</h2>
            <TopProductsRanking products={kpis.topProducts} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
