"use client";

import { useCallback, useEffect, useState } from "react";
import { CasesFilters, type CaseFilters } from "@/components/problems/CasesFilters";
import { CasesTable } from "@/components/problems/CasesTable";
import { ProblemDetailPanel } from "@/components/problems/ProblemDetailPanel";
import { Notice, Skeleton } from "@/components/problems/ProblemsStates";
import { fetchProblems } from "@/lib/problems-api";
import { useNarrowViewport } from "@/lib/use-narrow-viewport";
import type {
  ProblemReasonOptionDto,
  ProblemSortField,
  ProblemsFilters,
  ProblemsPageDto,
  SortDirection,
} from "@/types/problems";

export const CASES_PAGE_SIZE = 25;

interface CasesTabProps {
  /** Filtros completos já combinados (período + topo + próprios da aba). */
  filters: ProblemsFilters;
  reasons: ProblemReasonOptionDto[];
  page: number;
  sortBy: ProblemSortField;
  sortDir: SortDirection;
  canManage: boolean;
  onApplyFilters: (filters: CaseFilters) => void;
  onSort: (field: ProblemSortField) => void;
  onToggleDirection: () => void;
  onPageChange: (page: number) => void;
}

/** Casos: a página (paginação/ordem/filtros) vive no pai, então abrir/fechar detalhes nunca a perde. */
export function CasesTab({
  filters,
  reasons,
  page,
  sortBy,
  sortDir,
  canManage,
  onApplyFilters,
  onSort,
  onToggleDirection,
  onPageChange,
}: CasesTabProps) {
  const narrow = useNarrowViewport();
  const [data, setData] = useState<ProblemsPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => {
    setError(null);
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let active = true;
    fetchProblems(filters, { page, pageSize: CASES_PAGE_SIZE, sortBy, sortDir })
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Falha ao carregar os problemas.");
      });
    return () => {
      active = false;
    };
  }, [filters, page, sortBy, sortDir, reloadKey]);

  return (
    <div className="flex flex-col gap-3">
      <CasesFilters
        value={filters}
        reasons={reasons}
        sortBy={sortBy}
        sortDir={sortDir}
        onApply={onApplyFilters}
        onSort={onSort}
        onToggleDirection={onToggleDirection}
      />
      {error ? (
        <Notice tone="error" onRetry={reload}>
          {error}
        </Notice>
      ) : null}
      {!data && !error ? (
        <div role="status" aria-label="Carregando casos" className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : null}
      {data ? (
        <CasesTable
          data={data}
          narrow={narrow}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
          onPageChange={onPageChange}
          onOpen={(problem) => setSelectedId(problem.id)}
        />
      ) : null}
      {selectedId ? (
        <ProblemDetailPanel
          key={selectedId}
          problemId={selectedId}
          canManage={canManage}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
