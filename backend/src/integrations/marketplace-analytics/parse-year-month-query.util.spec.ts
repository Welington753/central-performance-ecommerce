import {
  YearMonthQueryError,
  parseYearMonthQuery,
} from './parse-year-month-query.util';

describe('parseYearMonthQuery', () => {
  it('parses valid year/month', () => {
    expect(parseYearMonthQuery('2026', '9')).toEqual({ year: 2026, month: 9 });
  });

  it('throws MISSING_PARAMETER when either is absent', () => {
    expect(() => parseYearMonthQuery(undefined, '9')).toThrow(
      YearMonthQueryError,
    );
    expect(() => parseYearMonthQuery('2026', undefined)).toThrow(
      YearMonthQueryError,
    );
    try {
      parseYearMonthQuery(undefined, undefined);
    } catch (error) {
      expect((error as YearMonthQueryError).code).toBe('MISSING_PARAMETER');
    }
  });

  it('rejects a non-numeric year/month', () => {
    expect(() => parseYearMonthQuery('abc', '9')).toThrow(YearMonthQueryError);
    expect(() => parseYearMonthQuery('2026', 'sep')).toThrow(
      YearMonthQueryError,
    );
  });

  it('rejects month out of [1,12]', () => {
    try {
      parseYearMonthQuery('2026', '0');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as YearMonthQueryError).code).toBe('INVALID_MONTH');
    }
    expect(() => parseYearMonthQuery('2026', '13')).toThrow(
      YearMonthQueryError,
    );
  });

  it('rejects year out of the documented range', () => {
    expect(() => parseYearMonthQuery('2019', '1')).toThrow(YearMonthQueryError);
    expect(() => parseYearMonthQuery('2101', '1')).toThrow(YearMonthQueryError);
  });
});
