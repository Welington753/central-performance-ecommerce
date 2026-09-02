import { formatCalendarDate } from "@/lib/kpi-format";
import type { AnalyticsDataCoverage } from "@/types/marketplace-analytics";

interface DataCoverageBannerProps {
  coverage: AnalyticsDataCoverage;
}

/**
 * Descreve os intervalos REALMENTE sincronizados (Checkpoint 3, achado #3)
 * — nunca resume vários intervalos separados como um único período
 * contínuo. Um intervalo: "de X a Y". Vários: "de X a Y e de W a Z".
 */
function describeIntervals(intervals: AnalyticsDataCoverage["synchronizedIntervals"]): string {
  return intervals
    .map((interval) => `${formatCalendarDate(interval.from)} a ${formatCalendarDate(interval.to)}`)
    .join(" e de ")
    .replace(/^/, intervals.length > 0 ? "de " : "");
}

/**
 * Aviso de cobertura de dados (Checkpoint 2/3, "Cobertura dos dados") —
 * nunca apresenta um período parcial como se fosse completo, e nunca funde
 * intervalos separados numa única faixa contínua enganosa.
 */
export function DataCoverageBanner({ coverage }: DataCoverageBannerProps) {
  if (coverage.status === "complete") {
    return (
      <p className="text-xs text-foreground/50">
        Dados sincronizados {describeIntervals(coverage.synchronizedIntervals)}.
        Período selecionado e período de comparação totalmente cobertos.
      </p>
    );
  }

  if (coverage.status === "unknown") {
    return (
      <div
        role="status"
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800"
      >
        Ainda não há nenhuma sincronização concluída para esta fonte — os
        números abaixo podem estar incompletos ou vazios.
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800"
    >
      <p>
        Cobertura parcial: dados sincronizados{" "}
        {coverage.synchronizedIntervals.length > 0
          ? describeIntervals(coverage.synchronizedIntervals)
          : "em nenhum intervalo comprovado"}
        .
      </p>
      {!coverage.selectedPeriodComplete ? (
        <p>O período selecionado não está totalmente sincronizado.</p>
      ) : null}
      {!coverage.comparisonPeriodComplete ? (
        <p>O período de comparação não está totalmente sincronizado.</p>
      ) : null}
    </div>
  );
}
