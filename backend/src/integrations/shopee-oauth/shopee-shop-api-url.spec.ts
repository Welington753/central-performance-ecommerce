import {
  assertAllowedShopApiHost,
  buildShopeeShopInfoUrl,
  ShopeeShopApiUrlBuildError,
} from './shopee-shop-api-url';

const BASE_PARAMS = {
  partnerId: '1000000',
  timestampSeconds: 1700000000,
  accessToken: 'access-token-example',
  shopId: '200000',
  sign: 'a'.repeat(64),
};

describe('buildShopeeShopInfoUrl', () => {
  it('builds the exact Sandbox URL', () => {
    const url = buildShopeeShopInfoUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.sandbox.test-stable.shopee.sg');
    expect(url.pathname).toBe('/api/v2/shop/get_shop_info');
  });

  it('builds the exact Production Brazil URL', () => {
    const url = buildShopeeShopInfoUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.shopee.com.br');
    expect(url.pathname).toBe('/api/v2/shop/get_shop_info');
  });

  it('never falls back from Sandbox to Production or vice-versa', () => {
    const sandboxUrl = buildShopeeShopInfoUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });
    const productionUrl = buildShopeeShopInfoUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });

    expect(sandboxUrl.hostname).not.toBe(productionUrl.hostname);
  });

  it('sets exactly the five required query parameters, nothing more', () => {
    const url = buildShopeeShopInfoUrl({
      environment: 'SANDBOX',
      ...BASE_PARAMS,
    });

    const keys = [...url.searchParams.keys()].sort();
    expect(keys).toEqual(
      ['access_token', 'partner_id', 'shop_id', 'sign', 'timestamp'].sort(),
    );
    expect(url.searchParams.get('partner_id')).toBe(BASE_PARAMS.partnerId);
    expect(url.searchParams.get('timestamp')).toBe(
      String(BASE_PARAMS.timestampSeconds),
    );
    expect(url.searchParams.get('access_token')).toBe(BASE_PARAMS.accessToken);
    expect(url.searchParams.get('shop_id')).toBe(BASE_PARAMS.shopId);
    expect(url.searchParams.get('sign')).toBe(BASE_PARAMS.sign);
  });

  it('never leaves a shopApiHost query/fragment leaking into the built URL', () => {
    const url = buildShopeeShopInfoUrl({
      environment: 'PRODUCTION',
      ...BASE_PARAMS,
    });
    expect(url.hash).toBe('');
  });
});

describe('assertAllowedShopApiHost (defesa em profundidade contra host adulterado)', () => {
  function urlOf(value: string): URL {
    return new URL(value);
  }

  it.each([
    'https://openplatform.sandbox.test-stable.shopee.sg',
    'https://openplatform.shopee.com.br',
  ])('accepts an official Shop API host: %s', (host) => {
    expect(() => assertAllowedShopApiHost(urlOf(host))).not.toThrow();
  });

  it.each([
    // subdomínio parecido
    'https://evil.openplatform.shopee.com.br',
    // domínio pai encapsulando o host oficial como subdomínio
    'https://openplatform.shopee.com.br.evil.com',
    // protocolo errado
    'http://openplatform.shopee.com.br',
    // porta inesperada
    'https://openplatform.shopee.com.br:8443',
    // credenciais embutidas na URL
    'https://user:pass@openplatform.shopee.com.br',
    // path inesperado no próprio host
    'https://openplatform.shopee.com.br/extra',
    // fragmento
    'https://openplatform.shopee.com.br/#frag',
    // host totalmente arbitrário
    'https://attacker.example.com',
  ])('rejects a look-alike/adulterated host: %s', (badHost) => {
    expect(() => assertAllowedShopApiHost(urlOf(badHost))).toThrow(
      ShopeeShopApiUrlBuildError,
    );
  });
});
