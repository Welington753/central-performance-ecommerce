import type { PeriodWindow } from './period.util';
import { utcInstantToSaoPauloDateString } from './period.util';

export type DataCoverageStatus = 'complete' | 'partial' | 'unknown';

export interface DataCoverage {
  status: DataCoverageStatus;
  synchronizedFrom: string | null;
  synchronizedTo: string | null;
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
}

export interface SyncedInterval {
  from: Date;
  to: Date;
}

/**
 * Funde intervalos sobrepostos/adjacentes de execuções de sincronização
 * concluídas com sucesso. A cobertura de um período só pode ser "completa"
 * se ele estiver inteiramente contido em UM ÚNICO intervalo fundido — nunca
 * apenas na soma bruta de vários intervalos com um buraco no meio
 * (Checkpoint 2, "Cobertura dos dados": "não usar simplesmente a menor e a
 * maior data de pedido como prova de cobertura").
 */
export function mergeIntervals(
  intervals: readonly SyncedInterval[],
): SyncedInterval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort(
    (a, b) => a.from.getTime() - b.from.getTime(),
  );

  const merged: SyncedInterval[] = [{ ...sorted[0] }];

  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (interval.from.getTime() <= last.to.getTime()) {
      if (interval.to.getTime() > last.to.getTime()) {
        last.to = interval.to;
      }
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

export function isFullyCovered(
  mergedIntervals: readonly SyncedInterval[],
  window: PeriodWindow,
): boolean {
  return mergedIntervals.some(
    (interval) =>
      interval.from.getTime() <= window.from.getTime() &&
      interval.to.getTime() >= window.to.getTime(),
  );
}

/**
 * Função pura (sem acesso a banco) — recebe as execuções de sincronização
 * já concluídas com sucesso (`status = 'SUCCESS'`) e determina a cobertura
 * dos dois períodos exibidos no dashboard.
 *
 * `unknown`: nunca houve uma sincronização concluída com sucesso — não é
 * possível provar cobertura alguma (nunca inventamos cobertura retroativa).
 * `complete`: os dois períodos (selecionado e de comparação) estão
 * inteiramente contidos em execuções concluídas.
 * `partial`: já houve sincronização, mas pelo menos um dos dois períodos
 * não está inteiramente coberto.
 */
export function computeDataCoverage(
  successfulRuns: readonly SyncedInterval[],
  currentWindow: PeriodWindow,
  previousWindow: PeriodWindow,
): DataCoverage {
  if (successfulRuns.length === 0) {
    return {
      status: 'unknown',
      synchronizedFrom: null,
      synchronizedTo: null,
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
    };
  }

  const merged = mergeIntervals(successfulRuns);
  const synchronizedFrom = successfulRuns.reduce(
    (min, run) => (run.from.getTime() < min.getTime() ? run.from : min),
    successfulRuns[0].from,
  );
  const synchronizedTo = successfulRuns.reduce(
    (max, run) => (run.to.getTime() > max.getTime() ? run.to : max),
    successfulRuns[0].to,
  );

  const selectedPeriodComplete = isFullyCovered(merged, currentWindow);
  const comparisonPeriodComplete = isFullyCovered(merged, previousWindow);

  return {
    status:
      selectedPeriodComplete && comparisonPeriodComplete
        ? 'complete'
        : 'partial',
    synchronizedFrom: utcInstantToSaoPauloDateString(synchronizedFrom),
    synchronizedTo: utcInstantToSaoPauloDateString(synchronizedTo),
    selectedPeriodComplete,
    comparisonPeriodComplete,
  };
}
