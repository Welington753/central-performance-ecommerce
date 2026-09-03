import {
  BACKFILL_CHUNK_DAYS,
  SAO_PAULO_TIME_ZONE,
  computeBackfillChunkWindow,
  computeIncrementalSyncWindow,
  computeInitialSyncWindow,
  computeKpiWindows,
} from './period.util';

describe('period.util', () => {
  describe('computeInitialSyncWindow', () => {
    it('spans exactly the last 60 days ending at the reference instant', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      const window = computeInitialSyncWindow(now);

      expect(window.to.toISOString()).toBe('2026-09-01T12:00:00.000Z');
      expect(window.from.toISOString()).toBe('2026-07-03T12:00:00.000Z');
    });
  });

  describe('computeKpiWindows', () => {
    it('splits the last 60 days into two contiguous 30-day windows', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      const { current, previous } = computeKpiWindows(now);

      expect(current.to.toISOString()).toBe('2026-09-01T12:00:00.000Z');
      expect(current.from.toISOString()).toBe('2026-08-02T12:00:00.000Z');

      // O período anterior termina exatamente onde o atual começa — sem
      // sobreposição nem lacuna entre os dois.
      expect(previous.to.toISOString()).toBe(current.from.toISOString());
      expect(previous.from.toISOString()).toBe('2026-07-03T12:00:00.000Z');
    });
  });

  it('exposes a fixed America/Sao_Paulo time zone constant', () => {
    expect(SAO_PAULO_TIME_ZONE).toBe('America/Sao_Paulo');
  });

  describe('computeIncrementalSyncWindow', () => {
    it('falls back to the 60-day initial window when there is no prior coverage', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      const window = computeIncrementalSyncWindow([], now);
      expect(window).toEqual(computeInitialSyncWindow(now));
    });

    it('starts 1 day before the latest covered edge, ending now — never the full 60 days again', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      const priorIntervals = [
        {
          from: new Date('2026-07-01T00:00:00.000Z'),
          to: new Date('2026-08-31T12:00:00.000Z'),
        },
      ];
      const window = computeIncrementalSyncWindow(priorIntervals, now);

      expect(window.to.toISOString()).toBe('2026-09-01T12:00:00.000Z');
      expect(window.from.toISOString()).toBe('2026-08-30T12:00:00.000Z');
    });

    it('uses the latest `to` across multiple merged intervals', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      const priorIntervals = [
        {
          from: new Date('2026-01-01T00:00:00.000Z'),
          to: new Date('2026-02-01T00:00:00.000Z'),
        },
        {
          from: new Date('2026-08-01T00:00:00.000Z'),
          to: new Date('2026-08-31T12:00:00.000Z'),
        },
      ];
      const window = computeIncrementalSyncWindow(priorIntervals, now);
      expect(window.from.toISOString()).toBe('2026-08-30T12:00:00.000Z');
    });
  });

  describe('computeBackfillChunkWindow', () => {
    it('defaults to a 30-day chunk ending exactly at the oldest covered edge', () => {
      const oldestCoveredFrom = new Date('2026-07-01T00:00:00.000Z');
      const window = computeBackfillChunkWindow(oldestCoveredFrom);

      expect(BACKFILL_CHUNK_DAYS).toBe(30);
      expect(window.to.toISOString()).toBe(oldestCoveredFrom.toISOString());
      expect(window.from.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });

    it('never overlaps and never leaves a gap with what is already covered', () => {
      const oldestCoveredFrom = new Date('2026-07-01T00:00:00.000Z');
      const window = computeBackfillChunkWindow(oldestCoveredFrom, 10);
      expect(window.to.getTime()).toBe(oldestCoveredFrom.getTime());
    });
  });
});
