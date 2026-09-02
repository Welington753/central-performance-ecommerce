import {
  computeConsolidatedCoverage,
  computeSourceCoverage,
  intervalsToDto,
} from './consolidated-coverage.util';
import type { PeriodWindow } from '../mercado-livre-orders/period.util';

function window(from: string, to: string): PeriodWindow {
  return { from: new Date(from), to: new Date(to) };
}

const current = window('2026-08-01T03:00:00Z', '2026-09-01T03:00:00Z');
const previous = window('2026-07-02T03:00:00Z', '2026-08-01T03:00:00Z');

describe('computeConsolidatedCoverage', () => {
  it('is "unknown" when no included source has ever synced (total absence of sources)', () => {
    const coverage = computeConsolidatedCoverage([]);
    expect(coverage.status).toBe('unknown');
    expect(coverage.intervals).toEqual([]);
  });

  it('is "unknown" when every included source has zero successful runs (e.g. only CONNECTED_NO_DATA sources)', () => {
    const neverSynced = computeSourceCoverage([], current, previous);
    const coverage = computeConsolidatedCoverage([neverSynced, neverSynced]);
    expect(coverage.status).toBe('unknown');
  });

  it('is "complete" when every included source fully covers both periods', () => {
    const sourceA = computeSourceCoverage(
      [
        {
          from: new Date('2026-07-01T00:00:00Z'),
          to: new Date('2026-09-02T00:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const sourceB = computeSourceCoverage(
      [
        {
          from: new Date('2026-06-01T00:00:00Z'),
          to: new Date('2026-09-05T00:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const coverage = computeConsolidatedCoverage([sourceA, sourceB]);
    expect(coverage.status).toBe('complete');
  });

  it('is "partial" when one included source (with data) does not fully cover the period', () => {
    const fullyCovered = computeSourceCoverage(
      [
        {
          from: new Date('2026-07-01T00:00:00Z'),
          to: new Date('2026-09-02T00:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const partiallyCovered = computeSourceCoverage(
      [
        {
          from: new Date('2026-08-15T00:00:00Z'),
          to: new Date('2026-09-02T00:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const coverage = computeConsolidatedCoverage([
      fullyCovered,
      partiallyCovered,
    ]);
    expect(coverage.status).toBe('partial');
  });

  it('is "partial" (never "complete") when a CONNECTED_NO_DATA source with zero syncs is included alongside real data', () => {
    const fullyCovered = computeSourceCoverage(
      [
        {
          from: new Date('2026-07-01T00:00:00Z'),
          to: new Date('2026-09-02T00:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const neverSynced = computeSourceCoverage([], current, previous);
    const coverage = computeConsolidatedCoverage([fullyCovered, neverSynced]);
    expect(coverage.status).toBe('partial');
  });

  it('preserves disjoint merged intervals across sources — never a single continuous range with a hidden gap', () => {
    const sourceA = computeSourceCoverage(
      [
        {
          from: new Date('2026-07-02T03:00:00Z'),
          to: new Date('2026-07-10T03:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const sourceB = computeSourceCoverage(
      [
        {
          from: new Date('2026-08-20T03:00:00Z'),
          to: new Date('2026-09-01T03:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const coverage = computeConsolidatedCoverage([sourceA, sourceB]);
    expect(intervalsToDto(coverage.intervals)).toEqual([
      { from: '2026-07-02', to: '2026-07-10' },
      { from: '2026-08-20', to: '2026-09-01' },
    ]);
  });

  it('excluding an unconnected marketplace from the source list never turns coverage partial because of it', () => {
    // Amazon/Shopee não conectados simplesmente não geram uma entrada em
    // `perSource` — só o Mercado Livre (coberto) é passado.
    const onlyMercadoLivre = computeSourceCoverage(
      [
        {
          from: new Date('2026-07-01T00:00:00Z'),
          to: new Date('2026-09-02T00:00:00Z'),
        },
      ],
      current,
      previous,
    );
    const coverage = computeConsolidatedCoverage([onlyMercadoLivre]);
    expect(coverage.status).toBe('complete');
  });
});
