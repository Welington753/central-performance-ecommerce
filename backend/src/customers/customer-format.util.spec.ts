import {
  isUsableValue,
  maskEmail,
  maskPhone,
  maskPostalCode,
  sanitizeSpreadsheetText,
} from './customer-format.util';

describe('customer-format.util', () => {
  it.each([
    ['maria.silva@gmail.com', 'ma***@gmail.com'],
    ['ab@x.com', 'a***@x.com'],
    ['sem-arroba', '***'],
    ['j***@shopee.com', 'j***@shopee.com'],
  ])('maskEmail(%s) → %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it.each([
    ['(11) 98765-4321', '*******4321'],
    ['123', '****'],
    ['******4321', '******4321'],
  ])('maskPhone(%s) → %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it('never exposes the full postal code when masked', () => {
    expect(maskPostalCode('01310-100')).toBe('01***-***');
  });

  it('keeps null as null (ausência nunca vira valor inventado)', () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskPhone(null)).toBeNull();
    expect(maskPostalCode(null)).toBeNull();
  });

  it('treats masked or null values as unavailable', () => {
    expect(isUsableValue('Maria')).toBe(true);
    expect(isUsableValue('M***a')).toBe(false);
    expect(isUsableValue(null)).toBe(false);
  });

  it.each([
    ['=HYPERLINK("http://x","clique")', `'=HYPERLINK("http://x","clique")`],
    ['+5511999990000', "'+5511999990000"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\t=1+1', "'\t=1+1"],
    ['Produto normal', 'Produto normal'],
  ])('sanitizeSpreadsheetText(%j)', (input, expected) => {
    expect(sanitizeSpreadsheetText(input)).toBe(expected);
  });
});
