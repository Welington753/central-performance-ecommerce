import type { PeriodWindow } from '../marketplace-orders/period.util';
import {
  isFullyCovered,
  mergeIntervals,
  type SyncedInterval,
} from '../marketplace-orders/coverage-interval.util';
import { utcInstantToSaoPauloDateString } from '../marketplace-orders/period.util';

export type { SyncedInterval };
export type DataCoverageStatus = 'complete' | 'partial' | 'unknown';

export interface DataCoverage {
  status: DataCoverageStatus;
  synchronizedFrom: string | null;
  synchronizedTo: string | null;
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
}

/**
 * Função pura (sem acesso a banco) — recebe as execuções de sincronização
 * já concluídas com sucesso (`status = 'SUCCESS'`) e determina a cobertura
 * dos dois períodos exibidos no endpoint LEGADO do Mercado Livre (a
 * cobertura consolidada multi-marketplace vive em
 * `marketplace-analytics/consolidated-coverage.util.ts`, que reaproveita as
 * mesmas primitivas genéricas `mergeIntervals`/`isFullyCovered` de
 * `marketplace-orders/coverage-interval.util.ts`).
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
