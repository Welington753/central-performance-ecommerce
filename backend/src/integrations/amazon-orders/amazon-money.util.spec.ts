import {
  isValidCurrencyCode,
  validateAmazonMoney,
  validateAmazonMoneyAmount,
} from './amazon-money.util';

describe('validateAmazonMoneyAmount', () => {
  it('accepts well-formed decimal strings', () => {
    expect(validateAmazonMoneyAmount('199.90')).toBe('199.90');
    expect(validateAmazonMoneyAmount('0.00')).toBe('0.00');
    expect(validateAmazonMoneyAmount('100')).toBe('100');
    expect(validateAmazonMoneyAmount('5.5')).toBe('5.5');
  });

  it('rejects a JSON number (never accepts a float type, even if finite)', () => {
    expect(validateAmazonMoneyAmount(199.9)).toBeNull();
  });

  it('rejects NaN and Infinity outright (never strings, always rejected by the type check)', () => {
    expect(validateAmazonMoneyAmount(NaN)).toBeNull();
    expect(validateAmazonMoneyAmount(Infinity)).toBeNull();
    expect(validateAmazonMoneyAmount(-Infinity)).toBeNull();
  });

  it('rejects a negative amount', () => {
    expect(validateAmazonMoneyAmount('-5.00')).toBeNull();
  });

  it('rejects more than two decimal places', () => {
    expect(validateAmazonMoneyAmount('5.999')).toBeNull();
  });

  it('rejects garbage strings', () => {
    expect(validateAmazonMoneyAmount('abc')).toBeNull();
    expect(validateAmazonMoneyAmount('')).toBeNull();
    expect(validateAmazonMoneyAmount('1e10')).toBeNull();
  });

  it('rejects null/undefined', () => {
    expect(validateAmazonMoneyAmount(null)).toBeNull();
    expect(validateAmazonMoneyAmount(undefined)).toBeNull();
  });
});

describe('isValidCurrencyCode', () => {
  it('accepts a 3-uppercase-letter code', () => {
    expect(isValidCurrencyCode('BRL')).toBe(true);
    expect(isValidCurrencyCode('USD')).toBe(true);
  });

  it('rejects lowercase, wrong length, or non-string', () => {
    expect(isValidCurrencyCode('brl')).toBe(false);
    expect(isValidCurrencyCode('BR')).toBe(false);
    expect(isValidCurrencyCode('BRLL')).toBe(false);
    expect(isValidCurrencyCode(123)).toBe(false);
    expect(isValidCurrencyCode(null)).toBe(false);
  });
});

describe('validateAmazonMoney', () => {
  it('accepts a well-formed Money object', () => {
    expect(
      validateAmazonMoney({ amount: '199.90', currencyCode: 'BRL' }),
    ).toEqual({
      amount: '199.90',
      currencyCode: 'BRL',
    });
  });

  it('rejects when amount is invalid, even with a valid currency', () => {
    expect(validateAmazonMoney({ amount: -5, currencyCode: 'BRL' })).toBeNull();
  });

  it('rejects when currency is invalid, even with a valid amount', () => {
    expect(
      validateAmazonMoney({ amount: '199.90', currencyCode: 'brl' }),
    ).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(validateAmazonMoney(null)).toBeNull();
    expect(validateAmazonMoney('199.90')).toBeNull();
  });
});
