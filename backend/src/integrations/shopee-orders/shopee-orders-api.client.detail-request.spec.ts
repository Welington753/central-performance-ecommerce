import { createHmac } from 'crypto';
import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
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
  VALID_ORDER_SN_LIST,
  validOrderDetailBody,
  validOrderDetailOrder,
} from './shopee-orders-api.client.test-helpers';

/**
 * Split por responsabilidade (mesmo padrão de `getOrderList`) - validação de
 * entrada e montagem da requisição de `getOrderDetail` (Checkpoint CP2K-2).
 * Outcomes de resposta ficam em `shopee-orders-api.client.detail-outcomes.spec.ts`;
 * host allowlist e vazamento em `shopee-orders-api.client.detail-security.spec.ts`.
 */
describe('ShopeeOrdersApiClient.getOrderDetail - configuracao ausente (configuration_error)', () => {
  it('returns configuration_error and never calls fetch when credentials are not configured', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(null),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'configuration_error',
      failureCode: 'SHOPEE_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a malformed partnerId coming from configuration, without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService({ ...VALID_CONFIG, partnerId: 'not-decimal' }),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'configuration_error',
      failureCode: 'SHOPEE_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - validacao de shopId/accessToken (invalid_request, sempre antes de qualquer fetch)', () => {
  it.each(['', '0', '-5', '12a34'])(
    'rejects an invalid shopId "%s" without calling fetch',
    async (invalidShopId) => {
      const fetchImpl = jest.fn();
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: invalidShopId,
        orderSnList: VALID_ORDER_SN_LIST,
      });

      expect(outcome).toEqual({
        kind: 'invalid_request',
        failureCode: 'INVALID_SHOP_ID',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty accessToken without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: '',
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_ACCESS_TOKEN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - validacao de orderSnList (invalid_request, sempre antes de qualquer fetch)', () => {
  it('rejects an empty orderSnList without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: [],
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_ORDER_SN_LIST_SIZE',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a list with 51 entries without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const orderSnList = Array.from(
      { length: 51 },
      (_, i) => `20121800${String(i).padStart(6, '0')}`,
    );
    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_ORDER_SN_LIST_SIZE',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a duplicated orderSn without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: ['2404098R48U37H', '2404098R48U37H'],
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'DUPLICATE_ORDER_SN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an invalid orderSn (external whitespace) without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: [' 2404098R48U37H'],
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_ORDER_SN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - requisicao: URL, assinatura, metodo, headers, lotes, relogio', () => {
  it('signs with signShopeeShopRequest using the official baseString order and calls the exact Sandbox URL', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderDetailBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const url = new URL(calledUrl);

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.sandbox.test-stable.shopee.sg');
    expect(url.pathname).toBe('/api/v2/order/get_order_detail');

    const expectedSign = createHmac('sha256', PARTNER_KEY)
      .update(
        `${PARTNER_ID}/api/v2/order/get_order_detail${FIXED_TIMESTAMP}${ACCESS_TOKEN}${SHOP_ID}`,
      )
      .digest('hex');
    expect(url.searchParams.get('sign')).toBe(expectedSign);
    expect(url.searchParams.get('partner_id')).toBe(PARTNER_ID);
    expect(url.searchParams.get('timestamp')).toBe(String(FIXED_TIMESTAMP));
    expect(url.searchParams.get('access_token')).toBe(ACCESS_TOKEN);
    expect(url.searchParams.get('shop_id')).toBe(SHOP_ID);
    expect(url.searchParams.get('order_sn_list')).toBe('2404098R48U37H');
    expect(url.searchParams.get('response_optional_fields')).toBe(
      'total_amount,item_list,fulfillment_flag',
    );

    expect(calledInit.method).toBe('GET');
    expect((calledInit.headers as Record<string, string>).Accept).toBe(
      'application/json',
    );
    expect(calledInit.body).toBeUndefined();
  });

  it('calls the exact Production Brazil URL for a PRODUCTION config', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderDetailBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService({ ...VALID_CONFIG, environment: 'PRODUCTION' }),
      fetchImpl,
      fixedClock,
    );

    await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.hostname).toBe('openplatform.shopee.com.br');
    expect(url.pathname).toBe('/api/v2/order/get_order_detail');
  });

  it('joins a 50-entry batch correctly with commas, no truncation', async () => {
    const orderSnList = Array.from(
      { length: 50 },
      (_, i) => `20121800${String(i).padStart(6, '0')}`,
    );
    const orders = orderSnList.map((order_sn) =>
      validOrderDetailOrder({ order_sn }),
    );
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderDetailBody({ orders })));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList,
    });

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('order_sn_list')).toBe(orderSnList.join(','));
    expect(outcome.kind).toBe('success');
  });
});
