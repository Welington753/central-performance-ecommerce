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
 * maior data de pedido como prova de cobertura"). Genérico — usado tanto
 * pela cobertura legada do Mercado Livre (`mercado-livre-orders/
 * sync-coverage.util.ts`) quanto pela cobertura consolidada multi-marketplace
 * (`marketplace-analytics/consolidated-coverage.util.ts`).
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
  window: { from: Date; to: Date },
): boolean {
  return mergedIntervals.some(
    (interval) =>
      interval.from.getTime() <= window.from.getTime() &&
      interval.to.getTime() >= window.to.getTime(),
  );
}
