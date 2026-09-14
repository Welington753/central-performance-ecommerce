import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  jsonResponse,
  makeCredentialsService,
  PARTNER_KEY,
  SHOP_ID,
  VALID_CONFIG,
  VALID_ORDER_SN_LIST,
  validOrderDetailBody,
} from './shopee-orders-api.client.test-helpers';

/**
 * Split por responsabilidade (mesmo padrão de `getOrderList`) - defesa
 * estrutural de host e ausência de vazamento sensível de `getOrderDetail`
 * (Checkpoint CP2K-2).
 */
describe('ShopeeOrdersApiClient.getOrderDetail - nenhuma chamada com host arbitrario', () => {
  it.each(['SANDBOX', 'PRODUCTION'] as const)(
    'only ever calls fetch against one of the two officially allowlisted Shop API hosts for %s',
    async (environment) => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validOrderDetailBody()));
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService({ ...VALID_CONFIG, environment }),
        fetchImpl,
        fixedClock,
      );

      await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        orderSnList: VALID_ORDER_SN_LIST,
      });

      const [calledUrl] = fetchImpl.mock.calls[0] as [string];
      const hostname = new URL(calledUrl).hostname;
      expect([
        'openplatform.sandbox.test-stable.shopee.sg',
        'openplatform.shopee.com.br',
      ]).toContain(hostname);
    },
  );
});

describe('ShopeeOrdersApiClient.getOrderDetail - nunca solicita campo pessoal', () => {
  it('never sends a caller-controllable response_optional_fields, always the fixed closed constant', async () => {
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

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    const requestedFields = url.searchParams.get('response_optional_fields');
    expect(requestedFields).toBe('total_amount,item_list,fulfillment_flag');
    expect(requestedFields).not.toContain('buyer_user_id');
    expect(requestedFields).not.toContain('recipient_address');
    expect(requestedFields).not.toContain('buyer_cpf_id');
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - nenhuma informacao sensivel em logs/excecoes', () => {
  it('never includes Partner Key, access_token, sign or the full URL in the outcome', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: 'super-secret-access-token',
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(PARTNER_KEY);
    expect(serialized).not.toContain('super-secret-access-token');
    expect(serialized).not.toContain('openplatform');
  });

  it('never logs to console, even when the fetch rejection error message embeds the full URL/token/sign/Partner Key', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const leakyUrlError = new Error(
      `request to https://openplatform.sandbox.test-stable.shopee.sg/api/v2/order/get_order_detail?access_token=super-secret-access-token&sign=${'f'.repeat(64)}&partner_key=${PARTNER_KEY} failed`,
    );
    const fetchImpl = jest.fn().mockRejectedValue(leakyUrlError);
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: 'super-secret-access-token',
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({ kind: 'unknown_result' });
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('never logs to console on a malicious/oversized provider message', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'error_server',
        message: '<script>alert(1)</script>'.repeat(50),
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({ kind: 'provider_rejected' });
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('never leaks a raw body bearing fake credentials into the outcome', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        ...validOrderDetailBody(),
        access_token: 'fake-leaked-access-token',
        partner_key: 'fake-leaked-partner-key',
        sign: 'f'.repeat(64),
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('fake-leaked-access-token');
    expect(serialized).not.toContain('fake-leaked-partner-key');
  });
});
