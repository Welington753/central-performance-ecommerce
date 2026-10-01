import { ImpactChip, ResponsibilityChip, StatusChip } from "@/components/problems/CaseChips";
import { EmptyState } from "@/components/problems/ProblemsStates";
import { accountDisplayName, formatDate } from "@/lib/problems-format";
import { formatInteger } from "@/lib/problems-monthly-format";
import type {
  ProblemListItemDto,
  ProblemSortField,
  ProblemsPageDto,
  SortDirection,
} from "@/types/problems";

interface CasesTableProps {
  data: ProblemsPageDto;
  /** Telas estreitas: cada linha vira um card (sem tabela nem rolagem horizontal). */
  narrow: boolean;
  sortBy: ProblemSortField;
  sortDir: SortDirection;
  onSort: (field: ProblemSortField) => void;
  onPageChange: (page: number) => void;
  onOpen: (problem: ProblemListItemDto) => void;
}

function DetailsButton({ problem, onOpen }: { problem: ProblemListItemDto; onOpen: (p: ProblemListItemDto) => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(problem);
      }}
      className="rounded-md border border-border-subtle px-2 py-1 text-xs"
      aria-label={`Ver detalhes do problema de ${formatDate(problem.dateCreated)}`}
    >
      Ver detalhes
    </button>
  );
}

function Pagination({ data, onPageChange }: Pick<CasesTableProps, "data" | "onPageChange">) {
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-foreground/70">
        {formatInteger(data.total)} problemas · página {data.page} de {data.totalPages}
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
  );
}

const th = "px-2 py-2 text-left font-medium";

export function CasesTable({ data, narrow, sortBy, sortDir, onSort, onPageChange, onOpen }: CasesTableProps) {
  if (data.items.length === 0) {
    return <EmptyState>Nenhum problema encontrado para os filtros selecionados.</EmptyState>;
  }
  const dateSort = sortBy === "dateCreated" ? (sortDir === "asc" ? "ascending" : "descending") : "none";
  return (
    <section aria-label="Lista de problemas" className="flex flex-col gap-3">
      {narrow ? (
        <ul className="flex flex-col gap-2">
          {data.items.map((problem) => (
            <li
              key={problem.id}
              onClick={() => onOpen(problem)}
              className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{formatDate(problem.dateCreated)}</span>
                <StatusChip status={problem.status} />
              </div>
              <span>{problem.reasonLabel ?? "Motivo não informado"}</span>
              <span className="text-xs text-foreground/70">
                {accountDisplayName(problem.accountNickname, problem.marketplace)} · Pedido {problem.orderExternalId ?? "—"}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <ImpactChip impact={problem.reputationImpact} />
                <ResponsibilityChip responsibility={problem.responsibility} />
              </div>
              <div>
                <DetailsButton problem={problem} onOpen={onOpen} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-border-subtle bg-surface">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-surface text-xs uppercase tracking-wide text-foreground/70 shadow-[0_1px_0_var(--border-subtle)]">
              <tr>
                <th scope="col" className={`${th} w-[8%]`} aria-sort={dateSort}>
                  <button type="button" onClick={() => onSort("dateCreated")} className="inline-flex items-center gap-1">
                    Data
                    <span aria-hidden="true">{dateSort === "none" ? "" : dateSort === "ascending" ? "▲" : "▼"}</span>
                  </button>
                </th>
                <th scope="col" className={`${th} w-[12%]`}>Conta</th>
                <th scope="col" className={`${th} w-[11%]`}>Pedido</th>
                <th scope="col" className={`${th} w-[22%]`}>Motivo</th>
                <th scope="col" className={`${th} w-[11%]`}>Status</th>
                <th scope="col" className={`${th} w-[13%]`}>Impacto</th>
                <th scope="col" className={`${th} w-[13%]`}>Responsabilidade</th>
                <th scope="col" className={`${th} w-[10%]`}><span className="sr-only">Detalhes</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((problem) => (
                <tr
                  key={problem.id}
                  onClick={() => onOpen(problem)}
                  className="cursor-pointer border-t border-border-subtle align-top hover:bg-foreground/5"
                >
                  <td className="px-2 py-2">{formatDate(problem.dateCreated)}</td>
                  <td className="break-words px-2 py-2">{accountDisplayName(problem.accountNickname, problem.marketplace)}</td>
                  <td className="break-all px-2 py-2">{problem.orderExternalId ?? "—"}</td>
                  <td className="break-words px-2 py-2">{problem.reasonLabel ?? "Motivo não informado"}</td>
                  <td className="px-2 py-2"><StatusChip status={problem.status} /></td>
                  <td className="px-2 py-2"><ImpactChip impact={problem.reputationImpact} /></td>
                  <td className="px-2 py-2"><ResponsibilityChip responsibility={problem.responsibility} /></td>
                  <td className="px-2 py-2"><DetailsButton problem={problem} onOpen={onOpen} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination data={data} onPageChange={onPageChange} />
    </section>
  );
}
