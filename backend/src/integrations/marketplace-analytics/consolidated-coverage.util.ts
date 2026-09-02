import {
  isFullyCovered,
  mergeIntervals,
  type SyncedInterval,
} from '../mercado-livre-orders/sync-coverage.util';
import {
  utcInstantToSaoPauloDateString,
  type PeriodWindow,
} from '../mercado-livre-orders/period.util';

export type ConsolidatedCoverageStatus = 'complete' | 'partial' | 'unknown';

export interface SynchronizedIntervalDto {
  from: string;
  to: string;
}

export interface PerSourceCoverage {
  intervals: SyncedInterval[];
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
  hasAnySuccess: boolean;
}

export interface ConsolidatedCoverage {
  status: ConsolidatedCoverageStatus;
  intervals: SyncedInterval[];
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
}

/** Cobertura de UMA fonte (conta) isolada — mesma lógica de `computeDataCoverage` (CP2), mas devolvendo os intervalos como `Date`, não como string, para permitir fusão entre fontes antes de formatar. */
export function computeSourceCoverage(
  successfulRuns: readonly SyncedInterval[],
  currentWindow: PeriodWindow,
  previousWindow: PeriodWindow,
): PerSourceCoverage {
  if (successfulRuns.length === 0) {
    return {
      intervals: [],
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
      hasAnySuccess: false,
    };
  }
  const merged = mergeIntervals(successfulRuns);
  return {
    intervals: merged,
    selectedPeriodComplete: isFullyCovered(merged, currentWindow),
    comparisonPeriodComplete: isFullyCovered(merged, previousWindow),
    hasAnySuccess: true,
  };
}

/**
 * Cobertura CONSOLIDADA (Checkpoint 3, "Cobertura"): considera SOMENTE as
 * fontes passadas em `perSource` — o chamador já deve ter restringido essa
 * lista às fontes INCLUÍDAS no agregado atual (nunca inclui Amazon/Shopee
 * não conectados, por exemplo — eles simplesmente não geram uma entrada
 * aqui, então nunca "puxam" o status para `partial`).
 *
 * - `unknown`: nenhuma fonte incluída tem qualquer sincronização bem
 *   sucedida.
 * - `complete`: TODAS as fontes incluídas cobrem inteiramente os dois
 *   períodos.
 * - `partial`: existe dado real em pelo menos uma fonte, mas pelo menos uma
 *   fonte incluída não cobre tudo (inclusive uma fonte `CONNECTED_NO_DATA`
 *   incluída, que nunca cobre nada).
 */
export function computeConsolidatedCoverage(
  perSource: readonly PerSourceCoverage[],
): ConsolidatedCoverage {
  const withSuccess = perSource.filter((source) => source.hasAnySuccess);
  if (withSuccess.length === 0) {
    return {
      status: 'unknown',
      intervals: [],
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
    };
  }

  const merged = mergeIntervals(
    perSource.flatMap((source) => source.intervals),
  );
  const selectedPeriodComplete = perSource.every(
    (source) => source.selectedPeriodComplete,
  );
  const comparisonPeriodComplete = perSource.every(
    (source) => source.comparisonPeriodComplete,
  );

  return {
    status:
      selectedPeriodComplete && comparisonPeriodComplete
        ? 'complete'
        : 'partial',
    intervals: merged,
    selectedPeriodComplete,
    comparisonPeriodComplete,
  };
}

export function intervalsToDto(
  intervals: readonly SyncedInterval[],
): SynchronizedIntervalDto[] {
  return intervals.map((interval) => ({
    from: utcInstantToSaoPauloDateString(interval.from),
    to: utcInstantToSaoPauloDateString(interval.to),
  }));
}
