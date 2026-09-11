import { validateShopeeFrontendUrl } from './shopee-frontend-url.validator';

describe('validateShopeeFrontendUrl', () => {
  it('aceita HTTPS fora de development', () => {
    expect(
      validateShopeeFrontendUrl('https://app.example.com', 'production'),
    ).toBe(true);
  });

  it('rejeita HTTP fora de development', () => {
    expect(
      validateShopeeFrontendUrl('http://app.example.com', 'production'),
    ).toBe(false);
  });

  it('aceita HTTP em development', () => {
    expect(
      validateShopeeFrontendUrl('http://localhost:3001', 'development'),
    ).toBe(true);
  });

  it('aceita HTTPS em development', () => {
    expect(
      validateShopeeFrontendUrl('https://localhost:3001', 'development'),
    ).toBe(true);
  });

  it('rejeita username/password embutidos', () => {
    expect(
      validateShopeeFrontendUrl(
        'https://user:pass@app.example.com',
        'production',
      ),
    ).toBe(false);
  });

  it('rejeita URL sintaticamente inválida', () => {
    expect(validateShopeeFrontendUrl('not-a-url', 'production')).toBe(false);
  });

  it('rejeita protocolo diferente de http/https mesmo em development', () => {
    expect(
      validateShopeeFrontendUrl('ftp://app.example.com', 'development'),
    ).toBe(false);
  });
});
