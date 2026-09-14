import { ShopeeShopApiClient } from './shopee-shop-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  jsonResponse,
  makeCredentialsService,
  SHOP_ID,
  textResponse,
  VALID_CONFIG,
  validShopInfoBody,
} from './shopee-shop-api.client.test-helpers';

/**
 * Split de `shopee-shop-api.client.spec.ts` (Checkpoint CP2I-R1) — mapeamento
 * de outcomes: sucesso, rejeição do provedor, status HTTP, rede/parsing e a
 * garantia de nunca retentar automaticamente. Validação de entrada/montagem
 * da requisição fica em `shopee-shop-api.client.request.spec.ts`; host
 * allowlist e vazamento de segredos ficam em
 * `shopee-shop-api.client.security.spec.ts`.
 */
describe('ShopeeShopApiClient.getShopInfo — sucesso', () => {
  it('returns success with sanitized fields on a minimal valid body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validShopInfoBody()));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({
      kind: 'success',
      shopInfo: {
        shopName: 'Loja Exemplo',
        region: 'BR',
        status: 'NORMAL',
        authTime: 1699999000,
        expireTime: 1700100000,
        merchantId: null,
        requestId: 'req-abc123',
      },
    });
  });

  it('returns success even with unknown optional fields present in the body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          200,
          validShopInfoBody({ is_cb: true, is_sip: false, mart_shop_id: 5 }),
        ),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome.kind).toBe('success');
  });

  it.each(['NORMAL', 'BANNED', 'FROZEN'] as const)(
    'accepts documented status %s',
    async (status: 'NORMAL' | 'BANNED' | 'FROZEN') => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validShopInfoBody({ status })));
      const client = new ShopeeShopApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.getShopInfo({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
      });

      expect(outcome).toEqual({
        kind: 'success',
        shopInfo: {
          shopName: 'Loja Exemplo',
          region: 'BR',
          status,
          authTime: 1699999000,
          expireTime: 1700100000,
          merchantId: null,
          requestId: 'req-abc123',
        },
      });
    },
  );

  it('returns invalid_response for an undocumented/unknown status, never exposing it', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validShopInfoBody({ status: 'SOME_FUTURE_STATUS' })),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({ kind: 'invalid_response' });
    expect(JSON.stringify(outcome)).not.toContain('SOME_FUTURE_STATUS');
  });
});

describe('ShopeeShopApiClient.getShopInfo — rejeição do provedor (error não vazio)', () => {
  it('returns provider_rejected for a generic non-empty error, never the raw message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'some_other_error',
        message: 'sensitive provider detail that must never leak',
      }),
    );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({ kind: 'provider_rejected' });
  });

  it('returns provider_rejected for error_auth', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { error: 'error_auth', message: 'invalid token' }),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'provider_rejected' });
  });

  it('returns provider_rejected for error_shop', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { error: 'error_shop', message: 'shop banned' }),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'provider_rejected' });
  });
});

describe('ShopeeShopApiClient.getShopInfo — status HTTP (4xx/429/5xx)', () => {
  it('returns provider_rejected on HTTP 400 with a non-empty error body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { error: 'error_param', message: 'bad request' }),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'provider_rejected' });
  });

  it('returns provider_rejected on HTTP 401/403 with error_auth', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { error: 'error_auth', message: 'unauthorized' }),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'provider_rejected' });
  });

  it('returns rate_limited with a valid Retry-After parsed to milliseconds on 429', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '30' }));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'rate_limited', retryAfterMs: 30000 });
  });

  it('returns rate_limited with retryAfterMs: null for an invalid Retry-After header', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(429, {}, { 'retry-after': 'not-a-number' }),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'rate_limited', retryAfterMs: null });
  });

  it.each([500, 503])(
    'returns temporary_failure on HTTP %s (idempotent GET, safe to retry manually later)',
    async (status) => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(status, {}));
      const client = new ShopeeShopApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.getShopInfo({
          accessToken: ACCESS_TOKEN,
          shopId: SHOP_ID,
        }),
      ).toEqual({ kind: 'temporary_failure' });
    },
  );
});

describe('ShopeeShopApiClient.getShopInfo — rede, timeout, JSON e resposta grande', () => {
  it('returns unknown_result for a generic fetch rejection, never claiming the request was not received', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'unknown_result' });
  });

  it('returns unknown_result on a timeout (our own AbortController firing / AbortError)', async () => {
    const fetchImpl = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }),
    );
    const client = new ShopeeShopApiClient(
      makeCredentialsService({ ...VALID_CONFIG, httpTimeoutMs: 10 }),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'unknown_result' });
  });

  it('returns invalid_response for a non-JSON body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(200, 'not-json{{'));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a response body above the size limit, without parsing it', async () => {
    const hugeMessage = 'x'.repeat(200_000);
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validShopInfoBody({ message: hugeMessage })),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({ kind: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects upfront via a declared oversized Content-Length header, without reading the body', async () => {
    const textSpy = jest.fn().mockResolvedValue('{}');
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name === 'content-length' ? '99999999' : null),
      },
      text: textSpy,
    });
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getShopInfo({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
    });

    expect(outcome).toEqual({ kind: 'invalid_response' });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it('returns invalid_response for missing required fields', async () => {
    const body = validShopInfoBody();
    delete (body as Record<string, unknown>).shop_name;
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, body));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'invalid_response' });
  });

  it('returns invalid_response for incorrect field types', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validShopInfoBody({ auth_time: 'not-a-number' })),
      );
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a merchant_id that already lost int64 precision', async () => {
    const text = JSON.stringify(validShopInfoBody()).replace(
      '"merchant_id":null',
      '"merchant_id":9007199254740993',
    );
    const fetchImpl = jest.fn().mockResolvedValue(textResponse(200, text));
    const client = new ShopeeShopApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID }),
    ).toEqual({ kind: 'invalid_response' });
  });
});

describe('ShopeeShopApiClient.getShopInfo — nunca retenta automaticamente', () => {
  it('never retries after any failure outcome — exactly one fetch call', async () => {
    const scenarios: Array<() => Response> = [
      () => jsonResponse(429, {}),
      () => jsonResponse(500, {}),
      () => jsonResponse(200, { error: 'error_auth', message: '' }),
      () => textResponse(200, 'not-json'),
    ];

    for (const makeResponse of scenarios) {
      const fetchImpl = jest.fn().mockResolvedValue(makeResponse());
      const client = new ShopeeShopApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );
      await client.getShopInfo({ accessToken: ACCESS_TOKEN, shopId: SHOP_ID });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});
