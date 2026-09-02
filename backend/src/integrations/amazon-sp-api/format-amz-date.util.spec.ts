import { formatAmzDate } from './format-amz-date.util';

describe('formatAmzDate', () => {
  it('formats a UTC date as YYYYMMDDTHHMMSSZ', () => {
    const date = new Date('2026-09-02T10:15:30.123Z');
    expect(formatAmzDate(date)).toBe('20260902T101530Z');
  });

  it('pads single-digit month/day/hour/minute/second correctly', () => {
    const date = new Date('2026-01-05T03:07:09.000Z');
    expect(formatAmzDate(date)).toBe('20260105T030709Z');
  });

  it('always ends with a literal Z (UTC), never a raw millisecond suffix', () => {
    const formatted = formatAmzDate(new Date());
    expect(formatted).toMatch(/^\d{8}T\d{6}Z$/);
  });
});
