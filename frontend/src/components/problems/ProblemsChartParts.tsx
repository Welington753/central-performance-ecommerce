import { CoverageBadge } from "@/components/problems/ProblemsCoverageBadges";
import { COVERAGE_LABELS, formatYearMonth, type MonthCoverageLabel } from "@/lib/problems-monthly-format";

/** Cada série tem cor E símbolo próprio (legenda e rótulos) — nunca só cor. */
export const SERIES_STYLES = [
  { bar: "bg-brand", text: "text-brand", symbol: "■" },
  { bar: "bg-sky-600", text: "text-sky-600", symbol: "▲" },
  { bar: "bg-amber-600", text: "text-amber-600", symbol: "●" },
  { bar: "bg-teal-700", text: "text-teal-700", symbol: "◆" },
] as const;

export const seriesStyle = (index: number) => SERIES_STYLES[index % SERIES_STYLES.length];

export function ChartLegend({ labels, partialNote = true }: { labels: string[]; partialNote?: boolean }) {
  return (
    <ul aria-label="Legenda" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/80">
      {labels.map((label, index) => (
        <li key={label} className="flex items-center gap-1">
          <span aria-hidden="true" className={seriesStyle(index).text}>
            {seriesStyle(index).symbol}
          </span>
          {label}
        </li>
      ))}
      {partialNote ? (
        <li className="flex items-center gap-1">
          <span aria-hidden="true">◐</span>
          Mês parcial ou indeterminado (barras tracejadas)
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Coluna de um mês: focável, com tooltip (hover/foco) e rótulo acessível que
 * lista cobertura e valores por conta em texto.
 */
export function MonthColumn({
  month,
  coverage,
  lines,
  children,
}: {
  month: string;
  coverage: MonthCoverageLabel;
  lines: string[];
  children?: React.ReactNode;
}) {
  const label = formatYearMonth(month);
  const flagged = coverage !== "COMPLETE" && coverage !== "NO_DATA";
  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-label={`${label}. Cobertura: ${COVERAGE_LABELS[coverage]}. ${lines.join(". ")}`}
      className="group relative flex min-w-0 flex-1 flex-col items-stretch gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-max max-w-[15rem] -translate-x-1/2 flex-col gap-1 rounded-md border border-border-subtle bg-background px-3 py-2 text-xs shadow-lg group-hover:flex group-focus:flex"
      >
        <span className="font-semibold">{label}</span>
        <CoverageBadge coverage={coverage} />
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
      {children}
      <span className="truncate text-center text-[11px] text-foreground/70">
        {label}
        {flagged ? <span aria-hidden="true"> ◐</span> : null}
      </span>
    </div>
  );
}
