import {
  formatBRL,
  formatDecimal,
  formatPercent,
  formatPercentagePoints,
} from "@/lib/kpi-format";

interface CancellationsPanelProps {
  summary: {
    cancelledOrders: number;
    cancelledUnits: number;
    cancelledRevenue: string;
    cancellationRate: number;
  };
  comparison: {
    cancelledOrdersPct: number | null;
    cancelledUnitsPct: number | null;
    cancelledRevenuePct: number | null;
    cancellationRateDiffPp: number;
  };
}

const TOOLTIP_TEXT =
  "São pedidos criados no período selecionado que estão cancelados na última sincronização. Esta definição é própria da Central de Performance e pode não corresponder exatamente à regra usada pelo cartão de cancelamentos do marketplace.";

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

/**
 * Painel expansível de cancelamentos — nunca poluí os cards principais
 * (`KpiSummaryCards`/`OperationalKpiCards`). `<details>` nativo: acessível
 * via teclado/leitor de tela sem JS extra, testável pelo atributo `open`.
 */
export function CancellationsPanel({
  summary,
  comparison,
}: CancellationsPanelProps) {
  return (
    <details className="rounded-xl border border-border-subtle bg-surface">
      <summary
        title={TOOLTIP_TEXT}
        className="cursor-pointer select-none px-5 py-4 text-sm font-medium text-foreground/80"
      >
        Ver cancelamentos
      </summary>
      <div className="flex flex-col gap-4 border-t border-border-subtle px-5 py-4">
        <p className="text-xs text-foreground/50">{TOOLTIP_TEXT}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div
            data-testid="kpi-card-cancelled-orders"
            className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-background px-4 py-3"
          >
            <p className="text-sm text-foreground/60">Pedidos cancelados</p>
            <p className="text-xl font-semibold tracking-tight">
              {summary.cancelledOrders}
            </p>
            <ComparisonLine pct={comparison.cancelledOrdersPct} />
          </div>

          <div
            data-testid="kpi-card-cancelled-units"
            className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-background px-4 py-3"
          >
            <p className="text-sm text-foreground/60">Unidades canceladas</p>
            <p className="text-xl font-semibold tracking-tight">
              {summary.cancelledUnits}
            </p>
            <ComparisonLine pct={comparison.cancelledUnitsPct} />
          </div>

          <div
            data-testid="kpi-card-cancelled-revenue"
            className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-background px-4 py-3"
          >
            <p className="text-sm text-foreground/60">Valor bruto cancelado</p>
            <p className="text-xl font-semibold tracking-tight">
              {formatBRL(summary.cancelledRevenue)}
            </p>
            <ComparisonLine pct={comparison.cancelledRevenuePct} />
          </div>

          <div
            data-testid="kpi-card-cancellation-rate"
            className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-background px-4 py-3"
          >
            <p className="text-sm text-foreground/60">Taxa de cancelamento</p>
            <p className="text-xl font-semibold tracking-tight">
              {formatDecimal(summary.cancellationRate)}%
            </p>
            <p className="text-xs font-medium text-foreground/60">
              {formatPercentagePoints(comparison.cancellationRateDiffPp)} vs.
              período anterior
            </p>
          </div>
        </div>
      </div>
    </details>
  );
}
