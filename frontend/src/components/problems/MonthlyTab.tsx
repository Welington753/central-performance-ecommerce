"use client";

import { useMemo, useState } from "react";
import { AccountComparisonTable } from "@/components/problems/AccountComparisonTable";
import { MonthlyBarChart } from "@/components/problems/MonthlyBarChart";
import { MonthlyCards } from "@/components/problems/MonthlyCards";
import { MonthlyRateChart } from "@/components/problems/MonthlyRateChart";
import { EmptyState } from "@/components/problems/ProblemsStates";
import { ReputationImpactChart } from "@/components/problems/ReputationImpactChart";
import {
  aggregateMonthly,
  buildMonthlySeries,
  compareAccounts,
  type MonthlySeries,
} from "@/lib/problems-monthly-aggregate";
import type { ProblemsMonthlyItemDto } from "@/types/problems";

/** Visão mensal: cards do período inteiro + gráficos/tabela; o seletor de conta só afeta os gráficos. */
export function MonthlyTab({ items }: { items: ProblemsMonthlyItemDto[] }) {
  const [accountId, setAccountId] = useState("");
  const fullSeries = useMemo(() => buildMonthlySeries(items), [items]);
  const totals = useMemo(() => aggregateMonthly(items), [items]);
  const shown: MonthlySeries = useMemo(
    () => ({
      months: fullSeries.months,
      accounts: accountId
        ? fullSeries.accounts.filter((account) => account.accountId === accountId)
        : fullSeries.accounts,
    }),
    [fullSeries, accountId],
  );

  if (items.length === 0) {
    return <EmptyState>Nenhum dado mensal para o período e as contas selecionados.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-4">
      <MonthlyCards totals={totals} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="monthly-account" className="text-foreground/70">
          Contas nos gráficos
        </label>
        <select
          id="monthly-account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="rounded-md border border-border-subtle bg-background px-2 py-1"
        >
          <option value="">Todas</option>
          {fullSeries.accounts.map((account) => (
            <option key={account.accountId} value={account.accountId}>
              {account.label}
            </option>
          ))}
        </select>
      </div>
      <MonthlyBarChart series={shown} />
      <div className="grid gap-4 lg:grid-cols-2">
        <MonthlyRateChart series={shown} />
        <ReputationImpactChart series={shown} />
      </div>
      <AccountComparisonTable rows={compareAccounts(fullSeries)} />
    </div>
  );
}
