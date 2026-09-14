import { createHmac } from 'crypto';
import { ShopeeShopApiClient } from './shopee-shop-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  FIXED_TIMESTAMP,
  jsonResponse,
  makeCredentialsService,
  PARTNER_ID,
  PARTNER_KEY,
  SHOP_ID,
  VALID_CONFIG,
  validShopInfoBody,
} from './shopee-shop-api.client.test-helpers';

/**
 * Split de `shopee-shop-api.client.spec.ts` (Checkpoint CP2I-R1) —
 * validação de entrada, montagem da requisição (assinatura, URL, método,
 * headers, relógio). Comportamento de outcomes de resposta fica em
 * `shopee-shop-api.client.outcomes.spec.ts`; host allowlist e vazamento de
 * segredos ficam em `shopee-shop-api.client.security.spec.ts`.
 */
describe('ShopeeShopApiClient.getShopInfo — configuração ausente (configuration_error)', () => {
  it('returns configuration_error and never calls fetch when credentials are not configured', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeShopApiClient(
      makeCredentialsService(null),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({
      kind: 'configuration_error',
      failureCode: 'SHOPEE_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeShopApiClient.getShopInfo — validação de entrada (invalid_request, sempre antes de qualquer fetch)', () => {
  it.each(['', '0', '-5', '12a34', '01', ' 1', '1 ', '1.5', '1e2'])(
    'rejects an invalid shopId "%s" without calling fetch',
    async (invalidShopId) => {
      const fetchImpl = jest.fn();
      const client = new ShopeeShopApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.getShopInfo({
        accessToken: ACCESS_TOKEN,
        shopId: invalidShopId,
      });

      expect(outcome).toEqual({
        kind: 'invalid_request',
        failureCode: 'INVALID_SHOP_ID',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('rejects a shopId above Number.MAX_SAFE_INTEGER specifically', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const tooLarge = String(Number.MAX_SAFE_INTEGER) + '123';
    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: tooLarge,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_SHOP_ID',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an empty accessToken without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: '',
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_ACCESS_TOKEN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeShopApiClient.getShopInfo — requisição: URL, assinatura, método, headers, parâmetros, relógio', () => {
  it('signs with signShopeeShopRequest using the official baseString order and calls the exact Sandbox URL', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validShopInfoBody()));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const url = new URL(calledUrl);

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.sandbox.test-stable.shopee.sg');
    expect(url.pathname).toBe('/api/v2/shop/get_shop_info');

    const expectedSign = createHmac('sha256', PARTNER_KEY)
      .update(
        `${PARTNER_ID}/api/v2/shop/get_shop_info${FIXED_TIMESTAMP}${ACCESS_TOKEN}${SHOP_ID}`,
      )
      .digest('hex');
    expect(url.searchParams.get('sign')).toBe(expectedSign);
    expect(url.searchParams.get('partner_id')).toBe(PARTNER_ID);
    expect(url.searchParams.get('timestamp')).toBe(String(FIXED_TIMESTAMP));
    expect(url.searchParams.get('access_token')).toBe(ACCESS_TOKEN);
    expect(url.searchParams.get('shop_id')).toBe(SHOP_ID);
    expect([...url.searchParams.keys()]).toHaveLength(5);

    expect(calledInit.method).toBe('GET');
    expect((calledInit.headers as Record<string, string>).Accept).toBe(
      'application/json',
    );
    expect(calledInit.body).toBeUndefined();
  });

  it('calls the exact Production Brazil URL for a PRODUCTION config', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validShopInfoBody()));
    const client = new ShopeeShopApiClient(
      makeCredentialsService({ ...VALID_CONFIG, environment: 'PRODUCTION' }),
      fetchImpl,
      fixedClock,
    );

    await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID });

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.hostname).toBe('openplatform.shopee.com.br');
    expect(url.pathname).toBe('/api/v2/shop/get_shop_info');
  });

  it('rejects a malformed partnerId coming from configuration, without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeShopApiClient(
      makeCredentialsService({ ...VALID_CONFIG, partnerId: 'not-decimal' }),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({
      kind: 'configuration_error',
      failureCode: 'SHOPEE_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
