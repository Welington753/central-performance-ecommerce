import { formatBRL, formatDecimal, formatPercent } from "@/lib/kpi-format";
import { EmptyStateIcon } from "@/components/EmptyState";
import type {
  AnalyticsFullComparison,
  AnalyticsFullRankingEntry,
  LogisticsGroupSummary,
  MarketplaceAnalyticsFull,
} from "@/types/marketplace-analytics";

interface FullPerformanceSectionProps {
  full: MarketplaceAnalyticsFull;
  /** "Mercado Livre Full" ou "Shopee Full" — nunca hardcoded dentro do componente. */
  title: string;
  /** Explicação curta exibida abaixo do título (ex.: Shopee, "Pedidos processados pela logística Full da Shopee."). Omitida quando o marketplace não precisa dela. */
  description?: string;
}

const EMPTY_COMPARISON: AnalyticsFullComparison = {
  grossSalesRevenuePct: null,
  grossSalesOrdersPct: null,
  grossSalesUnitsPct: null,
  paidRevenuePct: null,
  paidOrdersPct: null,
  paidUnitsPct: null,
  averageTicketPct: null,
  cancelledOrdersPct: null,
  cancelledUnitsPct: null,
  cancelledRevenuePct: null,
};

interface CardSpec {
  key: string;
  label: string;
  value: string;
  comparisonPct: number | null;
}

function ComparisonLine({ pct }: { pct: number | null }) {
  const formatted = formatPercent(pct);
  const isPositive = (pct ?? 0) > 0;
  const isNegative = (pct ?? 0) < 0;
  return (
    <p
      className={`text-sm font-medium ${
        formatted === null
          ? "text-foreground/40"
          : isPositive
            ? "text-positive"
            : isNegative
              ? "text-negative"
              : "text-foreground/60"
      }`}
    >
      {formatted ?? "—"}
      <span className="ml-1 font-normal text-foreground/40">vs. período anterior</span>
    </p>
  );
}

