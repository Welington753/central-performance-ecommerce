"use client";

import { useCallback, useEffect, useState } from "react";
import { ProblemDetailPanel } from "@/components/problems/ProblemDetailPanel";
import { ProblemsCoverageBanner } from "@/components/problems/ProblemsCoverageBanner";
import { ProblemsFiltersBar } from "@/components/problems/ProblemsFiltersBar";
import { ProblemsSummaryCards } from "@/components/problems/ProblemsSummaryCards";
import { ProblemsSyncPanel } from "@/components/problems/ProblemsSyncPanel";
import { ProblemsTable } from "@/components/problems/ProblemsTable";
import { hasPermission, useCurrentUser } from "@/hooks/useCurrentUser";
import { fetchMarketplaceAccounts } from "@/lib/api";
import {
  ProblemsForbiddenError,
  fetchProblems,
  fetchProblemsReasons,
  fetchProblemsSummary,
} from "@/lib/problems-api";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import {
  EMPTY_PROBLEMS_FILTERS,
  type ProblemReasonOptionDto,
  type ProblemSortField,
  type ProblemsFilters,
  type ProblemsPageDto,
  type ProblemsSummaryDto,
  type SortDirection,
} from "@/types/problems";

const PAGE_SIZE = 25;

const header = (
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Problemas</h1>
    <p className="mt-1 text-sm text-foreground/60">
      Reclamações e problemas dos pedidos, sempre separados por conta.
    </p>
  </div>
);

function Notice({
  tone,
  children,
  onRetry,
}: {
  tone: "error" | "info";
  children: React.ReactNode;
  onRetry?: () => void;
}) {
  const classes =
    tone === "error"
      ? "border-red-500/40 bg-red-500/10 text-red-700"
      : "border-border-subtle bg-surface text-foreground/60";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${classes}`}
    >
      <span>{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="rounded-md border border-current px-3 py-1">
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

function ProblemsContent({ canManage, canSync }: { canManage: boolean; canSync: boolean }) {
  const [filters, setFilters] = useState<ProblemsFilters>(EMPTY_PROBLEMS_FILTERS);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<ProblemSortField>("dateCreated");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [reloadKey, setReloadKey] = useState(0);
  const [accounts, setAccounts] = useState<MarketplaceAccountDto[]>([]);
  const [summary, setSummary] = useState<ProblemsSummaryDto | null>(null);
  const [reasons, setReasons] = useState<ProblemReasonOptionDto[]>([]);
  const [data, setData] = useState<ProblemsPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    fetchMarketplaceAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchProblemsSummary(filters),
      fetchProblems(filters, { page, pageSize: PAGE_SIZE, sortBy, sortDir }),
    ])
      .then(([nextSummary, nextData]) => {
        if (!active) return;
        setSummary(nextSummary);
        setData(nextData);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ProblemsForbiddenError) setForbidden(true);
        setError(caught instanceof Error ? caught.message : "Falha ao carregar os problemas.");
      });
    return () => {
      active = false;
    };
  }, [filters, page, sortBy, sortDir, reloadKey]);

  // Opções de motivo do recorte atual, SEM o próprio filtro de motivo (senão o seletor esvaziaria).
  useEffect(() => {
    let active = true;
    fetchProblemsReasons({ ...filters, reasonId: "" })
      .then((next) => active && setReasons(next))
      .catch(() => active && setReasons([]));
    return () => {
      active = false;
    };
  }, [filters, reloadKey]);

  function handleSort(field: ProblemSortField) {
    setPage(1);
    if (field === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "nextActionDueDate" ? "asc" : "desc");
  }

  if (forbidden) {
    return <Notice tone="error">Você não tem permissão para ver os problemas.</Notice>;
  }

  return (
    <>
      <ProblemsCoverageBanner />
      <ProblemsFiltersBar
        value={filters}
        accounts={accounts}
        reasons={reasons}
        onApply={(next) => {
          setPage(1);
          setFilters(next);
        }}
      />
      {error ? (
        <Notice tone="error" onRetry={reload}>
          {error}
        </Notice>
      ) : null}
      {!data && !error ? <Notice tone="info">Carregando problemas...</Notice> : null}
      {summary ? <ProblemsSummaryCards summary={summary} /> : null}
      {data ? (
        <ProblemsTable
          data={data}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          onPageChange={setPage}
          onOpen={(problem) => setSelectedId(problem.id)}
        />
      ) : null}
      {canSync ? <ProblemsSyncPanel onChanged={reload} /> : null}
      {selectedId ? (
        <ProblemDetailPanel
          key={selectedId}
          problemId={selectedId}
          canManage={canManage}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      ) : null}
    </>
  );
}

export default function ProblemasPage() {
  const { user, isLoading } = useCurrentUser();

  return (
    <div className="flex flex-col gap-6">
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
