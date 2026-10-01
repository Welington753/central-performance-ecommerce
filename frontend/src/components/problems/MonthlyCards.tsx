import { Badge } from "@/components/problems/ProblemsBadges";
import type { MonthlyTotals } from "@/lib/problems-monthly-aggregate";
import {
  formatDecimal,
  formatDuration,
  formatInteger,
  formatPercent,
} from "@/lib/problems-monthly-format";

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border-subtle bg-surface px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/70">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
      {hint ? <span className="text-xs text-foreground/70">{hint}</span> : null}
    </div>
  );
}

/** Cards do período: números somados; a taxa só é "definitiva" sem nenhuma linha parcial. */
export function MonthlyCards({ totals }: { totals: MonthlyTotals }) {
  const provisional = totals.partial ? "Provisória — dados parciais" : undefined;
  const reputationHint =
    totals.reputationImpactRate === null ? undefined : `${formatPercent(totals.reputationImpactRate)} dos problemas`;
  return (
    <section aria-label="Resumo do período" className="flex flex-col gap-2">
      {totals.partial ? (
        <div>
          <Badge tone="notice" symbol="◐">
            Dados parciais
          </Badge>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Card label="Total de problemas" value={formatInteger(totals.totalProblems)} />
        <Card label="Total de pedidos" value={formatInteger(totals.totalOrders)} />
        <Card label="Problemas por 100 pedidos" value={formatDecimal(totals.problemsPer100Orders)} hint={provisional} />
        <Card label="Impactaram a reputação" value={formatInteger(totals.reputationImpactCount)} hint={reputationHint} />
        <Card label="Taxa de resolução" value={formatPercent(totals.resolutionRate)} hint={provisional} />
        <Card label="Tempo médio de resolução" value={formatDuration(totals.averageResolutionHours)} />
        <Card label="Problemas em aberto" value={formatInteger(totals.openProblems)} />
      </div>
    </section>
  );
}
