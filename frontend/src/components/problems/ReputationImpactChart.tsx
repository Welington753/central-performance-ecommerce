import { CoverageBadge } from "@/components/problems/ProblemsCoverageBadges";
import { aggregateMonthly, itemsOfMonth, worstCoverage, type MonthlySeries } from "@/lib/problems-monthly-aggregate";
import { formatInteger, formatPercent, formatYearMonth } from "@/lib/problems-monthly-format";

/** Impacto na reputação: total mensal e percentual sobre os problemas do mês. */
export function ReputationImpactChart({ series }: { series: MonthlySeries }) {
  const rows = series.months.map((month) => {
    const items = itemsOfMonth(series, month);
    return { month, hasData: items.length > 0, totals: aggregateMonthly(items), coverage: worstCoverage(items) };
  });
  const max = Math.max(1, ...rows.map((row) => row.totals.reputationImpactCount));
  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <figcaption className="text-sm font-semibold">Impacto na reputação</figcaption>
      <ul aria-label="Impacto na reputação por mês" className="flex flex-col gap-1.5 text-sm">
        {rows.map(({ month, hasData, totals, coverage }) => (
          <li key={month} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
            <span className="text-foreground/80">{formatYearMonth(month)}</span>
            {hasData ? (
              <div className="h-3 rounded bg-foreground/10" aria-hidden="true">
                <div
                  className={`h-3 rounded bg-brand ${coverage === "COMPLETE" ? "" : "border border-dashed border-foreground opacity-50"}`}
                  style={{ width: `${(totals.reputationImpactCount / max) * 100}%` }}
                />
              </div>
            ) : (
              <span className="text-foreground/70">Sem dados</span>
            )}
            {hasData ? (
              <span className="flex items-center gap-2 whitespace-nowrap">
                {formatInteger(totals.reputationImpactCount)} · {formatPercent(totals.reputationImpactRate)} dos problemas
                {coverage === "COMPLETE" ? null : <CoverageBadge coverage={coverage} />}
              </span>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </figure>
  );
}
