import {
  centsToDecimalString,
  decimalStringToCents,
  divideCents,
} from './money.util';

describe('money.util', () => {
  describe('decimalStringToCents', () => {
    it('converts a numeric(14,2) string into integer cents', () => {
      expect(decimalStringToCents('123.45')).toBe(12345n);
      expect(decimalStringToCents('0.00')).toBe(0n);
      expect(decimalStringToCents('10')).toBe(1000n);
      expect(decimalStringToCents('-5.50')).toBe(-550n);
    });

    it('treats null/undefined as zero', () => {
      expect(decimalStringToCents(null)).toBe(0n);
      expect(decimalStringToCents(undefined)).toBe(0n);
    });
  });

  describe('centsToDecimalString', () => {
    it('formats integer cents back to a fixed 2-decimal string', () => {
      expect(centsToDecimalString(12345n)).toBe('123.45');
      expect(centsToDecimalString(0n)).toBe('0.00');
      expect(centsToDecimalString(5n)).toBe('0.05');
      expect(centsToDecimalString(-550n)).toBe('-5.50');
    });
  });

  describe('divideCents (ticket médio)', () => {
    it('divides gross revenue cents by an order count, rounded to the nearest cent', () => {
      expect(divideCents(10000n, 3n)).toBe('33.33');
      expect(divideCents(10001n, 3n)).toBe('33.34');
    });

    it('returns zero without an invalid division when the count is zero', () => {
      expect(divideCents(10000n, 0n)).toBe('0.00');
    });
  });
});
