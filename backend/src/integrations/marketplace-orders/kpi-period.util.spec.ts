import {
  InvalidKpiPeriodError,
  dateOnlyToString,
  listDaysInWindow,
  resolveKpiPeriod,
  saoPauloDateOnly,
  utcInstantToSaoPauloDateString,
} from './period.util';

describe('resolveKpiPeriod', () => {
  it('defaults to the last 30 days (São Paulo), including today, when no parameter is sent', () => {
    // 2026-09-02T02:00:00Z ainda é 01/09 em São Paulo (UTC-3).
    const referenceNow = new Date('2026-09-02T02:00:00.000Z');
    const { current, previous } = resolveKpiPeriod({}, referenceNow);

    expect(dateOnlyToString(saoPauloDateOnly(current.from))).toBe('2026-08-03');
    // fim exclusivo == dia seguinte ao último dia incluído (01/09).
    expect(dateOnlyToString(saoPauloDateOnly(current.to))).toBe('2026-09-02');
    expect(listDaysInWindow(current)).toHaveLength(30);
    expect(listDaysInWindow(current)[29]).toBe('2026-09-01');

    expect(previous.to.getTime()).toBe(current.from.getTime());
    expect(listDaysInWindow(previous)).toHaveLength(30);
  });

  it('accepts valid from/to and computes an inclusive window with the day after `to` as the exclusive end', () => {
    const referenceNow = new Date('2026-09-02T12:00:00.000Z');
    const { current, previous } = resolveKpiPeriod(
      { from: '2026-08-01', to: '2026-08-31' },
      referenceNow,
    );

    expect(current.from.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(current.to.toISOString()).toBe('2026-09-01T03:00:00.000Z');
    expect(listDaysInWindow(current)).toHaveLength(31);

    // Período comparado: mesma quantidade de dias, terminando no dia
    // imediatamente anterior ao `from` (exemplo do plano: 01/08-31/08 vs
    // 01/07-31/07).
    expect(previous.to.toISOString()).toBe(current.from.toISOString());
    expect(dateOnlyToString(saoPauloDateOnly(previous.from))).toBe(
      '2026-07-01',
    );
    expect(listDaysInWindow(previous)).toHaveLength(31);
  });

  it('rejects when only `from` is sent', () => {
    expect(() =>
      resolveKpiPeriod({ from: '2026-08-01' }, new Date('2026-09-01')),
    ).toThrow(InvalidKpiPeriodError);
    try {
      resolveKpiPeriod({ from: '2026-08-01' }, new Date('2026-09-01'));
    } catch (error) {
      expect((error as InvalidKpiPeriodError).code).toBe('MISSING_PARAMETER');
    }
  });

  it('rejects when only `to` is sent', () => {
    expect(() =>
      resolveKpiPeriod({ to: '2026-08-01' }, new Date('2026-09-01')),
    ).toThrow(InvalidKpiPeriodError);
  });

  it.each(['2026/08/01', '01-08-2026', '2026-8-1', 'not-a-date', '2026-13-01'])(
    'rejects the invalid format %s',
    (invalid) => {
      try {
        resolveKpiPeriod(
          { from: invalid, to: '2026-08-31' },
          new Date('2026-09-01'),
        );
        fail('expected to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidKpiPeriodError);
        expect((error as InvalidKpiPeriodError).code).toBe(
          'INVALID_DATE_FORMAT',
        );
      }
    },
  );

  it('rejects a date that does not exist on the calendar (2026-02-30)', () => {
    try {
      resolveKpiPeriod(
        { from: '2026-02-30', to: '2026-03-01' },
        new Date('2026-09-01'),
      );
      fail('expected to throw');
    } catch (error) {
      expect((error as InvalidKpiPeriodError).code).toBe('INVALID_DATE_FORMAT');
    }
  });

  it('rejects from > to', () => {
    try {
      resolveKpiPeriod(
        { from: '2026-08-10', to: '2026-08-01' },
        new Date('2026-09-01'),
      );
      fail('expected to throw');
    } catch (error) {
      expect((error as InvalidKpiPeriodError).code).toBe('FROM_AFTER_TO');
    }
  });

  it('rejects a `to` date in the future (São Paulo)', () => {
    // "hoje" em SP é 2026-09-01; pedir até 2026-09-02 é o futuro.
    const referenceNow = new Date('2026-09-01T20:00:00.000Z');
    try {
      resolveKpiPeriod({ from: '2026-08-25', to: '2026-09-02' }, referenceNow);
      fail('expected to throw');
    } catch (error) {
      expect((error as InvalidKpiPeriodError).code).toBe('TO_IN_FUTURE');
    }
  });

  it('allows `to` equal to today (São Paulo) — not in the future', () => {
    const referenceNow = new Date('2026-09-01T20:00:00.000Z');
    expect(() =>
      resolveKpiPeriod({ from: '2026-08-25', to: '2026-09-01' }, referenceNow),
    ).not.toThrow();
  });

  it('rejects a range longer than 366 days', () => {
    try {
      resolveKpiPeriod(
        { from: '2025-01-01', to: '2026-01-02' },
        new Date('2026-09-01'),
      );
      fail('expected to throw');
    } catch (error) {
      expect((error as InvalidKpiPeriodError).code).toBe('RANGE_TOO_LONG');
    }
  });

  it('accepts exactly 366 days (leap year)', () => {
    expect(() =>
      resolveKpiPeriod(
        { from: '2025-01-01', to: '2026-01-01' },
        new Date('2026-09-01'),
      ),
    ).not.toThrow();
  });

  it('handles a single-day window (from === to) inclusively', () => {
    const { current } = resolveKpiPeriod(
      { from: '2026-08-15', to: '2026-08-15' },
      new Date('2026-09-01'),
    );
    expect(listDaysInWindow(current)).toEqual(['2026-08-15']);
  });

  it('handles a month rollover correctly (31/08 -> 01/09)', () => {
    const { current } = resolveKpiPeriod(
      { from: '2026-08-25', to: '2026-09-05' },
      new Date('2026-09-06'),
    );
    const days = listDaysInWindow(current);
    expect(days[0]).toBe('2026-08-25');
    expect(days[days.length - 1]).toBe('2026-09-05');
    expect(days).toContain('2026-08-31');
    expect(days).toContain('2026-09-01');
  });

  it('handles a year rollover correctly (31/12 -> 01/01)', () => {
    const { current } = resolveKpiPeriod(
      { from: '2025-12-28', to: '2026-01-03' },
      new Date('2026-09-01'),
    );
    const days = listDaysInWindow(current);
    expect(days).toContain('2025-12-31');
    expect(days).toContain('2026-01-01');
    expect(days).toHaveLength(7);
  });

  it('handles February in a leap year (2028-02-29 exists)', () => {
    const { current } = resolveKpiPeriod(
      { from: '2028-02-25', to: '2028-02-29' },
      new Date('2028-03-01'),
    );
    expect(listDaysInWindow(current)).toContain('2028-02-29');
  });
});

describe('listDaysInWindow', () => {
  it('lists every day in ascending order with none missing', () => {
    const { current } = resolveKpiPeriod(
      { from: '2026-08-01', to: '2026-08-05' },
      new Date('2026-09-01'),
    );
    expect(listDaysInWindow(current)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
  });
});

describe('utcInstantToSaoPauloDateString', () => {
  it('converts a UTC instant to its São Paulo calendar date', () => {
    expect(
      utcInstantToSaoPauloDateString(new Date('2026-08-01T03:00:00.000Z')),
    ).toBe('2026-08-01');
    // 02:59 UTC ainda é 31/07 em SP (UTC-3).
    expect(
      utcInstantToSaoPauloDateString(new Date('2026-08-01T02:59:00.000Z')),
    ).toBe('2026-07-31');
  });
});
