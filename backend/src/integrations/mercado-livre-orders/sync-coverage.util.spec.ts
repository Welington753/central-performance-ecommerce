import { computeDataCoverage } from './sync-coverage.util';
import type { PeriodWindow } from '../marketplace-orders/period.util';

function window(from: string, to: string): PeriodWindow {
  return { from: new Date(from), to: new Date(to) };
}

// `mergeIntervals`/`isFullyCovered` são genéricos e foram extraídos para
// `marketplace-orders/coverage-interval.util.spec.ts` (Checkpoint 4-B,
// "Commit 1") — cobertos ali, não duplicados aqui.
describe('computeDataCoverage', () => {
  const current = window('2026-08-01T03:00:00Z', '2026-09-01T03:00:00Z');
  const previous = window('2026-07-02T03:00:00Z', '2026-08-01T03:00:00Z');

  it('returns "unknown" when there is no successful sync run', () => {
    const coverage = computeDataCoverage([], current, previous);
    expect(coverage).toEqual({
      status: 'unknown',
      synchronizedFrom: null,
      synchronizedTo: null,
      selectedPeriodComplete: false,
      comparisonPeriodComplete: false,
    });
  });

  it('returns "complete" when both windows are fully covered', () => {
    const coverage = computeDataCoverage(
      [
        {
          from: new Date('2026-07-01T00:00:00Z'),
          to: new Date('2026-09-02T00:00:00Z'),
        },
      ],
      current,
      previous,
    );
    expect(coverage.status).toBe('complete');
    expect(coverage.selectedPeriodComplete).toBe(true);
    expect(coverage.comparisonPeriodComplete).toBe(true);
    expect(coverage.synchronizedFrom).toBe('2026-06-30');
    expect(coverage.synchronizedTo).toBe('2026-09-01');
  });

  it('returns "partial" when only the current window is covered', () => {
    const coverage = computeDataCoverage(
      [
        {
          from: new Date('2026-08-01T03:00:00Z'),
          to: new Date('2026-09-01T03:00:00Z'),
        },
      ],
      current,
      previous,
    );
    expect(coverage.status).toBe('partial');
    expect(coverage.selectedPeriodComplete).toBe(true);
    expect(coverage.comparisonPeriodComplete).toBe(false);
  });

  it('never proves coverage just from min/max order dates — needs a run actually covering the gap', () => {
    // Duas execuções bem afastadas — a simples min/max daria a impressão de
    // cobertura total, mas há um buraco no meio que nenhuma delas cobre.
    const coverage = computeDataCoverage(
      [
        {
          from: new Date('2026-07-02T03:00:00Z'),
          to: new Date('2026-07-10T03:00:00Z'),
        },
        {
          from: new Date('2026-08-25T03:00:00Z'),
          to: new Date('2026-09-01T03:00:00Z'),
        },
      ],
      current,
      previous,
    );
    expect(coverage.status).toBe('partial');
    expect(coverage.selectedPeriodComplete).toBe(false);
    expect(coverage.comparisonPeriodComplete).toBe(false);
  });
});
