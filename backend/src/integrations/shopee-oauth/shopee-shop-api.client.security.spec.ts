import { ShopeeShopApiClient } from './shopee-shop-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  jsonResponse,
  makeCredentialsService,
  PARTNER_KEY,
  SHOP_ID,
  VALID_CONFIG,
  validShopInfoBody,
} from './shopee-shop-api.client.test-helpers';

/**
 * Split de `shopee-shop-api.client.spec.ts` (Checkpoint CP2I) — separação
 * por responsabilidade pedida quando um spec cresce demais: aqui só ficam os
 * testes de defesa estrutural de host e de ausência de vazamento sensível em
 * logs/exceções. Reaproveita os helpers exportados do spec principal em vez
 * de duplicá-los.
 */
describe('ShopeeShopApiClient — nenhuma chamada com host arbitrário (defesa estrutural)', () => {
  it.each(['SANDBOX', 'PRODUCTION'] as const)(
    'only ever calls fetch against one of the two officially allowlisted Shop API hosts for %s',
    async (environment) => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validShopInfoBody()));
      const client = new ShopeeShopApiClient(
        makeCredentialsService({ ...VALID_CONFIG, environment }),
        fetchImpl,
        fixedClock,
      );

      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID });

      const [calledUrl] = fetchImpl.mock.calls[0] as [string];
      const hostname = new URL(calledUrl).hostname;
      expect([
        'openplatform.sandbox.test-stable.shopee.sg',
        'openplatform.shopee.com.br',
      ]).toContain(hostname);
    },
  );
});

describe('ShopeeShopApiClient — nenhuma informação sensível em logs/exceções', () => {
  it('never includes Partner Key, access_token, sign or the full URL in the outcome', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: 'super-secret-access-token',
      shopId: SHOP_ID,
    });

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(PARTNER_KEY);
    expect(serialized).not.toContain('super-secret-access-token');
    expect(serialized).not.toContain('openplatform');
  });

  it('never logs to console, even when the fetch rejection error message embeds the full URL/token', async () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const consoleError = jest.spyOn(console, 'error').mockImplementation();

    const leakyUrlError = new Error(
      `request to https://openplatform.sandbox.test-stable.shopee.sg/api/v2/shop/get_shop_info?access_token=super-secret-access-token&sign=${'f'.repeat(64)} failed`,
    );
    const fetchImpl = jest.fn().mockRejectedValue(leakyUrlError);
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: 'super-secret-access-token',
      shopId: SHOP_ID,
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
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID });

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

    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validShopInfoBody({ message: 'x'.repeat(200_000) })),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID });

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});
