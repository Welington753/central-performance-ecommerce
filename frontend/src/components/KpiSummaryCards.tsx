import { formatBRL, formatPercent } from "@/lib/kpi-format";

interface KpiSummaryCardsProps {
  summary: {
    grossSalesRevenue: string;
    grossSalesOrders: number;
    grossSalesUnits: number;
    grossSalesAverageTicket: string;
  };
  comparison: {
    grossSalesRevenuePct: number | null;
    grossSalesOrdersPct: number | null;
    grossSalesUnitsPct: number | null;
    grossSalesAverageTicketPct: number | null;
  };
}

interface CardSpec {
  key: string;
  label: string;
  value: string;
  comparisonPct: number | null;
}

/**
 * Indicadores equivalentes ao marketplace ("vendas brutas"): pedidos pagos +
 * cancelados com valor válido — nunca só pedidos pagos (isso vive em
 * `OperationalKpiCards`, separado e nunca chamado de "líquido").
 */
export function KpiSummaryCards({ summary, comparison }: KpiSummaryCardsProps) {
  const cards: CardSpec[] = [
    {
      key: "gross-revenue",
      label: "Vendas brutas",
      value: formatBRL(summary.grossSalesRevenue),
      comparisonPct: comparison.grossSalesRevenuePct,
    },
    {
      key: "orders",
      label: "Vendas",
      value: String(summary.grossSalesOrders),
      comparisonPct: comparison.grossSalesOrdersPct,
    },
    {
      key: "units",
      label: "Unidades vendidas",
      value: String(summary.grossSalesUnits),
      comparisonPct: comparison.grossSalesUnitsPct,
    },
    {
      key: "average-ticket",
      label: "Ticket médio",
      value: formatBRL(summary.grossSalesAverageTicket),
      comparisonPct: comparison.grossSalesAverageTicketPct,
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
