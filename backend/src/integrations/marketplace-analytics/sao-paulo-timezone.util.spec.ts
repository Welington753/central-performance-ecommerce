import {
  daysInMonth,
  zonedDateOnly,
  zonedDateOnlyToUtcInstant,
} from './sao-paulo-timezone.util';

describe('zonedDateOnly / zonedDateOnlyToUtcInstant (America/Sao_Paulo)', () => {
  it('converts a UTC instant late in the day to the correct earlier local calendar day', () => {
    // 2026-09-01T02:00:00Z = 2026-08-31T23:00:00 em America/Sao_Paulo (-03:00)
    const result = zonedDateOnly(new Date('2026-09-01T02:00:00.000Z'));
    expect(result).toEqual({ year: 2026, month: 8, day: 31 });
  });

  it('round-trips midnight local time back to the expected UTC instant', () => {
    const instant = zonedDateOnlyToUtcInstant({ year: 2026, month: 9, day: 1 });
    expect(instant.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('round-trips across a year turnover (Dec 31 -> Jan 1)', () => {
    const instant = zonedDateOnlyToUtcInstant({ year: 2027, month: 1, day: 1 });
    expect(zonedDateOnly(instant)).toEqual({ year: 2027, month: 1, day: 1 });
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 4, 30],
    [2026, 2, 28], // 2026 não é bissexto
    [2028, 2, 29], // 2028 é bissexto
    [2026, 12, 31],
  ])('%s-%s has %s days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});
