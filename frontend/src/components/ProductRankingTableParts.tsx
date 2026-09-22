import { EmptyStateIcon } from "@/components/EmptyState";
import { ariaSortFor, type SortState } from "@/lib/ranking-sort";

export function EmptyRanking() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-16 text-center">
      <EmptyStateIcon />
      <p className="text-sm text-foreground/60">
        Nenhum produto vendido no período (ou nenhum resultado para esta
        busca).
      </p>
    </div>
  );
}

function SortIndicator({
  direction,
}: {
  direction: "ascending" | "descending" | "none";
}) {
  if (direction === "none") return null;
  return <span aria-hidden="true">{direction === "ascending" ? " ▲" : " ▼"}</span>;
}

export function SortableHeader<C extends string>({
  column,
  label,
  sort,
  onSort,
}: {
  column: C;
  label: string;
  sort: SortState<C>;
  onSort: (column: C) => void;
}) {
  const direction = ariaSortFor(sort, column);
  return (
    <th scope="col" className="px-4 py-3 font-medium" aria-sort={direction}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex items-center gap-0.5 hover:text-foreground"
      >
        {label}
        <SortIndicator direction={direction} />
      </button>
    </th>
  );
}
