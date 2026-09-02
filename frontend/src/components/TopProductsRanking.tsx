import { EmptyStateIcon } from "@/components/EmptyState";
import { formatBRL } from "@/lib/kpi-format";
import type { MercadoLivreKpisDto } from "@/types/mercado-livre-kpis";

interface TopProductsRankingProps {
  products: MercadoLivreKpisDto["topProducts"];
}

const COLUMNS = ["#", "SKU", "Produto", "Unidades", "Valor bruto"] as const;

export function TopProductsRanking({ products }: TopProductsRankingProps) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-16 text-center">
        <EmptyStateIcon />
        <p className="text-sm text-foreground/60">
          Nenhum produto vendido no período.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            {COLUMNS.map((column) => (
              <th key={column} scope="col" className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product, index) => (
            <tr
              key={product.sku ?? `${product.title}-${index}`}
              className="border-b border-border-subtle last:border-0"
            >
              <td className="px-4 py-3">{index + 1}</td>
              <td className="px-4 py-3">{product.sku ?? "—"}</td>
              <td className="px-4 py-3">{product.title}</td>
              <td className="px-4 py-3">{product.units}</td>
              <td className="px-4 py-3">{formatBRL(product.grossRevenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
