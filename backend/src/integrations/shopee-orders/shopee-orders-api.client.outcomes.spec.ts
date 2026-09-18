import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  jsonResponse,
  makeCredentialsService,
  SHOP_ID,
  textResponse,
  VALID_ORDER_LIST_INPUT,
  validOrderListBody,
} from './shopee-orders-api.client.test-helpers';

/**
 * Split por responsabilidade (mesmo padrão do CP2I-R1) - mapeamento de
 * outcomes: sucesso, rejeição do provedor, status HTTP, rede/parsing e a
 * garantia de nunca retentar automaticamente. Validação de entrada/montagem
 * da requisição fica em `shopee-orders-api.client.request.spec.ts`; host
 * allowlist e vazamento de segredos ficam em
 * `shopee-orders-api.client.security.spec.ts`.
 */
describe('ShopeeOrdersApiClient.getOrderList - sucesso', () => {
  it('returns success with sanitized fields on a minimal valid body (single order)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderListBody()));
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

    expect(outcome).toEqual({
      kind: 'success',
      result: {
        orders: [{ orderSn: '201218V2Y6E59M' }],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
  });

  it('returns success with an empty page (valid empty order_list)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderListBody({ response: { order_list: [] } })),
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

    expect(outcome).toEqual({
      kind: 'success',
      result: {
        orders: [],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
  });

  it('returns success with more=true and a valid next_cursor', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(
          200,
          validOrderListBody({ response: { more: true, next_cursor: '20' } }),
        ),
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

    expect(outcome).toEqual({
      kind: 'success',
      result: {
        orders: [{ orderSn: '201218V2Y6E59M' }],
        more: true,
        nextCursor: '20',
        requestId: 'req-abc123',
      },
    });
  });
});

describe('ShopeeOrdersApiClient.getOrderList - rejeicao do provedor (error nao vazio)', () => {
  it('returns provider_rejected for a generic non-empty error, never the raw message', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'some_other_error',
        message: 'sensitive provider detail that must never leak',
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
  });

  it('returns provider_rejected for order.order_list_invalid_time', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'order.order_list_invalid_time',
        message: 'Start time must be earlier than end time and diff in 15days.',
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'provider_rejected' });
  });

  it('returns provider_rejected for error_shop', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'error_shop',
        message: 'shopid is invalid',
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'provider_rejected' });
  });
});

describe('ShopeeOrdersApiClient.getOrderList - status HTTP (4xx/429/5xx)', () => {
  it('returns provider_rejected on HTTP 400 with a non-empty error body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { error: 'error_param', message: 'bad request' }),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'provider_rejected' });
  });

  it('returns rate_limited with a valid Retry-After parsed to milliseconds on 429', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '30' }));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'rate_limited', retryAfterMs: 30000 });
  });

  it('returns rate_limited with retryAfterMs: null for an invalid Retry-After header', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(429, {}, { 'retry-after': 'not-a-number' }),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'rate_limited', retryAfterMs: null });
  });

  it.each([
    ['-5', 'valor negativo'],
    ['1.5', 'valor decimal'],
    ['99999999999999999999', 'valor enorme (acima de Number.MAX_SAFE_INTEGER)'],
    ['Wed, 21 Oct 2015 07:28:00 GMT', 'data HTTP em vez de segundos'],
  ] as const)(
    'never trusts a malformed Retry-After header blindly - %s (%s) -> retryAfterMs: null',
    async (headerValue, _description) => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(
          jsonResponse(429, {}, { 'retry-after': headerValue }),
        );
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.getOrderList({
          accessToken: ACCESS_TOKEN,
          shopId: SHOP_ID,
          ...VALID_ORDER_LIST_INPUT,
        }),
      ).toMatchObject({ kind: 'rate_limited', retryAfterMs: null });
    },
  );

  it('returns rate_limited with retryAfterMs: null when the Retry-After header is absent', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(429, {}));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'rate_limited', retryAfterMs: null });
  });

  it.each([500, 503])(
    'returns temporary_failure on HTTP %s (idempotent GET, safe to retry manually later)',
    async (status) => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(status, {}));
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.getOrderList({
          accessToken: ACCESS_TOKEN,
          shopId: SHOP_ID,
          ...VALID_ORDER_LIST_INPUT,
        }),
      ).toMatchObject({ kind: 'temporary_failure' });
    },
  );
});

describe('ShopeeOrdersApiClient.getOrderList - rede, timeout, JSON e resposta grande', () => {
  it('returns unknown_result for a generic fetch rejection, never claiming the request was not received', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'unknown_result' });
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
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService({
        partnerId: '1000000',
        partnerKey: 'super-secret-partner-key-never-logged',
        redirectUri: 'https://api.example.com/integrations/shopee/callback',
        environment: 'SANDBOX',
        apiHost: 'https://openplatform.sandbox.test-stable.shopee.sg',
        httpTimeoutMs: 10,
        tokenRefreshSkewSeconds: 600,
      }),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'unknown_result' });
  });

  it('returns invalid_response for a non-JSON body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(200, 'not-json{{'));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a genuinely empty (zero-byte) response body, never crashing', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(textResponse(200, ''));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a genuinely empty body even with Content-Length: 0 declared', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(200, '', { 'content-length': '0' }));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a response body above the size limit, without parsing it', async () => {
    // Corpo grande, mas sintaticamente válido (muitas orders válidas) - prova
    // que o teto de tamanho (`readLimitedResponseText`) rejeita ANTES do
    // `JSON.parse`, não por causa de alguma regra de validação de campo.
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

    const outcome = await client.getOrderList({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      ...VALID_ORDER_LIST_INPUT,
    });

    expect(outcome).toMatchObject({ kind: 'invalid_response' });
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

    expect(outcome).toMatchObject({ kind: 'invalid_response' });
    expect(textSpy).not.toHaveBeenCalled();
  });

  it('returns invalid_response for a structurally invalid envelope', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { foo: 'bar' }));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderList({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        ...VALID_ORDER_LIST_INPUT,
      }),
    ).toMatchObject({ kind: 'invalid_response' });
  });
});

describe('ShopeeOrdersApiClient.getOrderList - nunca retenta automaticamente', () => {
  it('never retries after any failure outcome - exactly one fetch call', async () => {
    const scenarios: Array<() => Response> = [
      () => jsonResponse(429, {}),
      () => jsonResponse(500, {}),
      () => jsonResponse(200, { error: 'error_param', message: '' }),
      () => textResponse(200, 'not-json'),
    ];

    for (const makeResponse of scenarios) {
      const fetchImpl = jest.fn().mockResolvedValue(makeResponse());
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
    }
  });
});
