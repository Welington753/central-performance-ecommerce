"use client";

import { useCallback, useEffect, useState } from "react";
import {
  changeProblemsSync,
  fetchProblemsSyncStatus,
  type ProblemsSyncAction,
} from "@/lib/problems-api";
import {
  accountDisplayName,
  formatDateTime,
  jobErrorLabel,
  jobStatusLabel,
} from "@/lib/problems-format";
import type { ProblemsSyncStatusDto } from "@/types/problems";

export const WORKER_DISABLED_TEXT =
  "O job de sincronização está preparado, mas o servidor ainda não vai processá-lo. Ele só começa a rodar quando a sincronização automática de problemas for ativada no servidor.";

/** Ação oferecida por estado do job — `null` = nada a fazer (ex.: já ativo e sem pausa pedida). */
function actionsFor(status: ProblemsSyncStatusDto): Array<{ action: ProblemsSyncAction; label: string }> {
  switch (status.jobStatus) {
    case "NOT_STARTED":
      return [{ action: "start", label: "Iniciar" }];
    case "RUNNING":
    case "WAITING_RETRY":
      return status.pauseRequested ? [] : [{ action: "pause", label: "Pausar" }];
    case "PAUSED":
    case "FAILED":
    case "FAILED_AUTH":
      return [{ action: "resume", label: "Retomar" }];
  }
}

/** Painel de sincronização — só é montado para quem tem `problems.sync` (o backend revalida cada ação). */
export function ProblemsSyncPanel({ onChanged }: { onChanged: () => void }) {
  const [statuses, setStatuses] = useState<ProblemsSyncStatusDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    fetchProblemsSyncStatus()
      .then((next) => {
        if (!active) return;
        setStatuses(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar a sincronização.");
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  async function run(accountId: string, action: ProblemsSyncAction) {
    setBusyAccount(accountId);
    setError(null);
    try {
      const updated = await changeProblemsSync(accountId, action);
      setStatuses((current) => current?.map((item) => (item.accountId === accountId ? updated : item)) ?? current);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao alterar a sincronização.");
    } finally {
      setBusyAccount(null);
    }
  }

  const workerDisabled = statuses?.some((status) => !status.workerEnabled) ?? false;

  return (
    <section aria-label="Sincronização de problemas" className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-5 py-4">
      <h2 className="text-base font-semibold">Sincronização</h2>
      {workerDisabled ? (
        <p role="note" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
          {WORKER_DISABLED_TEXT}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-2 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={reload} className="rounded-md border border-red-500/40 px-2 py-1">
            Tentar novamente
          </button>
        </div>
      ) : null}
      {statuses === null && !error ? <p role="status" className="text-sm text-foreground/60">Carregando sincronização...</p> : null}
      {statuses?.length === 0 ? (
        <p className="text-sm text-foreground/60">Nenhuma conta do Mercado Livre disponível para sincronizar.</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {statuses?.map((status) => {
          const errorText = jobErrorLabel(status.lastErrorCode);
          return (
            <li key={status.accountId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-subtle px-3 py-2 text-sm">
              <div className="flex flex-col">
                <span className="font-medium">{accountDisplayName(status.accountNickname, "MERCADO_LIVRE")}</span>
                <span className="text-foreground/60">
                  {jobStatusLabel(status.jobStatus)}
                  {status.jobStatus !== "NOT_STARTED" ? ` · última atividade ${formatDateTime(status.lastActivityAt)}` : ""}
                </span>
                {errorText ? <span className="text-red-700">{errorText}</span> : null}
                {status.pauseRequested ? <span className="text-foreground/60">Pausa solicitada — conclui o ciclo em andamento.</span> : null}
              </div>
              <div className="flex gap-2">
                {actionsFor(status).map(({ action, label }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={busyAccount === status.accountId}
                    onClick={() => void run(status.accountId, action)}
                    className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-50"
                    aria-label={`${label} sincronização de ${accountDisplayName(status.accountNickname, "MERCADO_LIVRE")}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
