import { PASSWORD_MIN_LENGTH, passwordMeetsPolicy } from './password-policy';

describe('passwordMeetsPolicy', () => {
  it(`rejeita senha com menos de ${PASSWORD_MIN_LENGTH} caracteres`, () => {
    expect(passwordMeetsPolicy('Ab1'.repeat(3))).toBe(false); // 9 chars
  });

  it('rejeita senha sem nenhuma letra', () => {
    expect(passwordMeetsPolicy('123456789012')).toBe(false);
  });

  it('rejeita senha sem nenhum dígito', () => {
    expect(passwordMeetsPolicy('AbcdefghijklQ')).toBe(false);
  });

  it('aceita senha com letra, dígito e comprimento suficiente', () => {
    expect(passwordMeetsPolicy('Abcdefgh1234')).toBe(true);
  });
});
