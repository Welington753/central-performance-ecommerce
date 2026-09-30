import {
  RESPONSIBILITY_LABELS,
  accountDisplayName,
  actionLabel,
  dueLabel,
  formatDate,
  impactLabel,
  marketplaceLabel,
  stageLabel,
  statusLabel,
} from "@/lib/problems-format";
import type {
  ProblemListItemDto,
  ProblemSortField,
  ProblemsPageDto,
  SortDirection,
} from "@/types/problems";

interface ProblemsTableProps {
  data: ProblemsPageDto;
  sortBy: ProblemSortField;
  sortDir: SortDirection;
  onSort: (field: ProblemSortField) => void;
  onPageChange: (page: number) => void;
  onOpen: (problem: ProblemListItemDto) => void;
}

function SortHeader({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  field: ProblemSortField;
  sortBy: ProblemSortField;
  sortDir: SortDirection;
  onSort: (field: ProblemSortField) => void;
}) {
  const active = sortBy === field;
  return (
    <th
      scope="col"
      className="px-3 py-2 text-left font-medium"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1">
        {label}
        <span aria-hidden="true">{active ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

export function ProblemsTable({ data, sortBy, sortDir, onSort, onPageChange, onOpen }: ProblemsTableProps) {
  if (data.items.length === 0) {
    return (
      <div role="status" className="rounded-xl border border-border-subtle bg-surface px-4 py-8 text-center text-sm text-foreground/60">
        Nenhum problema encontrado para os filtros selecionados.
      </div>
    );
  }
  const now = new Date();
  return (
    <section aria-label="Lista de problemas" className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/60">
            <tr>
              <SortHeader label="Data" field="dateCreated" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th scope="col" className="px-3 py-2 text-left font-medium">Marketplace / conta</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Pedido</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Status / etapa</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Motivo</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Reputação</th>
              <SortHeader label="Próxima ação / prazo" field="nextActionDueDate" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th scope="col" className="px-3 py-2 text-left font-medium">Responsabilidade</th>
              <th scope="col" className="px-3 py-2 text-left font-medium"><span className="sr-only">Detalhes</span></th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((problem) => {
              const due = problem.nextActionCode ? dueLabel(problem.nextActionDueDate, now) : null;
              return (
                <tr key={problem.id} className="border-b border-border-subtle last:border-0 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(problem.dateCreated)}</td>
                  <td className="px-3 py-2">
                    <div>{marketplaceLabel(problem.marketplace)}</div>
                    <div className="text-xs text-foreground/60">
                      {accountDisplayName(problem.accountNickname, problem.marketplace)}
                    </div>
                  </td>
                  <td className="px-3 py-2">{problem.orderExternalId ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div>{statusLabel(problem.status)}</div>
                    <div className="text-xs text-foreground/60">{stageLabel(problem.stage)}</div>
                  </td>
                  <td className="px-3 py-2">{problem.reasonName ?? "Motivo não informado"}</td>
                  <td className="px-3 py-2">{impactLabel(problem.reputationImpact)}</td>
                  <td className="px-3 py-2">
                    {due && problem.nextActionCode ? (
                      <>
                        <div>{actionLabel(problem.nextActionCode)}</div>
                        <div className={`text-xs ${due.overdue ? "font-medium text-red-700" : "text-foreground/60"}`}>
                          {due.text}
                        </div>
                      </>
                    ) : (
                      <span className="text-foreground/60">Sem ação pendente</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{RESPONSIBILITY_LABELS[problem.responsibility]}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpen(problem)}
                      className="rounded-md border border-border-subtle px-2 py-1 text-xs"
                      aria-label={`Ver detalhes do problema de ${formatDate(problem.dateCreated)}`}
                    >
                      Ver detalhes
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav aria-label="Paginação" className="flex items-center justify-between text-sm">
        <span className="text-foreground/60">
          {data.total.toLocaleString("pt-BR")} problemas · página {data.page} de {data.totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={data.page <= 1}
            onClick={() => onPageChange(data.page - 1)}
            className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={data.page >= data.totalPages}
            onClick={() => onPageChange(data.page + 1)}
            className="rounded-md border border-border-subtle px-3 py-1.5 disabled:opacity-50"
          >
            Próxima
          </button>
        </div>
      </nav>
    </section>
  );
}
