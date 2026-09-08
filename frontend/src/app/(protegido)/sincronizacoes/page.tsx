"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiFetchError,
  apiFetch,
  fetchAmazonSetupStatus,
  fetchBackfillStatus,
  fetchMarketplaceAccounts,
  pauseBackfill,
  resumeBackfill,
  startBackfill,
  syncAmazonOrders,
  syncMercadoLivreOrders,
} from "@/lib/api";
import { SyncTable } from "@/components/SyncTable";
import { BackfillAccountPanel } from "@/components/BackfillAccountPanel";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { BackfillStatusDto } from "@/types/marketplace-backfill";
import type { SyncRun } from "@/types/sync-run";

/** Estados do job em que ele ainda está "andando" (worker do backend). */
const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING", "RETRY_WAIT"];

// Acompanhamento leve (Fase 4, "Backfill durável") — o worker do BACKEND
// processa o job; esta página só faz polling do status para refletir o
// progresso na tela, nunca dirige o processamento (nenhum loop client-side
// chamando next-chunk). Fechar a aba nunca pausa o job.
const BACKFILL_POLL_INTERVAL_MS = 4000;

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

  const [mlAccounts, setMlAccounts] = useState<
    Array<{ accountId: string; label: string }>
  >([]);
  const [backfillStatuses, setBackfillStatuses] = useState<
    Record<string, BackfillStatusDto | null>
  >({});
  const [backfillLoadErrors, setBackfillLoadErrors] = useState<
    Record<string, boolean>
  >({});
  const [backfillErrors, setBackfillErrors] = useState<
    Record<string, string | null>
  >({});
  // Ação (start/pause/resume) em voo por conta — só bloqueia clique duplo NA
  // MESMA conta; o worker do backend processa cada job de forma
  // independente, então nunca precisa de uma guarda "uma ação por vez"
  // global como o loop antigo tinha.
  const [backfillActionPending, setBackfillActionPending] = useState<
    Record<string, boolean>
  >({});
  const [runningAllBackfill, setRunningAllBackfill] = useState(false);
  const backfillActionPendingRef = useRef<Record<string, boolean>>({});

  const loadBackfillStatus = useCallback(async (accountId: string) => {
    try {
      const status = await fetchBackfillStatus(accountId);
      setBackfillStatuses((prev) => ({ ...prev, [accountId]: status }));
      setBackfillLoadErrors((prev) => ({ ...prev, [accountId]: false }));
      return status;
    } catch {
      setBackfillLoadErrors((prev) => ({ ...prev, [accountId]: true }));
      return null;
    }
  }, []);

  const setActionPending = useCallback((accountId: string, pending: boolean) => {
    backfillActionPendingRef.current = {
      ...backfillActionPendingRef.current,
      [accountId]: pending,
    };
    setBackfillActionPending(backfillActionPendingRef.current);
  }, []);

  // Corpo comum de start/pause/resume: aplica a ação, guarda de reentrância
  // síncrona (lida/escrita na ref, nunca no estado — clique duplo muito
  // rápido não abre uma segunda janela antes do botão desabilitar
  // visualmente), erro isolado por conta (nunca derruba outra conta nem a
  // página).
  const runBackfillAction = useCallback(
    async (
      accountId: string,
      action: (id: string) => Promise<BackfillStatusDto>,
    ) => {
      if (backfillActionPendingRef.current[accountId]) return;
      setActionPending(accountId, true);
      setBackfillErrors((prev) => ({ ...prev, [accountId]: null }));
      try {
        const status = await action(accountId);
        setBackfillStatuses((prev) => ({ ...prev, [accountId]: status }));
        setBackfillLoadErrors((prev) => ({ ...prev, [accountId]: false }));
      } catch (error) {
        const message =
          error instanceof ApiFetchError
            ? error.message
            : "Não foi possível iniciar o histórico.";
        setBackfillErrors((prev) => ({ ...prev, [accountId]: message }));
      } finally {
        setActionPending(accountId, false);
      }
    },
    [setActionPending],
  );

  const handleStartBackfill = useCallback(
    (accountId: string) => runBackfillAction(accountId, startBackfill),
    [runBackfillAction],
  );
  const handlePauseBackfill = useCallback(
    (accountId: string) => runBackfillAction(accountId, pauseBackfill),
    [runBackfillAction],
  );
  const handleResumeBackfill = useCallback(
    (accountId: string) => runBackfillAction(accountId, resumeBackfill),
    [runBackfillAction],
  );

  // "Completar histórico de todas as lojas": só ENFILEIRA (chama `start`)
  // para as duas contas — o worker do backend decide como processar cada
  // job de forma controlada. Nunca executa chunks aqui; nunca deixa uma
  // conta com erro bloquear a outra (`Promise.allSettled`).
  async function handleCompleteAllHistory() {
    if (mlAccounts.length === 0) return;
    setRunningAllBackfill(true);
    try {
      await Promise.allSettled(
        mlAccounts.map((account) => handleStartBackfill(account.accountId)),
      );
    } finally {
      setRunningAllBackfill(false);
    }
  }

  // Polling leve só para acompanhamento (Fase 4, "Backfill durável") —
  // nunca dirige o processamento. Continua enquanto QUALQUER conta ML tiver
  // um job em andamento; desmontar o componente só limpa o timer, nunca
  // pausa o job (ele roda no backend, independente da aba).
  const anyJobActive = mlAccounts.some((account) => {
    const job = backfillStatuses[account.accountId]?.job;
    return job !== null && job !== undefined && ACTIVE_JOB_STATUSES.includes(job.status);
  });

  useEffect(() => {
    if (!anyJobActive || mlAccounts.length === 0) return;
    const intervalId = setInterval(() => {
      mlAccounts.forEach((account) => {
        void loadBackfillStatus(account.accountId);
      });
    }, BACKFILL_POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [anyJobActive, mlAccounts, loadBackfillStatus]);

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

      const connectedMl = accounts.filter(
        (item) =>
          item.marketplace === "MERCADO_LIVRE" && item.status === "CONNECTED",
      );
      const nextMlAccounts = connectedMl.map((item) => ({
        accountId: item.id,
        label: accountLabel(item),
      }));
      setMlAccounts(nextMlAccounts);
      await Promise.all(
        nextMlAccounts.map((item) => loadBackfillStatus(item.accountId)),
      );
    } catch {
      setRowsLoadError(true);
    }
  }, [loadBackfillStatus]);

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

      <section className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Completar histórico</h2>
            <p className="mt-1 text-sm text-foreground/60">
              Busca vendas antigas do Mercado Livre até o primeiro período
              disponível para cada conta — diferente de &quot;Sincronizar
              agora&quot;, que atualiza somente vendas recentes e alterações.
            </p>
          </div>
          {mlAccounts.length > 1 ? (
            <button
              type="button"
              onClick={() => void handleCompleteAllHistory()}
              disabled={runningAllBackfill}
              className="rounded-md border border-brand bg-brand/10 px-4 py-2 text-sm font-semibold text-brand transition-colors hover:bg-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {runningAllBackfill
                ? "Enfileirando..."
                : "Completar histórico de todas as lojas"}
            </button>
          ) : null}
        </div>

        {mlAccounts.length === 0 ? (
          <p className="text-sm text-foreground/60">
            Nenhuma conta do Mercado Livre conectada ainda.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {mlAccounts.map((mlAccount) => (
              <BackfillAccountPanel
                key={mlAccount.accountId}
                label={mlAccount.label}
                status={backfillStatuses[mlAccount.accountId] ?? null}
                loadError={backfillLoadErrors[mlAccount.accountId] ?? false}
                actionPending={
                  backfillActionPending[mlAccount.accountId] ?? false
                }
                disabled={runningAllBackfill}
                errorMessage={backfillErrors[mlAccount.accountId] ?? null}
                onStart={() => void handleStartBackfill(mlAccount.accountId)}
                onPause={() => void handlePauseBackfill(mlAccount.accountId)}
                onResume={() => void handleResumeBackfill(mlAccount.accountId)}
              />
            ))}
          </div>
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
