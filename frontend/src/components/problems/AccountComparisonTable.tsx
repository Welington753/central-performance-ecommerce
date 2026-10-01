import { CoverageBadge } from "@/components/problems/ProblemsCoverageBadges";
import type { AccountComparisonRow } from "@/lib/problems-monthly-aggregate";
import { formatDecimal, formatInteger, formatPercent } from "@/lib/problems-monthly-format";

const th = "px-3 py-2 font-medium";

export function AccountComparisonTable({ rows }: { rows: AccountComparisonRow[] }) {
  return (
    <section aria-label="Comparativo por conta" className="rounded-xl border border-border-subtle bg-surface">
      <h3 className="px-4 pt-3 text-sm font-semibold">Comparativo por conta</h3>
      <table className="mt-2 w-full text-sm">
        <thead className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/70">
          <tr>
            <th scope="col" className={`${th} text-left`}>Conta</th>
            <th scope="col" className={`${th} text-right`}>Problemas</th>
            <th scope="col" className={`${th} text-right`}>Pedidos</th>
            <th scope="col" className={`${th} text-right`}>Por 100 pedidos</th>
            <th scope="col" className={`${th} text-right`}>Reputação</th>
            <th scope="col" className={`${th} text-right`}>Resolução</th>
            <th scope="col" className={`${th} text-left`}>Cobertura</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ accountId, label, totals, coverage }) => (
            <tr key={accountId} className="border-b border-border-subtle last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium">{label}</th>
              <td className="px-3 py-2 text-right">{formatInteger(totals.totalProblems)}</td>
              <td className="px-3 py-2 text-right">{formatInteger(totals.totalOrders)}</td>
              <td className="px-3 py-2 text-right">
                {formatDecimal(totals.problemsPer100Orders)}
                {totals.partial && totals.problemsPer100Orders !== null ? " (provisória)" : ""}
              </td>
              <td className="px-3 py-2 text-right">{formatInteger(totals.reputationImpactCount)}</td>
              <td className="px-3 py-2 text-right">{formatPercent(totals.resolutionRate)}</td>
              <td className="px-3 py-2"><CoverageBadge coverage={coverage} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
