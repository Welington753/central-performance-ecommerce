import { passwordMeetsPolicy } from './password-policy';
import { generateTemporaryPassword } from './temporary-password.util';

describe('generateTemporaryPassword', () => {
  it('gera senha que já atende à política de senha do projeto', () => {
    const password = generateTemporaryPassword();
    expect(passwordMeetsPolicy(password)).toBe(true);
  });

  it('nunca usa Math.random (só crypto)', () => {
    const spy = jest.spyOn(Math, 'random');
    generateTemporaryPassword();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('gera valores diferentes a cada chamada (entropia mínima sanity check)', () => {
    const passwords = new Set(
      Array.from({ length: 20 }, () => generateTemporaryPassword()),
    );
    expect(passwords.size).toBe(20);
  });

  it('tem pelo menos 16 caracteres (entropia adequada)', () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(16);
  });
});
