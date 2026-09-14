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
  VALID_ORDER_LIST_INPUT,
  validOrderListBody,
} from './shopee-orders-api.client.test-helpers';

/**
 * Split por responsabilidade (mesmo padrão do CP2I-R1) - validação de
 * entrada (configuration_error/invalid_request) e montagem da requisição
 * (assinatura, URL, método, headers, relógio). Outcomes de resposta ficam em
 * `shopee-orders-api.client.outcomes.spec.ts`; host allowlist e vazamento de
 * segredos ficam em `shopee-orders-api.client.security.spec.ts`.
 */
describe('ShopeeOrdersApiClient.getOrderList - configuracao ausente (configuration_error)', () => {
  it('returns configuration_error and never calls fetch when credentials are not configured', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(null),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
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

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'configuration_error',
      failureCode: 'SHOPEE_NOT_CONFIGURED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeOrdersApiClient.getOrderList - validacao de shopId/accessToken (invalid_request, sempre antes de qualquer fetch)', () => {
  it.each(['', '0', '-5', '12a34', '01', ' 1', '1 ', '1.5', '1e2'])(
    'rejects an invalid shopId "%s" without calling fetch',
    async (invalidShopId) => {
      const fetchImpl = jest.fn();
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: invalidShopId,
        ...VALID_ORDER_LIST_INPUT,
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

    const outcome = await client.getOrderList({
      accessToken: '',
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_ACCESS_TOKEN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeOrdersApiClient.getOrderList - validacao dos parametros especificos (invalid_request, sempre antes de qualquer fetch)', () => {
  it('rejects an invalid time_range_field without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
      timeRangeField: 'created_time' as never,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_TIME_RANGE_FIELD',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects time_from >= time_to without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
      timeFrom: 1700003600,
      timeTo: 1700000000,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_TIME_RANGE_ORDER',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a time range spanning more than 15 days without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const timeFrom = 1700000000;
    const timeTo = timeFrom + 15 * 24 * 60 * 60 + 1;
    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
      timeFrom,
      timeTo,
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_TIME_RANGE_SPAN',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([0, 101, 1.5, NaN])(
    'rejects an invalid page_size %p without calling fetch',
    async (pageSize) => {
      const fetchImpl = jest.fn();
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
        pageSize,
      });

      expect(outcome).toEqual({
        kind: 'invalid_request',
        failureCode: 'INVALID_PAGE_SIZE',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid cursor without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
      cursor: '   ',
    });

    expect(outcome).toEqual({
      kind: 'invalid_request',
      failureCode: 'INVALID_CURSOR',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('ShopeeOrdersApiClient.getOrderList - requisicao: URL, assinatura, metodo, headers, parametros, relogio', () => {
  it('signs with signShopeeShopRequest using the official baseString order and calls the exact Sandbox URL', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderListBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const url = new URL(calledUrl);

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('openplatform.sandbox.test-stable.shopee.sg');
    expect(url.pathname).toBe('/api/v2/order/get_order_list');

    const expectedSign = createHmac('sha256', PARTNER_KEY)
      .update(
        `${PARTNER_ID}/api/v2/order/get_order_list${FIXED_TIMESTAMP}${ACCESS_TOKEN}${SHOP_ID}`,
      )
      .digest('hex');
    expect(url.searchParams.get('sign')).toBe(expectedSign);
    expect(/^[0-9a-f]{64}$/.test(url.searchParams.get('sign') as string)).toBe(
      true,
    );
    expect(url.searchParams.get('partner_id')).toBe(PARTNER_ID);
    expect(url.searchParams.get('timestamp')).toBe(String(FIXED_TIMESTAMP));
    expect(url.searchParams.get('access_token')).toBe(ACCESS_TOKEN);
    expect(url.searchParams.get('shop_id')).toBe(SHOP_ID);
    expect(url.searchParams.get('time_range_field')).toBe('create_time');
    expect(url.searchParams.get('time_from')).toBe('1700000000');
    expect(url.searchParams.get('time_to')).toBe('1700003600');
    expect(url.searchParams.get('page_size')).toBe('20');
    expect(url.searchParams.has('cursor')).toBe(false);

    expect(calledInit.method).toBe('GET');
    expect((calledInit.headers as Record<string, string>).Accept).toBe(
      'application/json',
    );
    expect(calledInit.body).toBeUndefined();
  });

  it('calls the exact Production Brazil URL for a PRODUCTION config', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderListBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService({ ...VALID_CONFIG, environment: 'PRODUCTION' }),
      fetchImpl,
      fixedClock,
    );

    await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.hostname).toBe('openplatform.shopee.com.br');
    expect(url.pathname).toBe('/api/v2/order/get_order_list');
  });

  it('includes cursor in the request URL, correctly encoded, when provided', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderListBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
      cursor: '20+extra/value=x&y',
    });

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('cursor')).toBe('20+extra/value=x&y');
  });
});
