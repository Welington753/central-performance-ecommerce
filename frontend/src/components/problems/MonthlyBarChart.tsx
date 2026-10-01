import { ChartLegend, MonthColumn, seriesStyle } from "@/components/problems/ProblemsChartParts";
import { itemsOfMonth, worstCoverage, type MonthlySeries } from "@/lib/problems-monthly-aggregate";
import { formatInteger, NOT_AVAILABLE } from "@/lib/problems-monthly-format";

const CHART_HEIGHT = "h-40";

/** Barras agrupadas de problemas por conta e mês; mês sem linha = sem barra ("Sem dados"), nunca zero. */
export function MonthlyBarChart({ series }: { series: MonthlySeries }) {
  const values = series.accounts.flatMap((account) =>
    [...account.byMonth.values()].map((item) => item.totalProblems),
  );
  const max = Math.max(1, ...values);
  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <figcaption className="text-sm font-semibold">Evolução mensal de problemas</figcaption>
      <ChartLegend labels={series.accounts.map((account) => account.label)} />
      <div role="list" aria-label="Problemas por mês" className="flex items-end gap-1 pt-6">
        {series.months.map((month) => {
          const rows = itemsOfMonth(series, month);
          const lines = series.accounts.map((account) => {
            const item = account.byMonth.get(month);
            return `${account.label}: ${item ? `${formatInteger(item.totalProblems)} problemas` : "sem dados"}`;
          });
          return (
            <MonthColumn key={month} month={month} coverage={worstCoverage(rows)} lines={lines}>
              <div className={`flex ${CHART_HEIGHT} items-end justify-center gap-0.5`}>
                {series.accounts.map((account, index) => {
                  const item = account.byMonth.get(month);
                  if (!item) return <div key={account.accountId} className="w-full max-w-6" aria-hidden="true" />;
                  const partial = item.coverage !== "COMPLETE";
                  return (
                    <div key={account.accountId} className="flex h-full w-full max-w-6 flex-col justify-end">
                      <span aria-hidden="true" className="text-center text-[10px] leading-tight">
                        {formatInteger(item.totalProblems)}
                      </span>
                      <div
                        aria-hidden="true"
                        className={`${seriesStyle(index).bar} rounded-t ${partial ? "border border-dashed border-foreground opacity-50" : ""}`}
                        style={{ height: `${Math.max(2, (item.totalProblems / max) * 85)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
            </MonthColumn>
          );
        })}
      </div>
      {series.months.length === 0 ? <p className="text-sm text-foreground/70">{NOT_AVAILABLE}</p> : null}
    </figure>
  );
}
