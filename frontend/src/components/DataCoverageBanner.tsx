import { formatCalendarDate } from "@/lib/kpi-format";
import type { MercadoLivreKpisDto } from "@/types/mercado-livre-kpis";

interface DataCoverageBannerProps {
  coverage: MercadoLivreKpisDto["dataCoverage"];
}

/**
 * Aviso de cobertura de dados (Checkpoint 2, "Cobertura dos dados") — nunca
 * apresenta um período parcial como se fosse completo.
 */
export function DataCoverageBanner({ coverage }: DataCoverageBannerProps) {
  if (coverage.status === "complete") {
    return (
      <p className="text-xs text-foreground/50">
        Dados sincronizados de {formatCalendarDate(coverage.synchronizedFrom!)}{" "}
        a {formatCalendarDate(coverage.synchronizedTo!)}. Período selecionado
        e período de comparação totalmente cobertos.
      </p>
    );
  }

  if (coverage.status === "unknown") {
    return (
      <div
        role="status"
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800"
      >
        Ainda não há nenhuma sincronização concluída para esta conta — os
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
        Cobertura parcial: dados sincronizados de{" "}
        {coverage.synchronizedFrom ? formatCalendarDate(coverage.synchronizedFrom) : "—"}{" "}
        a {coverage.synchronizedTo ? formatCalendarDate(coverage.synchronizedTo) : "—"}.
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
