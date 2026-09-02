import type { PeriodWindow } from './period.util';
import { isFullyCovered, mergeIntervals } from './coverage-interval.util';

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