function CoverageNotice({ full }: { full: MarketplaceAnalyticsFull }) {
  if (full.coverage === "complete") return null;

  if (full.coverage === "unknown") {
    return (
      <div
        role="status"
        className="rounded-md border border-notice/40 bg-notice/10 px-4 py-3 text-sm text-notice"
      >
        Ainda não foi possível identificar a modalidade logística de nenhum
        pedido deste período — os números do Full abaixo podem estar
        incompletos.
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-md border border-notice/40 bg-notice/10 px-4 py-3 text-sm text-notice"
    >
      Cobertura parcial da classificação Full: {full.classifiedOrders} de{" "}
      {full.classifiedOrders + full.unclassifiedOrders} pedidos do período já
      foram classificados. Os números abaixo podem crescer conforme os
      pedidos restantes forem classificados numa próxima sincronização.
    </div>
  );
}

interface ComparisonRow {
  label: string;
  pick: (group: LogisticsGroupSummary) => string;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { label: "Vendas brutas (R$)", pick: (g) => formatBRL(g.grossSalesRevenue) },
  { label: "Quantidade de vendas", pick: (g) => String(g.grossSalesOrders) },
  { label: "Unidades vendidas", pick: (g) => String(g.grossSalesUnits) },
  { label: "Faturamento pago", pick: (g) => formatBRL(g.paidRevenue) },
  { label: "Pedidos pagos", pick: (g) => String(g.paidOrders) },
  { label: "Unidades pagas", pick: (g) => String(g.paidUnits) },
  { label: "Cancelamentos — pedidos", pick: (g) => String(g.cancelledOrders) },
  { label: "Cancelamentos — unidades", pick: (g) => String(g.cancelledUnits) },
  { label: "Cancelamentos — valor", pick: (g) => formatBRL(g.cancelledRevenue) },
];

/**
 * Comparativo Full x sem Full x total (Fase 4, item 4) — cada coluna é
 * independentemente `null` quando aquele grupo não tem nenhum pedido no
 * período; mostra "—", nunca um zero fabricado.
 */
function GroupComparisonTable({ full }: { full: MarketplaceAnalyticsFull }) {
  const groups: Array<{ label: string; data: LogisticsGroupSummary | null }> = [
    { label: "Full", data: full.summary },
    { label: "Vendas sem Full", data: full.nonFullSummary },
    { label: "Total geral", data: full.totalSummary },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            <th scope="col" className="px-4 py-3 font-medium">
              Indicador
            </th>
            {groups.map((group) => (
              <th key={group.label} scope="col" className="px-4 py-3 font-medium">
                {group.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-border-subtle last:border-0">
              <td className="px-4 py-3 text-foreground/70">{row.label}</td>
              {groups.map((group) => (
                <td key={group.label} className="px-4 py-3">
                  {group.data ? row.pick(group.data) : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Indicador âmbar de pedidos ainda não classificados (Fase 4, item 3) — só
 * aparece quando `unclassifiedOrders > 0`; nunca oculta a diferença entre
 * Full+sem Full e o total. Quando não há nenhum UNKNOWN, mostra a
 * confirmação inversa (Full + sem Full = total).
 */
function UnknownIndicator({ full }: { full: MarketplaceAnalyticsFull }) {
  if (full.unclassifiedOrders === 0) {
    return (
      <p className="text-sm text-positive">
        Nenhum pedido não classificado no período — Full + vendas sem Full =
        total das vendas.
      </p>
    );
  }

  const unknown = full.unknownSummary;
  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border border-notice/40 bg-notice/10 px-4 py-3 text-sm text-notice"
    >
      <p>
        {full.unclassifiedOrders} pedido(s) ainda não classificado(s) neste
        período — Full e &quot;vendas sem Full&quot; continuam com cobertura
        parcial; a diferença para o total nunca é escondida.
      </p>
      {unknown ? (
        <p>
          Não classificado: {formatBRL(unknown.grossSalesRevenue)} em vendas
          brutas, {unknown.grossSalesOrders} pedido(s), {unknown.grossSalesUnits}{" "}
          unidade(s).
        </p>
      ) : null}
    </div>
  );
}

function RankingTable({ rows }: { rows: AnalyticsFullRankingEntry[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-16 text-center">
        <EmptyStateIcon />
        <p className="text-sm text-foreground/60">
          Nenhum produto vendido no Full neste período.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
            <th scope="col" className="px-4 py-3 font-medium">#</th>
            <th scope="col" className="px-4 py-3 font-medium">SKU</th>
            <th scope="col" className="px-4 py-3 font-medium">Produto</th>
            <th scope="col" className="px-4 py-3 font-medium">Anúncios</th>
            <th scope="col" className="px-4 py-3 font-medium">Pedidos</th>
            <th scope="col" className="px-4 py-3 font-medium">Unidades</th>
            <th scope="col" className="px-4 py-3 font-medium">Faturamento pago</th>
            <th scope="col" className="px-4 py-3 font-medium">Vendas brutas</th>
            <th scope="col" className="px-4 py-3 font-medium">% das unidades Full</th>
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
              <td className="px-4 py-3">{row.orders}</td>
              <td className="px-4 py-3">{row.units}</td>
              <td className="px-4 py-3">{formatBRL(row.paidRevenue)}</td>
              <td className="px-4 py-3">{formatBRL(row.grossSalesRevenue)}</td>
              <td className="px-4 py-3">{formatDecimal(row.unitsSharePct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHART_HEIGHT = 120;
const BAR_WIDTH = 10;
const BAR_GAP = 4;

function FullDailyChart({ full }: { full: MarketplaceAnalyticsFull }) {
  const series = full.dailySeries;
  if (series.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        Nenhum dado diário disponível para o período.
      </p>
    );
  }

  const values = series.map((point) => Number(point.paidRevenue));
  const maxValue = Math.max(...values, 0);
  const svgWidth = series.length * (BAR_WIDTH + BAR_GAP);

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface p-4">
      <svg
        role="img"
        aria-label={`Gráfico de faturamento pago Full diário, de ${series[0].date} a ${
          series[series.length - 1].date
        }.`}
        width={svgWidth}
        height={CHART_HEIGHT}
        className="min-w-full"
      >
        {series.map((point, index) => {
          const value = values[index];
          const barHeight =
            maxValue > 0
              ? Math.max((value / maxValue) * (CHART_HEIGHT - 4), value > 0 ? 2 : 0)
              : 0;
          return (
            <rect
              key={point.date}
              x={index * (BAR_WIDTH + BAR_GAP)}
              y={CHART_HEIGHT - barHeight}
              width={BAR_WIDTH}
              height={barHeight}
              className={value > 0 ? "fill-brand" : "fill-foreground/10"}
            >
              <title>
                {point.date}: {formatBRL(point.paidRevenue)}
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Seção "Mercado Livre Full" (Fase 4) — sempre restrita a
 * `logistics_classification = 'MARKETPLACE_FULFILLED'`. Nunca renderiza um
 * card com zero como se fosse dado completo quando `summary` é `null`
 * (cobertura incompleta ou nenhum pedido Full no escopo) — mostra o aviso de
 * cobertura em vez disso. Contrato deliberadamente sem nenhum campo de
 * recomendação de reposição/estoque — fora do escopo desta fase.
 */
export function FullPerformanceSection({
  full,
  title,
  description,
}: FullPerformanceSectionProps) {
  const comparison = full.comparison ?? EMPTY_COMPARISON;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? (
          <p className="text-sm text-foreground/60">{description}</p>
        ) : null}
      </div>
      <CoverageNotice full={full} />

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">
          Full x vendas sem Full x total geral
        </h3>
        <GroupComparisonTable full={full} />
        <UnknownIndicator full={full} />
      </div>

      {full.summary ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                {
                  key: "gross-sales-revenue",
                  label: "Vendas brutas Full",
                  value: formatBRL(full.summary.grossSalesRevenue),
                  comparisonPct: comparison.grossSalesRevenuePct,
                },
                {
                  key: "paid-revenue",
                  label: "Faturamento pago Full",
                  value: formatBRL(full.summary.paidRevenue),
                  comparisonPct: comparison.paidRevenuePct,
                },
                {
                  key: "paid-orders",
                  label: "Pedidos pagos Full",
                  value: String(full.summary.paidOrders),
                  comparisonPct: comparison.paidOrdersPct,
                },
                {
                  key: "paid-units",
                  label: "Unidades vendidas Full",
                  value: String(full.summary.paidUnits),
                  comparisonPct: comparison.paidUnitsPct,
                },
                {
                  key: "average-ticket",
                  label: "Ticket médio Full",
                  value: formatBRL(full.summary.averageTicket),
                  comparisonPct: comparison.averageTicketPct,
                },
                {
                  key: "share-revenue",
                  label: "% do faturamento pago vindo do Full",
                  value: `${formatDecimal(full.summary.shareOfPaidRevenuePct)}%`,
                  comparisonPct: null,
                },
                {
                  key: "share-units",
                  label: "% das unidades vendidas no Full",
                  value: `${formatDecimal(full.summary.shareOfPaidUnitsPct)}%`,
                  comparisonPct: null,
                },
                {
                  key: "cancelled",
                  label: "Cancelamentos Full",
                  value: `${full.summary.cancelledOrders} pedidos`,
                  comparisonPct: comparison.cancelledOrdersPct,
                },
              ] satisfies CardSpec[]
            ).map((card) => (
              <div
                key={card.key}
                data-testid={`full-kpi-card-${card.key}`}
                className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-5 py-4"
              >
                <p className="text-sm text-foreground/60">{card.label}</p>
                <p className="text-2xl font-semibold tracking-tight">{card.value}</p>
                <ComparisonLine pct={card.comparisonPct} />
              </div>
            ))}
          </div>

          <p className="text-xs text-foreground/50">
            Cancelamentos Full: {full.summary.cancelledOrders} pedidos,{" "}
            {full.summary.cancelledUnits} unidades,{" "}
            {formatBRL(full.summary.cancelledRevenue)}.
          </p>

          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">Faturamento pago diário (Full)</h3>
            <FullDailyChart full={full} />
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">Ranking de produtos Full</h3>
            <RankingTable rows={full.ranking} />
          </div>
        </>
      ) : (
        <p className="text-sm text-foreground/60">
          Nenhum pedido Full comprovado neste período ainda.
        </p>
      )}
    </div>
  );
}
