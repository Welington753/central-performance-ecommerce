"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/problems/ConfirmDialog";
import { CoverageAccountCard } from "@/components/problems/CoverageAccountCard";
import { EmptyState, Notice, Skeleton } from "@/components/problems/ProblemsStates";
import {
  changeProblemsHistoricalSync,
  changeProblemsSync,
  fetchProblemsSummary,
  fetchProblemsSyncStatus,
} from "@/lib/problems-api";
import { coverageControls, type CoverageControl } from "@/lib/problems-coverage";
import { accountDisplayName } from "@/lib/problems-format";
import type { ProblemsCoverageAccountDto, ProblemsFilters, ProblemsSyncStatusDto } from "@/types/problems";

interface PendingControl {
  accountId: string;
  control: CoverageControl;
}

/** Cobertura por conta. Controles só para `problems.sync`; a confirmação precede toda mudança. */
export function CoverageTab({ filters, canSync }: { filters: ProblemsFilters; canSync: boolean }) {
  const [accounts, setAccounts] = useState<ProblemsCoverageAccountDto[] | null>(null);
  const [statuses, setStatuses] = useState<ProblemsSyncStatusDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingControl | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([fetchProblemsSummary(filters), canSync ? fetchProblemsSyncStatus() : Promise.resolve([])])
      .then(([summary, nextStatuses]) => {
        if (!active) return;
        setAccounts(summary.coverage);
        setStatuses(nextStatuses);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar a cobertura.");
      });
    return () => {
      active = false;
    };
  }, [filters, canSync, reloadKey]);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      const { control, accountId } = pending;
      const updated =
        control.scope === "historical"
          ? await changeProblemsHistoricalSync(accountId, control.action as "pause" | "resume")
          : await changeProblemsSync(accountId, control.action);
      setStatuses((current) => current.map((item) => (item.accountId === accountId ? updated : item)));
      setPending(null);
      reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Falha ao alterar a sincronização.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <Notice tone="error" onRetry={reload}>
        {error}
      </Notice>
    );
  }
  if (!accounts) {
    return (
      <div role="status" aria-label="Carregando cobertura" className="flex flex-col gap-3">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (accounts.length === 0) return <EmptyState>Nenhuma conta com cobertura para os filtros selecionados.</EmptyState>;

  return (
    <div className="flex flex-col gap-3">
      {actionError ? (
        <Notice tone="error" onRetry={reload}>
          {actionError}
        </Notice>
      ) : null}
      {accounts.map((account) => {
        const status = statuses.find((item) => item.accountId === account.accountId);
        const name = accountDisplayName(account.accountNickname, account.marketplace);
        return (
          <CoverageAccountCard
            key={account.accountId}
            account={account}
            controls={canSync && status ? coverageControls(status, name) : []}
            busy={busy}
            workerDisabled={status ? !status.workerEnabled : false}
            onControl={(control) => setPending({ accountId: account.accountId, control })}
          />
        );
      })}
      {pending ? (
        <ConfirmDialog
          message={pending.control.confirm}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
