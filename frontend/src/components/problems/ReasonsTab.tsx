"use client";

import { useMemo } from "react";
import { ChartLegend, seriesStyle } from "@/components/problems/ProblemsChartParts";
import { EmptyState, Notice, Skeleton } from "@/components/problems/ProblemsStates";
import { formatInteger, formatPercent } from "@/lib/problems-monthly-format";
import type { ProblemReasonOptionDto } from "@/types/problems";

interface ReasonsTabProps {
  /** `null` = carregando ou falhou (nunca uma lista vazia inventada). */
  reasons: ProblemReasonOptionDto[] | null;
  error: string | null;
  /** Alguma conta/mês com cobertura parcial: a distribuição cobre só o que já foi sincronizado. */
  partial: boolean;
  onRetry: () => void;
  onSelectReason: (reasonId: string) => void;
}

/** Distribuição COMPLETA de motivos do período (endpoint de motivos, sem top N). */
export function ReasonsTab({ reasons, error, partial, onRetry, onSelectReason }: ReasonsTabProps) {
  const accounts = useMemo(() => {
    const byId = new Map<string, string>();
    for (const reason of reasons ?? []) {
      for (const entry of reason.byAccount) {
        byId.set(entry.accountId, entry.accountNickname ?? "Conta");
      }
    }
    return [...byId.entries()]
      .map(([accountId, label]) => ({ accountId, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [reasons]);

  if (error) {
    return (
      <Notice tone="error" onRetry={onRetry}>
        {error}
      </Notice>
    );
  }
  if (reasons === null) {
    return (
      <div role="status" aria-label="Carregando motivos" className="flex flex-col gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (reasons.length === 0) {
    return <EmptyState>Nenhum motivo registrado para o período e as contas selecionados.</EmptyState>;
  }
  const max = Math.max(1, ...reasons.map((reason) => reason.count));

  return (
    <section aria-label="Distribuição de motivos" className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <h2 className="text-sm font-semibold">Motivos no período</h2>
      {partial ? (
        <Notice tone="warn">
          Cobertura parcial: a distribuição considera só os problemas já sincronizados. Veja a aba Cobertura.
        </Notice>
      ) : null}
      <ChartLegend labels={accounts.map((account) => account.label)} partialNote={false} />
      <ol className="flex flex-col gap-3">
        {reasons.map((reason) => (
          <li key={reason.reasonId} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <button
                type="button"
                onClick={() => onSelectReason(reason.reasonId)}
                title={`Código do motivo: ${reason.reasonId}. Ver casos deste motivo`}
                className="text-left text-sm font-medium underline decoration-dotted underline-offset-4 hover:text-brand"
              >
                {reason.reasonLabel}
              </button>
              <span className="text-sm">
                {formatInteger(reason.count)} · {formatPercent(reason.percentage)}
              </span>
            </div>
            <span className="text-[11px] text-foreground/60">{reason.reasonId}</span>
            <ul aria-label={`${reason.reasonLabel} por conta`} className="flex flex-col gap-1">
              {accounts.map((account, index) => {
                const count = reason.byAccount.find((entry) => entry.accountId === account.accountId)?.count ?? 0;
                return (
                  <li key={account.accountId} className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
                    <div className="h-2.5 rounded bg-foreground/10" aria-hidden="true">
                      <div className={`h-2.5 rounded ${seriesStyle(index).bar}`} style={{ width: `${(count / max) * 100}%` }} />
                    </div>
                    <span className="whitespace-nowrap">
                      <span aria-hidden="true" className={seriesStyle(index).text}>
                        {seriesStyle(index).symbol}{" "}
                      </span>
                      {account.label}: {formatInteger(count)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      <p className="text-xs text-foreground/70">
        Percentuais sobre o total de problemas do período. Cada barra mostra a quantidade do motivo na conta.
      </p>
    </section>
  );
}
