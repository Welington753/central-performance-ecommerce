import { EmptyRanking, SortableHeader } from "@/components/ProductRankingTableParts";
import { formatBRL, formatDecimal } from "@/lib/kpi-format";
import type { SortState, WithPosition } from "@/lib/ranking-sort";
import type { AnalyticsTopProductBySku } from "@/types/marketplace-analytics";

export type SkuSortColumn =
  | "position"
  | "sku"
  | "title"
  | "distinctListings"
  | "units"
  | "grossRevenue"
  | "unitsSharePct"
  | "grossRevenueSharePct";

export function skuColumnValue(
  row: AnalyticsTopProductBySku & WithPosition,
  column: SkuSortColumn,
): string | number {
  switch (column) {
    case "position":
      return row.position;
    case "sku":
      return row.sku ?? "Sem SKU";
    case "title":
      return row.title;
    case "distinctListings":
      return row.distinctListings;
    case "units":
      return row.units;
    case "grossRevenue":
      return Number(row.grossRevenue);
    case "unitsSharePct":
      return row.unitsSharePct;
    case "grossRevenueSharePct":
      return row.grossRevenueSharePct;
  }
}

export function ProductSkuRankingTable({
  rows,
  sort,
  onSort,
}: {
  rows: (AnalyticsTopProductBySku & WithPosition)[];
  sort: SortState<SkuSortColumn>;
  onSort: (column: SkuSortColumn) => void;
}) {
  if (rows.length === 0) return <EmptyRanking />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            <SortableHeader column="position" label="#" sort={sort} onSort={onSort} />
            <SortableHeader column="sku" label="SKU" sort={sort} onSort={onSort} />
            <SortableHeader column="title" label="Produto" sort={sort} onSort={onSort} />
            <SortableHeader
              column="distinctListings"
              label="Anúncios"
              sort={sort}
              onSort={onSort}
            />
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
            <SortableHeader
              column="unitsSharePct"
              label="% das unidades"
              sort={sort}
              onSort={onSort}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.sku ?? `sem-sku-${row.title}-${row.position}`}
              className="border-b border-border-subtle last:border-0"
            >
              <td className="px-4 py-3">{row.position}</td>
              <td className="px-4 py-3">{row.sku ?? "Sem SKU"}</td>
              <td className="px-4 py-3">{row.title}</td>
              <td className="px-4 py-3">{row.distinctListings}</td>
              <td className="px-4 py-3">{row.units}</td>
              <td className="px-4 py-3">{formatBRL(row.grossRevenue)}</td>
              <td className="px-4 py-3">
                {formatDecimal(row.grossRevenueSharePct)}%
              </td>
              <td className="px-4 py-3">{formatDecimal(row.unitsSharePct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
