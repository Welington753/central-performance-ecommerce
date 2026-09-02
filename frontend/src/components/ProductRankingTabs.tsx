"use client";

import { useMemo, useState } from "react";
import { EmptyStateIcon } from "@/components/EmptyState";
import { formatBRL, formatDecimal } from "@/lib/kpi-format";
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

  const normalizedSearch = normalizeSearch(search);

  const filteredBySku = useMemo(() => {
    const filtered = normalizedSearch
      ? bySku.filter(
          (row) =>
            (row.sku ?? "").toLowerCase().includes(normalizedSearch) ||
            row.title.toLowerCase().includes(normalizedSearch),
        )
      : bySku;
    return filtered.slice(0, topN);
  }, [bySku, normalizedSearch, topN]);

  const filteredByListing = useMemo(() => {
    const filtered = normalizedSearch
      ? byListing.filter(
          (row) =>
            (row.sku ?? "").toLowerCase().includes(normalizedSearch) ||
            row.title.toLowerCase().includes(normalizedSearch) ||
            row.listingId.toLowerCase().includes(normalizedSearch),
        )
      : byListing;
    return filtered.slice(0, topN);
  }, [byListing, normalizedSearch, topN]);

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
        <SkuTable rows={filteredBySku} />
      ) : (
        <ListingTable rows={filteredByListing} />
      )}
    </div>
  );
}

function EmptyRanking() {
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

function SkuTable({
  rows,
}: {
  rows: AnalyticsTopProductBySku[];
}) {
  if (rows.length === 0) return <EmptyRanking />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            <th scope="col" className="px-4 py-3 font-medium">
              #
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              SKU
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Produto
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Anúncios
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Unidades
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Valor bruto
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              % das unidades
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.sku ?? `sem-sku-${row.title}-${index}`}
              className="border-b border-border-subtle last:border-0"
            >
              <td className="px-4 py-3">{index + 1}</td>
              <td className="px-4 py-3">{row.sku ?? "Sem SKU"}</td>
              <td className="px-4 py-3">{row.title}</td>
              <td className="px-4 py-3">{row.distinctListings}</td>
              <td className="px-4 py-3">{row.units}</td>
              <td className="px-4 py-3">{formatBRL(row.grossRevenue)}</td>
              <td className="px-4 py-3">{formatDecimal(row.unitsSharePct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListingTable({
  rows,
}: {
  rows: AnalyticsTopListing[];
}) {
  if (rows.length === 0) return <EmptyRanking />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            <th scope="col" className="px-4 py-3 font-medium">
              #
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Anúncio
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              SKU
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Produto
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Unidades
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Valor bruto
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.listingId}
              className="border-b border-border-subtle last:border-0"
            >
              <td className="px-4 py-3">{index + 1}</td>
              <td className="px-4 py-3">{row.listingId}</td>
              <td className="px-4 py-3">{row.sku ?? "Sem SKU"}</td>
              <td className="px-4 py-3">{row.title}</td>
              <td className="px-4 py-3">{row.units}</td>
              <td className="px-4 py-3">{formatBRL(row.grossRevenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
