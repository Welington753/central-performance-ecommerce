import { EmptyRanking, SortableHeader } from "@/components/ProductRankingTableParts";
import { formatBRL, formatDecimal } from "@/lib/kpi-format";
import type { SortState, WithPosition } from "@/lib/ranking-sort";
import type { AnalyticsTopListing } from "@/types/marketplace-analytics";

export type ListingSortColumn =
  | "position"
  | "listingId"
  | "sku"
  | "title"
  | "units"
  | "grossRevenue"
  | "grossRevenueSharePct";

export function listingColumnValue(
  row: AnalyticsTopListing & WithPosition,
  column: ListingSortColumn,
): string | number {
  switch (column) {
    case "position":
      return row.position;
    case "listingId":
      return row.listingId;
    case "sku":
      return row.sku ?? "Sem SKU";
    case "title":
      return row.title;
    case "units":
      return row.units;
    case "grossRevenue":
      return Number(row.grossRevenue);
    case "grossRevenueSharePct":
      return row.grossRevenueSharePct;
  }
}

export function ProductListingRankingTable({
  rows,
  sort,
  onSort,
}: {
  rows: (AnalyticsTopListing & WithPosition)[];
  sort: SortState<ListingSortColumn>;
  onSort: (column: ListingSortColumn) => void;
}) {
  if (rows.length === 0) return <EmptyRanking />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[740px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            <SortableHeader column="position" label="#" sort={sort} onSort={onSort} />
            <SortableHeader
              column="listingId"
              label="Anúncio"
              sort={sort}
              onSort={onSort}
            />
            <SortableHeader column="sku" label="SKU" sort={sort} onSort={onSort} />
            <SortableHeader column="title" label="Produto" sort={sort} onSort={onSort} />
            <SortableHeader column="units" label="Unidades" sort={sort} onSort={onSort} />
            <SortableHeader
              column="grossRevenue"
              label="Valor bruto"
              sort={sort}
              onSort={onSort}
            />
            <SortableHeader
              column="grossRevenueSharePct"
              label="% do valor bruto"
              sort={sort}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.listingId}
              className="border-b border-border-subtle last:border-0"
            >
              <td className="px-4 py-3">{row.position}</td>
              <td className="px-4 py-3">{row.listingId}</td>
              <td className="px-4 py-3">{row.sku ?? "Sem SKU"}</td>
              <td className="px-4 py-3">{row.title}</td>
              <td className="px-4 py-3">{row.units}</td>
              <td className="px-4 py-3">{formatBRL(row.grossRevenue)}</td>
              <td className="px-4 py-3">
                {formatDecimal(row.grossRevenueSharePct)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
