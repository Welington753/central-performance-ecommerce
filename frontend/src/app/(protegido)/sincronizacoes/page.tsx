"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiFetchError,
  apiFetch,
  fetchAmazonSetupStatus,
  fetchMarketplaceAccounts,
  syncAmazonOrders,
  syncMercadoLivreOrders,
} from "@/lib/api";
import { SyncTable } from "@/components/SyncTable";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { SyncRun } from "@/types/sync-run";

function isSyncRunArray(value: unknown): value is SyncRun[] {
  return Array.isArray(value);
}

// Mesmas mensagens do dashboard (ver dashboard/page.tsx) — nunca o código
// cru nem qualquer detalhe interno do backend.
const SYNC_ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_CONNECTED:
    "Esta conta não está mais conectada. Reconecte-a em Integrações.",
  SYNC_ALREADY_RUNNING:
    "Já existe uma sincronização em andamento para esta conta.",
  TOKEN_EXPIRED: "O marketplace encerrou o acesso desta conta. Reconecte-a.",
  ACCOUNT_BUSY:
    "Esta conta está processando outra operação agora. Tente novamente em instantes.",
  PROVIDER_RATE_LIMITED:
    "O marketplace limitou as requisições no momento. Tente novamente em alguns minutos.",
  INVALID_PROVIDER_RESPONSE:
    "O marketplace retornou uma resposta inesperada. Tente novamente mais tarde.",
  PROVIDER_UNAVAILABLE:
    "O marketplace está indisponível no momento. Tente novamente mais tarde.",
  AMAZON_NOT_CONFIGURED: "Integração Amazon não configurada no servidor.",
};

type AccountOutcome = "PENDING" | "SKIPPED" | "SUCCESS" | "FAILED";

interface AccountSyncRow {
  accountId: string;
  marketplace: "MERCADO_LIVRE" | "AMAZON";
  label: string;
  outcome: AccountOutcome;
  reason: string | null;
}

function accountLabel(account: MarketplaceAccountDto): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.id.slice(0, 8)}`;
}

const OUTCOME_LABELS: Record<AccountOutcome, string> = {
  PENDING: "Aguardando",
  SKIPPED: "Ignorada",
  SUCCESS: "Sincronizada",
  FAILED: "Falhou",
};

export default function SincronizacoesPage() {
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [rows, setRows] = useState<AccountSyncRow[] | null>(null);
  const [rowsLoadError, setRowsLoadError] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const runningRef = useRef(false);

  const loadSyncRuns = useCallback(async () => {
    try {
      const response = await apiFetch("/sync-runs", { method: "GET" });
      if (!response.ok) {
        setSyncRuns([]);
        return;
      }
      const data: unknown = await response.json();
      setSyncRuns(isSyncRunArray(data) ? data : []);
    } catch {
      setSyncRuns([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const [accounts, amazonStatus] = await Promise.all([
        fetchMarketplaceAccounts(),
        fetchAmazonSetupStatus(),
      ]);

      const next: AccountSyncRow[] = [];
      for (const account of accounts) {
        if (account.marketplace !== "MERCADO_LIVRE") continue;
        const eligible = account.status === "CONNECTED";
        next.push({
          accountId: account.id,
          marketplace: "MERCADO_LIVRE",
          label: `Mercado Livre — ${accountLabel(account)}`,
          outcome: eligible ? "PENDING" : "SKIPPED",
          reason: eligible ? null : "Conta não conectada ao Mercado Livre.",
        });
      }
      for (const account of amazonStatus.accounts) {
        const eligible =
          account.status === "CONNECTED" && amazonStatus.applicationConfigured;
        next.push({
          accountId: account.id,
          marketplace: "AMAZON",
          label: `Amazon — ${accountLabel(account)}`,
          outcome: eligible ? "PENDING" : "SKIPPED",
          reason: !amazonStatus.applicationConfigured
            ? "Integração Amazon não configurada no servidor."
            : eligible
              ? null
              : "Conta não conectada à Amazon.",
        });
      }

      setRows(next);
      setRowsLoadError(false);
    } catch {
      setRowsLoadError(true);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadSyncRuns();
    })();
  }, [loadSyncRuns]);

  useEffect(() => {
    void (async () => {
      await loadAccounts();
    })();
  }, [loadAccounts]);

  const pendingCount = rows?.filter((row) => row.outcome === "PENDING").length ?? 0;

  async function handleSyncAll() {
    if (!rows || runningRef.current || pendingCount === 0) return;
    runningRef.current = true;
    setRunning(true);

    const next = [...rows];
    const pendingIndexes = next.reduce<number[]>((acc, row, index) => {
      if (row.outcome === "PENDING") acc.push(index);
      return acc;
    }, []);

    for (let step = 0; step < pendingIndexes.length; step += 1) {
      const index = pendingIndexes[step];
      setProgress({ done: step, total: pendingIndexes.length });
      const row = next[index];
      try {
        if (row.marketplace === "MERCADO_LIVRE") {
          await syncMercadoLivreOrders(row.accountId);
        } else {
          await syncAmazonOrders(row.accountId);
        }
        next[index] = { ...row, outcome: "SUCCESS", reason: null };
      } catch (error) {
        const message =
          error instanceof ApiFetchError
            ? (error.code && SYNC_ERROR_MESSAGES[error.code]) || error.message
            : "Não foi possível sincronizar agora.";
        next[index] = { ...row, outcome: "FAILED", reason: message };
      }
      setRows([...next]);
    }

    setProgress({ done: pendingIndexes.length, total: pendingIndexes.length });
    runningRef.current = false;
    setRunning(false);
    // Painel consolidado só é atualizado ao final do lote inteiro — nunca
    // durante, e nunca por conta individual.
    await loadSyncRuns();
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Sincronizações
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          Sincronize todas as lojas de uma vez ou acompanhe o histórico de
          execuções.
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Sincronizar todas as lojas</h2>
          <button
            type="button"
            onClick={() => void handleSyncAll()}
            disabled={running || !rows || pendingCount === 0}
            className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
          >
            {running
              ? `Sincronizando ${Math.min(
                  (progress?.done ?? 0) + 1,
                  progress?.total ?? 1,
                )} de ${progress?.total ?? 0}`
              : "Sincronizar todas as lojas"}
          </button>
        </div>

        {rowsLoadError ? (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
          >
            Não foi possível carregar as contas de marketplace. Tente
            novamente mais tarde.
          </div>
        ) : !rows ? (
          <p className="text-sm text-foreground/60">Carregando contas...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-foreground/60">
            Nenhuma conta de marketplace cadastrada ainda.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {rows.map((row) => (
              <li
                key={row.accountId}
                data-testid={`sync-all-row-${row.accountId}`}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span className="font-medium">{row.label}</span>
                <span className="flex items-center gap-2 text-foreground/70">
                  <span
                    className={
                      row.outcome === "SUCCESS"
                        ? "text-green-700"
                        : row.outcome === "FAILED"
                          ? "text-red-700"
                          : row.outcome === "SKIPPED"
                            ? "text-foreground/50"
                            : "text-foreground/70"
                    }
                  >
                    {OUTCOME_LABELS[row.outcome]}
                  </span>
                  {row.reason ? (
                    <span className="text-xs text-foreground/50">
                      — {row.reason}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
            role="status"
            aria-label="Carregando sincronizações"
          />
          <p className="text-sm text-foreground/60">
            Carregando sincronizações...
          </p>
        </div>
      ) : (
        <SyncTable syncRuns={syncRuns} />
      )}
    </div>
  );
}
