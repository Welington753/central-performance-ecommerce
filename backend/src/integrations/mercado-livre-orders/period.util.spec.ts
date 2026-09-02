import {
  SAO_PAULO_TIME_ZONE,
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
});
