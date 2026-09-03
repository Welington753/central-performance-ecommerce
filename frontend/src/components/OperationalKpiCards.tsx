import { formatBRL, formatPercent } from "@/lib/kpi-format";

interface OperationalKpiCardsProps {
  summary: {
    grossRevenue: string;
    orders: number;
    units: number;
  };
  comparison: {
    grossRevenuePct: number | null;
    ordersPct: number | null;
    unitsPct: number | null;
  };
}

interface CardSpec {
  key: string;
  label: string;
  value: string;
  comparisonPct: number | null;
}

/**
 * Indicadores operacionais (pedidos pagos), separados das "vendas brutas"
 * (`KpiSummaryCards`, equivalente ao marketplace). Nunca rotulado como
 * "líquido" — ainda não desconta tarifas, frete, impostos ou Ads.
 */
export function OperationalKpiCards({
  summary,
  comparison,
}: OperationalKpiCardsProps) {
  const cards: CardSpec[] = [
    {
      key: "paid-revenue",
      label: "Faturamento de pedidos pagos",
      value: formatBRL(summary.grossRevenue),
      comparisonPct: comparison.grossRevenuePct,
    },
    {
      key: "paid-orders",
      label: "Pedidos pagos",
      value: String(summary.orders),
      comparisonPct: comparison.ordersPct,
    },
    {
      key: "paid-units",
      label: "Unidades de pedidos pagos",
      value: String(summary.units),
      comparisonPct: comparison.unitsPct,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-foreground/50">
        Operacional — antes de tarifas, frete, impostos e Ads.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((card) => {
          const formattedPct = formatPercent(card.comparisonPct);
          const isPositive = (card.comparisonPct ?? 0) > 0;
          const isNegative = (card.comparisonPct ?? 0) < 0;
          return (
            <div
              key={card.key}
              data-testid={`kpi-card-${card.key}`}
              className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-surface px-5 py-4"
            >
              <p className="text-sm text-foreground/60">{card.label}</p>
              <p className="text-xl font-semibold tracking-tight">
                {card.value}
              </p>
              <p
                className={`text-xs font-medium ${
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
    </div>
  );
}
