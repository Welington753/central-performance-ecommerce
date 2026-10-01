import type { ProblemsSyncAction } from "@/lib/problems-api";
import type { ProblemsHistoricalCoverageDto, ProblemsSyncStatusDto } from "@/types/problems";

/**
 * Progresso do histórico (0–100) ou `null` quando faltam datas válidas — nunca
 * se inventa porcentagem. O histórico anda do mais recente (incremental) para o
 * mais antigo (alvo); só `COMPLETED` chega a 100.
 */
export function historicalProgress(
  coverage: Pick<
    ProblemsHistoricalCoverageDto,
    "historicalCoveredFrom" | "historicalTargetFrom" | "incrementalCoveredThrough" | "historicalStatus"
  >,
): number | null {
  const { historicalCoveredFrom, historicalTargetFrom, incrementalCoveredThrough, historicalStatus } = coverage;
  if (!historicalCoveredFrom || !historicalTargetFrom || !incrementalCoveredThrough) return null;
  const through = new Date(incrementalCoveredThrough).getTime();
  const target = new Date(historicalTargetFrom).getTime();
  const covered = new Date(historicalCoveredFrom).getTime();
  if ([through, target, covered].some(Number.isNaN) || through <= target) return null;
  if (historicalStatus === "COMPLETED") return 100;
  const percent = Math.floor(((through - covered) / (through - target)) * 100);
  return Math.min(99, Math.max(0, percent));
}

/** Conta com dado parcial: histórico ainda não completo (e com alvo) ou claims inacessíveis. */
export function isCoveragePartial(
  coverage: Pick<ProblemsHistoricalCoverageDto, "historicalStatus" | "quarantinedClaimsCount">,
): boolean {
  const historyDone = coverage.historicalStatus === "COMPLETED" || coverage.historicalStatus === "NO_TARGET";
  return !historyDone || coverage.quarantinedClaimsCount > 0;
}

export interface CoverageControl {
  scope: "incremental" | "historical";
  action: ProblemsSyncAction;
  label: string;
  /** Texto da confirmação (nunca dispara sincronização HTTP: só grava o estado do job). */
  confirm: string;
}

/** Controles por estado — todos exigem `problems.sync` (o chamador só os monta para quem tem). */
export function coverageControls(status: ProblemsSyncStatusDto, account: string): CoverageControl[] {
  const controls: CoverageControl[] = [];
  switch (status.jobStatus) {
    case "NOT_STARTED":
      controls.push({
        scope: "incremental",
        action: "start",
        label: "Iniciar sincronização",
        confirm: `Iniciar a sincronização de ${account}?`,
      });
      break;
    case "RUNNING":
    case "WAITING_RETRY":
      if (!status.pauseRequested) {
        controls.push({
          scope: "incremental",
          action: "pause",
          label: "Pausar sincronização",
          confirm: `Pausar a sincronização de ${account}? O progresso é mantido.`,
        });
      }
      break;
    default:
      controls.push({
        scope: "incremental",
        action: "resume",
        label: "Retomar sincronização",
        confirm: `Retomar a sincronização de ${account}?`,
      });
  }
  if (status.jobStatus !== "NOT_STARTED") {
    if (status.historicalStatus === "RUNNING") {
      controls.push({
        scope: "historical",
        action: "pause",
        label: "Pausar histórico",
        confirm: `Pausar a busca do histórico de ${account}? O progresso é mantido e nada recomeça do zero.`,
      });
    } else if (status.historicalStatus === "PAUSED" || status.historicalStatus === "FAILED") {
      controls.push({
        scope: "historical",
        action: "resume",
        label: "Retomar histórico",
        confirm: `Retomar a busca do histórico de ${account} do ponto em que parou?`,
      });
    }
  }
  return controls;
}
