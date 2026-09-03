import {
  formatBRL,
  formatCalendarDate,
  formatDecimal,
  formatPercent,
} from "@/lib/kpi-format";
import type {
  AnalyticsBestDay,
  AnalyticsComparison,
  AnalyticsSummary,
} from "@/types/marketplace-analytics";

interface AdditionalKpiCardsProps {
  summary: AnalyticsSummary;
  comparison: AnalyticsComparison;
  bestDay: AnalyticsBestDay | null;
}

function ComparisonLine({ pct }: { pct: number | null }) {
  const formatted = formatPercent(pct);
  const isPositive = (pct ?? 0) > 0;
  const isNegative = (pct ?? 0) < 0;
  return (
    <p
      className={`text-xs font-medium ${
        formatted === null
          ? "text-foreground/40"
          : isPositive
            ? "text-green-600"
            : isNegative
              ? "text-red-600"
              : "text-foreground/60"
      }`}
    >
      {formatted ?? "Sem base no período anterior"}
    </p>
  );
}

function Card({
  testId,
  label,
  value,
  children,
}: {
  testId: string;
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-testid={`kpi-card-${testId}`}
      className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-surface px-5 py-4"
    >
      <p className="text-sm text-foreground/60">{label}</p>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      {children}
    </div>
  );
}

export function AdditionalKpiCards({
  summary,
  comparison,
  bestDay,
}: AdditionalKpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card
        testId="distinct-products"
        label="Produtos distintos"
        value={String(summary.distinctProducts)}
      >
        <ComparisonLine pct={comparison.distinctProductsPct} />
      </Card>

      <Card
        testId="units-per-order"
        label="Unidades por pedido"
        value={formatDecimal(summary.unitsPerOrder)}
      >
        <ComparisonLine pct={comparison.unitsPerOrderPct} />
      </Card>

      <Card
        testId="avg-unit-price"
        label="Preço médio por unidade bruta"
        value={formatBRL(summary.grossSalesAvgUnitPrice)}
      >
        <p className="text-xs text-foreground/40">
          Valor bruto, não representa o valor líquido.
        </p>
      </Card>

      <Card
        testId="best-day"
        label="Melhor dia do período"
        value={bestDay ? formatBRL(bestDay.grossRevenue) : "—"}
      >
        {bestDay ? (
          <p className="text-xs text-foreground/60">
            {formatCalendarDate(bestDay.date)} · {bestDay.paidOrders} pedido
            {bestDay.paidOrders === 1 ? "" : "s"} · {bestDay.units} unidade
            {bestDay.units === 1 ? "" : "s"}
          </p>
        ) : (
          <p className="text-xs text-foreground/40">
            Nenhuma venda no período.
          </p>
        )}
      </Card>
    </div>
  );
}
