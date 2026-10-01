import {
  monthlyCoverage,
  percentage,
  problemsPer100Orders,
  type MonthlyCoverageInput,
} from './marketplace-problems-monthly-coverage.util';

const D = (iso: string) => new Date(iso);
// Julho de 2026 em America/Sao_Paulo (UTC-3).
const JULY = {
  monthStart: D('2026-07-01T03:00:00.000Z'),
  monthEnd: D('2026-08-01T03:00:00.000Z'),
};
const covered = (from: string, through: string) => ({
  coveredFrom: D(from),
  coveredThrough: D(through),
});
const INSIDE = covered('2026-06-01T00:00:00Z', '2026-09-15T00:00:00Z');
const coverage = (
  overrides: Partial<MonthlyCoverageInput> = {},
): ReturnType<typeof monthlyCoverage> =>
  monthlyCoverage({
    ...JULY,
    coverage: INSIDE,
    quarantinedInMonth: 0,
    quarantinedUnknownDate: 0,
    ...overrides,
  });

describe('monthlyCoverage', () => {
  it('conta sem job: UNKNOWN (nada foi varrido)', () => {
    expect(coverage({ coverage: null })).toBe('UNKNOWN');
  });

  it('mês inteiro dentro do intervalo varrido e sem pendência: COMPLETE', () => {
    expect(coverage()).toBe('COMPLETE');
  });

  it('fronteiras exatas contam como dentro (início do mês = início da cobertura; fim do mês = cursor)', () => {
    expect(
      coverage({
        coverage: covered('2026-07-01T03:00:00Z', '2026-08-01T03:00:00Z'),
      }),
    ).toBe('COMPLETE');
  });

  it('cursor histórico no meio do mês: PARTIAL', () => {
    expect(
      coverage({
        coverage: covered('2026-07-10T00:00:00Z', '2026-09-15T00:00:00Z'),
      }),
    ).toBe('PARTIAL');
  });

  it('mês corrente (cursor incremental no meio do mês): PARTIAL', () => {
    expect(
      coverage({
        coverage: covered('2026-06-01T00:00:00Z', '2026-07-20T00:00:00Z'),
      }),
    ).toBe('PARTIAL');
  });

  it('mês inteiramente FORA do intervalo histórico (antes ou depois): PARTIAL', () => {
    expect(
      coverage({
        coverage: covered('2026-08-01T03:00:00Z', '2026-09-15T00:00:00Z'),
      }),
    ).toBe('PARTIAL');
    expect(
      coverage({
        coverage: covered('2026-05-01T00:00:00Z', '2026-07-01T03:00:00Z'),
      }),
    ).toBe('PARTIAL');
  });

  it('quarentena COM data neste mês: PARTIAL só dele; os demais meses seguem COMPLETE', () => {
    expect(coverage({ quarantinedInMonth: 1 })).toBe('PARTIAL');
    // Outro mês da mesma conta (agosto), sem pendência nele: continua COMPLETE.
    expect(
      monthlyCoverage({
        monthStart: D('2026-08-01T03:00:00Z'),
        monthEnd: D('2026-09-01T03:00:00Z'),
        coverage: INSIDE,
        quarantinedInMonth: 0,
        quarantinedUnknownDate: 0,
      }),
    ).toBe('COMPLETE');
  });

  it('quarentena resolvida deixa de afetar: volta a COMPLETE (nenhuma pendência no mês)', () => {
    expect(coverage({ quarantinedInMonth: 1 })).toBe('PARTIAL');
    expect(coverage({ quarantinedInMonth: 0 })).toBe('COMPLETE');
  });

  it('quarentena LEGADA sem data conhecida: UNKNOWN (indeterminada) nos meses que seriam completos', () => {
    expect(coverage({ quarantinedUnknownDate: 2 })).toBe('UNKNOWN');
  });

  it('precedência: mês fora do intervalo ou com pendência datada continua PARTIAL mesmo com legado sem data', () => {
    expect(
      coverage({
        coverage: covered('2026-07-10T00:00:00Z', '2026-09-15T00:00:00Z'),
        quarantinedUnknownDate: 1,
      }),
    ).toBe('PARTIAL');
    expect(coverage({ quarantinedInMonth: 1, quarantinedUnknownDate: 1 })).toBe(
      'PARTIAL',
    );
  });
});

describe('problemsPer100Orders', () => {
  it('problemas / pedidos * 100 com 2 casas', () => {
    expect(problemsPer100Orders(3, 8)).toBe(37.5);
    expect(problemsPer100Orders(3, 7)).toBe(42.86);
    expect(problemsPer100Orders(1, 3)).toBe(33.33);
    expect(problemsPer100Orders(0, 10)).toBe(0);
    expect(problemsPer100Orders(12, 10)).toBe(120);
  });

  it('nunca divide por zero (null sem pedidos)', () => {
    expect(problemsPer100Orders(5, 0)).toBeNull();
    expect(problemsPer100Orders(0, 0)).toBeNull();
  });
});

describe('percentage', () => {
  it('parte / total em percentual com 2 casas; null sem base', () => {
    expect(percentage(1, 3)).toBe(33.33);
    expect(percentage(2, 3)).toBe(66.67);
    expect(percentage(3, 3)).toBe(100);
    expect(percentage(0, 4)).toBe(0);
    expect(percentage(0, 0)).toBeNull();
  });
});
