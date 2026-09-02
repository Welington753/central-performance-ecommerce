import { formatBRL, formatPercent } from "@/lib/kpi-format";
import type { MercadoLivreKpisDto } from "@/types/mercado-livre-kpis";

interface KpiSummaryCardsProps {
  summary: MercadoLivreKpisDto["summary"];
  comparison: MercadoLivreKpisDto["comparison"];
}

interface CardSpec {
  key: string;
  label: string;
  value: string;
  comparisonPct: number | null;
}

export function KpiSummaryCards({ summary, comparison }: KpiSummaryCardsProps) {
  const cards: CardSpec[] = [
    {
      key: "gross-revenue",
      label: "Faturamento bruto",
      value: formatBRL(summary.grossRevenue),
      comparisonPct: comparison.grossRevenuePct,
    },
    {
      key: "orders",
      label: "Pedidos pagos",
      value: String(summary.orders),
      comparisonPct: comparison.ordersPct,
    },
    {
      key: "units",
      label: "Unidades vendidas",
      value: String(summary.units),
      comparisonPct: comparison.unitsPct,
    },
    {
      key: "average-ticket",
      label: "Ticket médio",
      value: formatBRL(summary.averageTicket),
      comparisonPct: comparison.averageTicketPct,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const formattedPct = formatPercent(card.comparisonPct);
        const isPositive = (card.comparisonPct ?? 0) > 0;
        const isNegative = (card.comparisonPct ?? 0) < 0;
        return (
          <div
            key={card.key}
            data-testid={`kpi-card-${card.key}`}
            className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-5 py-4"
          >
            <p className="text-sm text-foreground/60">{card.label}</p>
            <p className="text-2xl font-semibold tracking-tight">
              {card.value}
            </p>
            <p
              className={`text-sm font-medium ${
                formattedPct === null
                  ? "text-foreground/40"
                  : isPositive
                    ? "text-green-600"
                    : isNegative
                      ? "text-red-600"
                      : "text-foreground/60"
              }`}
            >
              {formattedPct ?? "—"}
              <span className="ml-1 font-normal text-foreground/40">
                vs. período anterior
              </span>
            </p>
          </div>
        );
      })}
    </div>
  );
}
