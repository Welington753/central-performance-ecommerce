"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CasesTab } from "@/components/problems/CasesTab";
import { EMPTY_CASE_FILTERS, type CaseFilters } from "@/components/problems/CasesFilters";
import { CoverageTab } from "@/components/problems/CoverageTab";
import { MonthlyTab } from "@/components/problems/MonthlyTab";
import { ProblemsHeader } from "@/components/problems/ProblemsHeader";
import { ProblemsPartialNotice } from "@/components/problems/ProblemsPartialNotice";
import { Notice, TabSkeleton } from "@/components/problems/ProblemsStates";
import { ProblemsTabs, panelId, tabId, type ProblemsTabId } from "@/components/problems/ProblemsTabs";
import { ReasonsTab } from "@/components/problems/ReasonsTab";
import { hasPermission, useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchMarketplaceAccounts } from "@/lib/api";
import { useAsyncQuery } from "@/lib/use-async-query";
import {
  ProblemsForbiddenError,
  fetchProblemsMonthly,
  fetchProblemsReasons,
} from "@/lib/problems-api";
import { DEFAULT_PERIOD, customPeriodError, periodRange, type ProblemsPeriod } from "@/lib/problems-period";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import {
  EMPTY_PROBLEMS_FILTERS,
  type ProblemSortField,
  type ProblemsFilters,
  type ProblemsMonthlyItemDto,
  type SortDirection,
} from "@/types/problems";

const header = (
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Problemas</h1>
    <p className="mt-1 text-sm text-foreground/70">
      Reclamações e problemas dos pedidos, mês a mês e sempre separados por conta.
    </p>
  </div>
);

function ProblemsContent({ canManage, canSync }: { canManage: boolean; canSync: boolean }) {
  const [now] = useState(() => new Date());
  const [tab, setTab] = useState<ProblemsTabId>("monthly");
  const [period, setPeriod] = useState<ProblemsPeriod>(DEFAULT_PERIOD);
  const [marketplace, setMarketplace] = useState<ProblemsFilters["marketplace"]>("ALL");
  const [accountId, setAccountId] = useState("");
  const [caseFilters, setCaseFilters] = useState<CaseFilters>(EMPTY_CASE_FILTERS);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<ProblemSortField>("dateCreated");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [accounts, setAccounts] = useState<MarketplaceAccountDto[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const periodError = customPeriodError(period);
  const { dateFrom, dateTo } = useMemo(() => periodRange(period, now), [period, now]);
  const queryKey = `${marketplace}|${accountId}|${dateFrom}|${dateTo}|${reloadKey}`;

  /** Filtros globais (sem os próprios dos casos) — base dos motivos e da cobertura. */
  const globalFilters = useMemo<ProblemsFilters>(
    () => ({ ...EMPTY_PROBLEMS_FILTERS, from: dateFrom, to: dateTo, marketplace, accountId }),
    [dateFrom, dateTo, marketplace, accountId],
  );
  const caseListFilters = useMemo<ProblemsFilters>(
    () => ({ ...globalFilters, ...caseFilters }),
    [globalFilters, caseFilters],
  );

  useEffect(() => {
    fetchMarketplaceAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  const monthlyQuery = useAsyncQuery(periodError ? null : `m|${queryKey}`, (signal) =>
    fetchProblemsMonthly({ marketplace, accountId, dateFrom, dateTo }, signal),
  );
  const reasonsQuery = useAsyncQuery(periodError ? null : `r|${queryKey}`, (signal) =>
    fetchProblemsReasons(globalFilters, signal),
  );
  const monthly = monthlyQuery.data?.items ?? null;
  const reasons = reasonsQuery.data ?? [];
  const forbiddenFailure =
    monthlyQuery.failure instanceof ProblemsForbiddenError || reasonsQuery.failure instanceof ProblemsForbiddenError;
  const failureMessage = (failure: unknown, fallback: string): string | null =>
    failure === null ? null : failure instanceof Error ? failure.message : fallback;
  const monthlyError = failureMessage(monthlyQuery.failure, "Falha ao carregar a análise mensal.");
  const reasonsError = failureMessage(reasonsQuery.failure, "Falha ao carregar os motivos.");

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setPage(1);
      setter(value);
    };
  }

  function selectReason(reasonId: string) {
    setPage(1);
    setCaseFilters({ ...EMPTY_CASE_FILTERS, reasonId });
    setTab("cases");
  }

  function handleSort(field: ProblemSortField) {
    setPage(1);
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "nextActionDueDate" ? "asc" : "desc");
  }

  if (forbiddenFailure) {
    return <Notice tone="error">Você não tem permissão para ver os problemas.</Notice>;
  }

  const monthlyView = (render: (items: ProblemsMonthlyItemDto[]) => React.ReactNode) =>
    monthlyError ? (
      <Notice tone="error" onRetry={reload}>
        {monthlyError}
      </Notice>
    ) : monthly ? (
      render(monthly)
    ) : (
      <TabSkeleton label="Carregando análise mensal" />
    );

  return (
    <>
      <ProblemsHeader
        period={period}
        marketplace={marketplace}
        accountId={accountId}
        accounts={accounts}
        onPeriodChange={resetPage(setPeriod)}
        onMarketplaceChange={resetPage(setMarketplace)}
        onAccountChange={resetPage(setAccountId)}
      />
      {monthly && !monthlyError ? <ProblemsPartialNotice items={monthly} /> : null}
      <ProblemsTabs active={tab} onChange={setTab} />
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="flex flex-col gap-4">
        {tab === "monthly" ? monthlyView((items) => <MonthlyTab items={items} />) : null}
        {tab === "reasons"
          ? (
              <ReasonsTab
                reasons={reasonsQuery.data}
                error={reasonsError}
                partial={monthly?.some((item) => item.coverage !== "COMPLETE") ?? false}
                onRetry={reload}
                onSelectReason={selectReason}
              />
            )
          : null}
        {tab === "cases" ? (
          <CasesTab
            filters={caseListFilters}
            reasons={reasons}
            page={page}
            sortBy={sortBy}
            sortDir={sortDir}
            canManage={canManage}
            onApplyFilters={(next) => {
              setPage(1);
              setCaseFilters(next);
            }}
            onSort={handleSort}
            onToggleDirection={() => {
              setPage(1);
              setSortDir((current) => (current === "asc" ? "desc" : "asc"));
            }}
            onPageChange={setPage}
          />
        ) : null}
        {tab === "coverage" ? <CoverageTab filters={globalFilters} canSync={canSync} /> : null}
      </div>
    </>
  );
}

export default function ProblemasPage() {
  const { user, isLoading } = useCurrentUser();

  return (
    <div className="flex flex-col gap-4">
      {header}
      {isLoading ? (
        <Notice tone="info">Carregando...</Notice>
      ) : hasPermission(user, "problems.view") ? (
        <ProblemsContent
          canManage={hasPermission(user, "problems.manage")}
          canSync={hasPermission(user, "problems.sync")}
        />
      ) : (
        <Notice tone="error">Você não tem permissão para ver os problemas.</Notice>
      )}
    </div>
  );
}
