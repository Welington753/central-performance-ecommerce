import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  jsonResponse,
  makeCredentialsService,
  PARTNER_KEY,
  SHOP_ID,
  VALID_CONFIG,
  VALID_ORDER_LIST_INPUT,
  validOrderListBody,
} from './shopee-orders-api.client.test-helpers';

/**
 * Split por responsabilidade (mesmo padrão do CP2I-R1) - defesa estrutural
 * de host e ausência de vazamento sensível em logs/exceções. Reaproveita os
 * helpers compartilhados em vez de duplicá-los.
 */
describe('ShopeeOrdersApiClient - nenhuma chamada com host arbitrario (defesa estrutural)', () => {
  it.each(['SANDBOX', 'PRODUCTION'] as const)(
    'only ever calls fetch against one of the two officially allowlisted Shop API hosts for %s',
    async (environment) => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validOrderListBody()));
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService({ ...VALID_CONFIG, environment }),
        fetchImpl,
        fixedClock,
      );

      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
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

describe('ShopeeOrdersApiClient - nenhuma informacao sensivel em logs/excecoes', () => {
  it('never includes Partner Key, access_token, sign or the full URL in the outcome', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: 'super-secret-access-token',
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
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
      `request to https://openplatform.sandbox.test-stable.shopee.sg/api/v2/order/get_order_list?access_token=super-secret-access-token&sign=${'f'.repeat(64)}&partner_key=${PARTNER_KEY} failed`,
    );
    const fetchImpl = jest.fn().mockRejectedValue(leakyUrlError);
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: 'super-secret-access-token',
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toMatchObject({ kind: 'unknown_result' });
    expect(JSON.stringify(outcome)).not.toContain('super-secret-access-token');
    expect(JSON.stringify(outcome)).not.toContain(PARTNER_KEY);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('never logs to console on a malicious/oversized provider message, and never returns it', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const maliciousMessage = '<script>alert(1)</script>'.repeat(50);
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'error_server',
        message: maliciousMessage,
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toMatchObject({ kind: 'provider_rejected' });
    expect(JSON.stringify(outcome)).not.toContain('<script>');
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('never logs to console for a fake-credentials-bearing raw body, and never returns it', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: '',
        message: '',
        request_id: 'req-abc123',
        response: {
          more: false,
          next_cursor: '',
          order_list: [{ order_sn: '201218V2Y6E59M' }],
        },
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

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(JSON.stringify(outcome)).not.toContain('fake-leaked-access-token');
    expect(JSON.stringify(outcome)).not.toContain('fake-leaked-partner-key');
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('never logs to console for an oversized response', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const manyValidOrders = Array.from({ length: 5000 }, (_, i) => ({
      order_sn: `20121800${String(i).padStart(6, '0')}`,
    }));
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          200,
          validOrderListBody({ response: { order_list: manyValidOrders } }),
        ),
      );
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

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
