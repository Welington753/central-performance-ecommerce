import {
  computeClosedDaysWindow,
  monthWindowExclusiveEnd,
  zonedDateOnly,
  zonedDateOnlyToUtcInstant,
} from './goal-pace.util';

describe('computeClosedDaysWindow', () => {
  it('first day of the current month: zero completed days, cutoff is the last day of the previous month', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 1,
    });
    const window = computeClosedDaysWindow(2026, 9, referenceNow);

    expect(window.monthKind).toBe('CURRENT');
    expect(window.daysCompleted).toBe(0);
    expect(window.cutoffDate).toBe('2026-08-31');
    expect(window.windowFromUtc.getTime()).toBe(
      window.windowToExclusiveUtc.getTime(),
    );
  });

  it('second day of the current month: exactly one completed day', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 2,
    });
    const window = computeClosedDaysWindow(2026, 9, referenceNow);

    expect(window.daysCompleted).toBe(1);
    expect(window.cutoffDate).toBe('2026-09-01');
  });

  it('last day of the current month: all days but today are completed', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 30,
    });
    const window = computeClosedDaysWindow(2026, 9, referenceNow);

    expect(window.daysInMonth).toBe(30);
    expect(window.daysCompleted).toBe(29);
    expect(window.cutoffDate).toBe('2026-09-29');
  });

  it('a past month: every day counts as completed', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 15,
    });
    const window = computeClosedDaysWindow(2026, 8, referenceNow);

    expect(window.monthKind).toBe('PAST');
    expect(window.daysCompleted).toBe(31);
    expect(window.cutoffDate).toBe('2026-08-31');
  });

  it('a future month: zero completed days, cutoff is the day before month start', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 15,
    });
    const window = computeClosedDaysWindow(2026, 12, referenceNow);

    expect(window.monthKind).toBe('FUTURE');
    expect(window.daysCompleted).toBe(0);
    expect(window.cutoffDate).toBe('2026-11-30');
  });

  it('the window end is exclusive — never includes today for the current month', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 10,
    });
    const window = computeClosedDaysWindow(2026, 9, referenceNow);
    // 9 dias completos (1..9); fim exclusivo = inicio do dia 10 (hoje).
    expect(window.windowToExclusiveUtc.toISOString()).toBe(
      zonedDateOnlyToUtcInstant({
        year: 2026,
        month: 9,
        day: 10,
      }).toISOString(),
    );
  });

  it('the window start is inclusive — day 1 at local midnight', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2026,
      month: 9,
      day: 10,
    });
    const window = computeClosedDaysWindow(2026, 9, referenceNow);
    expect(window.windowFromUtc.toISOString()).toBe(
      zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 1 }).toISOString(),
    );
  });

  it('handles a year turnover: December (past) relative to January (current)', () => {
    const referenceNow = zonedDateOnlyToUtcInstant({
      year: 2027,
      month: 1,
      day: 5,
    });
    const window = computeClosedDaysWindow(2026, 12, referenceNow);
    expect(window.monthKind).toBe('PAST');
    expect(window.daysCompleted).toBe(31);
  });

  it.each([28, 29, 30, 31])(
    'a fully-past month with %s days completes all of them',
    (expectedDays) => {
      const monthByDays: Record<number, [number, number, number]> = {
        28: [2026, 3, 2], // fev/2026 (28 dias), "hoje" = mar/2026
        29: [2028, 3, 2], // fev/2028 (29 dias, bissexto)
        30: [2026, 5, 2], // abr/2026 (30 dias)
        31: [2026, 2, 2], // jan/2026 (31 dias)
      };
      const [refYear, refMonth] = monthByDays[expectedDays];
      const targetMonth = refMonth === 1 ? 12 : refMonth - 1;
      const targetYear = refMonth === 1 ? refYear - 1 : refYear;
      const referenceNow = zonedDateOnlyToUtcInstant({
        year: refYear,
        month: refMonth,
        day: 2,
      });
      const window = computeClosedDaysWindow(
        targetYear,
        targetMonth,
        referenceNow,
      );
      expect(window.daysInMonth).toBe(expectedDays);
      expect(window.daysCompleted).toBe(expectedDays);
    },
  );
});

describe('monthWindowExclusiveEnd', () => {
  it('rolls over to January of the next year for December', () => {
    const end = monthWindowExclusiveEnd(2026, 12);
    expect(zonedDateOnly(end)).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it('is the first day of the next month otherwise', () => {
    const end = monthWindowExclusiveEnd(2026, 9);
    expect(zonedDateOnly(end)).toEqual({ year: 2026, month: 10, day: 1 });
  });
});
