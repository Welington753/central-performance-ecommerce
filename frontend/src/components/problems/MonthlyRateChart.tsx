import { ChartLegend, MonthColumn, seriesStyle } from "@/components/problems/ProblemsChartParts";
import { itemsOfMonth, worstCoverage, type MonthlySeries } from "@/lib/problems-monthly-aggregate";
import { formatDecimal } from "@/lib/problems-monthly-format";

const WIDTH = 600;
const HEIGHT = 160;
const PAD = 12;

interface Point {
  i: number;
  rate: number;
  partial: boolean;
}

/** Linha de problemas por 100 pedidos. Mês sem taxa (sem pedidos ou sem linha) quebra a linha — nunca desenha zero. */
export function MonthlyRateChart({ series }: { series: MonthlySeries }) {
  const count = Math.max(1, series.months.length);
  const rates = series.accounts.flatMap((account) =>
    [...account.byMonth.values()].flatMap((item) =>
      item.problemsPer100Orders === null ? [] : [item.problemsPer100Orders],
    ),
  );
  const max = Math.max(1, ...rates);
  const x = (index: number) => ((index + 0.5) / count) * WIDTH;
  const y = (rate: number) => HEIGHT - PAD - (rate / max) * (HEIGHT - 2 * PAD);

  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <figcaption className="text-sm font-semibold">Problemas por 100 pedidos</figcaption>
      <ChartLegend labels={series.accounts.map((account) => account.label)} />
      <div className="relative pt-6">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          aria-hidden="true"
          className="absolute inset-x-0 top-6 w-full"
          preserveAspectRatio="none"
          style={{ height: HEIGHT }}
        >
          <line x1="0" x2={WIDTH} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke="currentColor" opacity="0.2" />
          {series.accounts.map((account, accountIndex) => {
            const segments: Point[][] = [[]];
            series.months.forEach((month, i) => {
              const item = account.byMonth.get(month);
              if (!item || item.problemsPer100Orders === null) {
                if (segments[segments.length - 1].length > 0) segments.push([]);
                return;
              }
              segments[segments.length - 1].push({
                i,
                rate: item.problemsPer100Orders,
                partial: !item.rateDefinitive,
              });
            });
            return (
              <g
                key={account.accountId}
                className={seriesStyle(accountIndex).text}
                stroke="currentColor"
                fill="currentColor"
              >
                {segments.map((segment) =>
                  segment.length > 1 ? (
                    <polyline
                      key={segment[0].i}
                      fill="none"
                      strokeWidth="2"
                      strokeDasharray={segment.some((p) => p.partial) ? "5 4" : undefined}
                      points={segment.map((p) => `${x(p.i)},${y(p.rate)}`).join(" ")}
                    />
                  ) : null,
                )}
                {segments.flat().map((p) => (
                  <circle
                    key={p.i}
                    cx={x(p.i)}
                    cy={y(p.rate)}
                    r="4"
                    strokeWidth="2"
                    fill={p.partial ? "var(--surface)" : "currentColor"}
                  />
                ))}
              </g>
            );
          })}
        </svg>
        <div role="list" aria-label="Taxa de problemas por mês" className="relative flex gap-1">
          {series.months.map((month) => {
            const lines = series.accounts.map((account) => {
              const item = account.byMonth.get(month);
              if (!item) return `${account.label}: sem dados`;
              if (item.problemsPer100Orders === null) return `${account.label}: N/D (sem pedidos)`;
              const suffix = item.rateDefinitive ? "" : " (provisória)";
              return `${account.label}: ${formatDecimal(item.problemsPer100Orders)} por 100 pedidos${suffix}`;
            });
            return (
              <MonthColumn
                key={month}
                month={month}
                coverage={worstCoverage(itemsOfMonth(series, month))}
                lines={lines}
              >
                <div style={{ height: HEIGHT }} />
              </MonthColumn>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-foreground/70">
        Ponto vazado = taxa provisória (cobertura parcial). Meses sem pedidos ou sem dados ficam sem ponto.
      </p>
    </figure>
  );
}
