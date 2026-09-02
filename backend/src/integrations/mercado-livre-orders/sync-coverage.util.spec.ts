import {
  computeDataCoverage,
  isFullyCovered,
  mergeIntervals,
} from './sync-coverage.util';
import type { PeriodWindow } from './period.util';

function window(from: string, to: string): PeriodWindow {
  return { from: new Date(from), to: new Date(to) };
}

describe('mergeIntervals', () => {
  it('merges overlapping and adjacent intervals into one', () => {
    const merged = mergeIntervals([
      {
        from: new Date('2026-07-01T00:00:00Z'),
        to: new Date('2026-07-10T00:00:00Z'),
      },
      {
        from: new Date('2026-07-10T00:00:00Z'),
        to: new Date('2026-07-20T00:00:00Z'),
      },
      {
        from: new Date('2026-07-15T00:00:00Z'),
        to: new Date('2026-07-25T00:00:00Z'),
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(merged[0].to.toISOString()).toBe('2026-07-25T00:00:00.000Z');
  });

  it('keeps disjoint (non-adjacent) intervals separate', () => {
    const merged = mergeIntervals([
      {
        from: new Date('2026-07-01T00:00:00Z'),
        to: new Date('2026-07-10T00:00:00Z'),
      },
      {
        from: new Date('2026-08-01T00:00:00Z'),
        to: new Date('2026-08-10T00:00:00Z'),
      },
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe('isFullyCovered', () => {
  it('is true only when the window fits entirely inside one merged interval', () => {
    const merged = mergeIntervals([
      {
        from: new Date('2026-07-01T00:00:00Z'),
        to: new Date('2026-08-01T00:00:00Z'),
      },
    ]);
    expect(
      isFullyCovered(
        merged,
        window('2026-07-05T00:00:00Z', '2026-07-20T00:00:00Z'),
      ),
    ).toBe(true);
    expect(
      isFullyCovered(
        merged,
        window('2026-06-25T00:00:00Z', '2026-07-20T00:00:00Z'),
      ),
    ).toBe(false);
    expect(
      isFullyCovered(
        merged,
        window('2026-07-25T00:00:00Z', '2026-08-05T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('is false when the window spans a gap between two merged intervals', () => {
    const merged = mergeIntervals([
      {
        from: new Date('2026-07-01T00:00:00Z'),
        to: new Date('2026-07-10T00:00:00Z'),
      },
      {
        from: new Date('2026-07-20T00:00:00Z'),
        to: new Date('2026-07-30T00:00:00Z'),
      },
    ]);
    expect(
      isFullyCovered(
        merged,
        window('2026-07-05T00:00:00Z', '2026-07-25T00:00:00Z'),
      ),
    ).toBe(false);
  });
});

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
