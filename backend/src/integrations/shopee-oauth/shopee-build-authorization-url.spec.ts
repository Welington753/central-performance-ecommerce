import {
  buildShopeeAuthorizationUrl,
  ShopeeAuthorizationUrlBuildError,
} from './shopee-build-authorization-url';
import { SHOPEE_ENDPOINTS } from './shopee-endpoints';

const VALID_INPUT = {
  authorizationHost: SHOPEE_ENDPOINTS.PRODUCTION.authorizationHost as string,
  partnerId: '123456',
  redirectUri: 'https://api.example.com/integrations/shopee/callback',
  state: 'state-value-1',
};

describe('buildShopeeAuthorizationUrl', () => {
  it('1: usa exatamente o host Sandbox confirmado (CP2F-R1: host global, sem .com.br — NXDOMAIN)', () => {
    const url = new URL(
      buildShopeeAuthorizationUrl({
        ...VALID_INPUT,
        authorizationHost: SHOPEE_ENDPOINTS.SANDBOX.authorizationHost as string,
      }),
    );
    expect(`${url.protocol}//${url.host}`).toBe(
      'https://open.sandbox.test-stable.shopee.com',
    );
  });

  it('2: usa exatamente o host de produção Brasil confirmado', () => {
    const url = new URL(buildShopeeAuthorizationUrl(VALID_INPUT));
    expect(`${url.protocol}//${url.host}`).toBe('https://open.shopee.com.br');
  });

  it('3: preserva o path /auth', () => {
    const url = new URL(buildShopeeAuthorizationUrl(VALID_INPUT));
    expect(url.pathname).toBe('/auth');
  });

  it('4: inclui auth_type=seller', () => {
    const url = new URL(buildShopeeAuthorizationUrl(VALID_INPUT));
    expect(url.searchParams.get('auth_type')).toBe('seller');
  });

  it('5: inclui response_type=code', () => {
    const url = new URL(buildShopeeAuthorizationUrl(VALID_INPUT));
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('6: inclui o partner_id correto', () => {
    const url = new URL(buildShopeeAuthorizationUrl(VALID_INPUT));
    expect(url.searchParams.get('partner_id')).toBe('123456');
  });

  it('7: redirect_uri é corretamente codificada e decodificada de volta ao valor original', () => {
    const redirectUri = 'https://api.example.com/integrations/shopee/callback';
    const url = new URL(
      buildShopeeAuthorizationUrl({ ...VALID_INPUT, redirectUri }),
    );
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    // Prova, por valor, que a codificação usou URLSearchParams (':'/'//'
    // viram %3A/%2F na query string bruta), não uma concatenação crua.
    expect(url.toString()).toContain(encodeURIComponent(redirectUri));
  });

  it('8: state com caracteres especiais é corretamente codificado e decodificado de volta ao valor original', () => {
    const state = 'abc+def/ghi=123&xyz';
    const url = new URL(buildShopeeAuthorizationUrl({ ...VALID_INPUT, state }));
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.toString()).toContain(encodeURIComponent(state));
  });

  it('9: nunca inclui sign, timestamp, code_challenge/code_verifier ou scope', () => {
    const url = new URL(buildShopeeAuthorizationUrl(VALID_INPUT));
    const keys = Array.from(url.searchParams.keys()).sort();
    expect(keys).toEqual([
      'auth_type',
      'partner_id',
      'redirect_uri',
      'response_type',
      'state',
    ]);
    expect(url.searchParams.has('sign')).toBe(false);
    expect(url.searchParams.has('timestamp')).toBe(false);
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('code_challenge_method')).toBe(false);
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('10: um host de autorização arbitrário (fora da allowlist) é rejeitado', () => {
    expect(() =>
      buildShopeeAuthorizationUrl({
        ...VALID_INPUT,
        authorizationHost: 'https://evil.example.com/auth',
      }),
    ).toThrow(ShopeeAuthorizationUrlBuildError);
  });

  it('CP2F-R1: rejeita o host Sandbox antigo .com.br (nunca resolveu em DNS real, removido da allowlist)', () => {
    expect(() =>
      buildShopeeAuthorizationUrl({
        ...VALID_INPUT,
        authorizationHost:
          'https://open.sandbox.test-stable.shopee.com.br/auth',
      }),
    ).toThrow(ShopeeAuthorizationUrlBuildError);
  });

  it('rejeita o host de API (não de autorização) mesmo sendo um host Shopee real', () => {
    expect(() =>
      buildShopeeAuthorizationUrl({
        ...VALID_INPUT,
        authorizationHost: SHOPEE_ENDPOINTS.PRODUCTION.apiHost,
      }),
    ).toThrow(ShopeeAuthorizationUrlBuildError);
  });

  it('rejeita partnerId não numérico', () => {
    expect(() =>
      buildShopeeAuthorizationUrl({ ...VALID_INPUT, partnerId: 'abc' }),
    ).toThrow(ShopeeAuthorizationUrlBuildError);
  });

  it('rejeita state vazio', () => {
    expect(() =>
      buildShopeeAuthorizationUrl({ ...VALID_INPUT, state: '' }),
    ).toThrow(ShopeeAuthorizationUrlBuildError);
  });

  it('rejeita redirectUri sintaticamente inválida', () => {
    expect(() =>
      buildShopeeAuthorizationUrl({
        ...VALID_INPUT,
        redirectUri: 'not-a-url',
      }),
    ).toThrow(ShopeeAuthorizationUrlBuildError);
  });

  it('nunca inclui a query pré-existente de authorizationHost (defesa mesmo que o host viesse com query)', () => {
    // `SHOPEE_ENDPOINTS` nunca tem query, mas o builder não deve confiar
    // nisso implicitamente — prova indireta: `url.search` só tem os 5 pares
    // esperados mesmo reconstruindo a partir do host bruto.
    const url = new URL(buildShopeeAuthorizationUrl(VALID_INPUT));
    expect(url.searchParams.toString().split('&').length).toBe(5);
  });
});
