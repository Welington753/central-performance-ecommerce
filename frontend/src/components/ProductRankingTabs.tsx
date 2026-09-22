"use client";

import { useMemo, useState } from "react";
import {
  ProductListingRankingTable,
  listingColumnValue,
  type ListingSortColumn,
} from "@/components/ProductListingRankingTable";
import {
  ProductSkuRankingTable,
  skuColumnValue,
  type SkuSortColumn,
} from "@/components/ProductSkuRankingTable";
import {
  sortRows,
  toggleSort,
  withPositions,
  type SortState,
} from "@/lib/ranking-sort";
import type { AnalyticsTopListing, AnalyticsTopProductBySku } from "@/types/marketplace-analytics";

interface ProductRankingTabsProps {
  bySku: AnalyticsTopProductBySku[];
  byListing: AnalyticsTopListing[];
}

type RankingTab = "sku" | "listing";
type TopN = 10 | 20 | 50;

const TOP_N_OPTIONS: TopN[] = [10, 20, 50];

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

export function ProductRankingTabs({
  bySku,
  byListing,
}: ProductRankingTabsProps) {
  const [tab, setTab] = useState<RankingTab>("sku");
  const [search, setSearch] = useState("");
  const [topN, setTopN] = useState<TopN>(10);
  const [skuSort, setSkuSort] = useState<SortState<SkuSortColumn>>({
    column: "position",
    direction: "asc",
  });
  const [listingSort, setListingSort] = useState<SortState<ListingSortColumn>>({
    column: "position",
    direction: "asc",
  });

  const normalizedSearch = normalizeSearch(search);

  const skuWithPositions = useMemo(() => withPositions(bySku), [bySku]);
  const listingWithPositions = useMemo(
    () => withPositions(byListing),
    [byListing],
  );

  // Sequência obrigatória: busca/filtro -> ordenação -> Top N. Nunca recorta
  // o Top N antes de ordenar (perderia linhas que só entrariam no Top N
  // depois de reordenadas).
  const visibleBySku = useMemo(() => {
    const filtered = normalizedSearch
      ? skuWithPositions.filter(
          (row) =>
            (row.sku ?? "").toLowerCase().includes(normalizedSearch) ||
            row.title.toLowerCase().includes(normalizedSearch),
        )
      : skuWithPositions;
    const sorted = sortRows(
      filtered,
      skuSort.column,
      skuSort.direction,
      skuColumnValue,
      (row) => row.sku ?? row.title,
    );
    return sorted.slice(0, topN);
  }, [skuWithPositions, normalizedSearch, skuSort, topN]);

  const visibleByListing = useMemo(() => {
    const filtered = normalizedSearch
      ? listingWithPositions.filter(
          (row) =>
            (row.sku ?? "").toLowerCase().includes(normalizedSearch) ||
            row.title.toLowerCase().includes(normalizedSearch) ||
            row.listingId.toLowerCase().includes(normalizedSearch),
        )
      : listingWithPositions;
    const sorted = sortRows(
      filtered,
      listingSort.column,
      listingSort.direction,
      listingColumnValue,
      (row) => row.listingId,
    );
    return sorted.slice(0, topN);
  }, [listingWithPositions, normalizedSearch, listingSort, topN]);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Ranking de produtos"
        className="flex gap-2 border-b border-border-subtle"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "sku"}
          onClick={() => setTab("sku")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "sku"
              ? "border-b-2 border-brand text-brand"
              : "text-foreground/60 hover:text-foreground"
          }`}
        >
          Por SKU
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "listing"}
          onClick={() => setTab("listing")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "listing"
              ? "border-b-2 border-brand text-brand"
              : "text-foreground/60 hover:text-foreground"
          }`}
        >
          Por anúncio
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm sm:min-w-[220px]">
          <span className="sr-only">Buscar por SKU ou nome do produto</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por SKU ou nome do produto"
            className="rounded-md border border-border-subtle bg-surface px-3 py-1.5"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground/60">
          Mostrar
          <select
            aria-label="Quantidade de itens no ranking"
            value={topN}
            onChange={(event) => setTopN(Number(event.target.value) as TopN)}
            className="rounded-md border border-border-subtle bg-surface px-2 py-1.5"
          >
            {TOP_N_OPTIONS.map((option) => (
              <option key={option} value={option}>
                Top {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tab === "sku" ? (
        <ProductSkuRankingTable
          rows={visibleBySku}
          sort={skuSort}
          onSort={(column) => setSkuSort((current) => toggleSort(current, column))}
        />
      ) : (
        <ProductListingRankingTable
          rows={visibleByListing}
          sort={listingSort}
          onSort={(column) =>
            setListingSort((current) => toggleSort(current, column))
          }
        />
      )}
    </div>
  );
}
