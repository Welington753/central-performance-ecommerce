import { ConflictException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { ShopeeConfig } from './shopee-config';
import { ShopeeCredentialsService } from './shopee-credentials.service';
import { ShopeeHttpClient } from './shopee-http.client';

const PARTNER_ID = '1000000';
const PARTNER_KEY = 'super-secret-partner-key-never-logged';
const FIXED_TIMESTAMP = 1700000000;

const VALID_CONFIG: ShopeeConfig = {
  partnerId: PARTNER_ID,
  partnerKey: PARTNER_KEY,
  redirectUri: 'https://api.example.com/integrations/shopee/callback',
  environment: 'SANDBOX',
  apiHost: 'https://openplatform.sandbox.test-stable.shopee.sg',
  httpTimeoutMs: 50,
  tokenRefreshSkewSeconds: 600,
};

function makeCredentialsService(
  config: ShopeeConfig | null = VALID_CONFIG,
): ShopeeCredentialsService {
  return {
    ensureCredentials: () => {
      if (config === null) throw new ConflictException('SHOPEE_NOT_CONFIGURED');
      return config;
    },
  } as unknown as ShopeeCredentialsService;
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function validTokenBody(overrides: Record<string, unknown> = {}) {
  return {
    error: '',
    access_token: 'access-token-example',
    refresh_token: 'refresh-token-example',
    expire_in: 14400,
    request_id: 'req-abc123',
    ...overrides,
  };
}

function fixedClock(): number {
  return FIXED_TIMESTAMP;
}

describe('ShopeeHttpClient', () => {
  describe('configuração ausente (configuration_error)', () => {
    it('returns configuration_error and never calls fetch when credentials are not configured', async () => {
      const fetchImpl = jest.fn();
      const client = new ShopeeHttpClient(
        makeCredentialsService(null),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.exchangeAuthorizationCode({
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('also applies to refreshAccessToken', async () => {
      const fetchImpl = jest.fn();
      const client = new ShopeeHttpClient(
        makeCredentialsService(null),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.refreshAccessToken({
        refreshToken: 'r',
        shopId: '1',
      });

      expect(outcome).toEqual({
        kind: 'configuration_error',
        failureCode: 'SHOPEE_NOT_CONFIGURED',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('validação de entrada (invalid_request, sempre antes de qualquer fetch)', () => {
    it.each(['', '0', '-5', '12a34', '01', '9999999999999999999'])(
      'rejects an invalid shopId "%s" without calling fetch',
      async (invalidShopId) => {
        const fetchImpl = jest.fn();
        const client = new ShopeeHttpClient(
          makeCredentialsService(),
          fetchImpl,
          fixedClock,
        );

        const outcome = await client.exchangeAuthorizationCode({
          code: 'c',
          shopId: invalidShopId,
        });

        expect(outcome).toEqual({
          kind: 'invalid_request',
          failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );

    it('rejects a shopId above Number.MAX_SAFE_INTEGER specifically', async () => {
      const fetchImpl = jest.fn();
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const tooLarge = String(Number.MAX_SAFE_INTEGER) + '123';
      const outcome = await client.exchangeAuthorizationCode({
        code: 'c',
        shopId: tooLarge,
      });

      expect(outcome).toEqual({
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects an empty code without calling fetch', async () => {
      const fetchImpl = jest.fn();
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.exchangeAuthorizationCode({
        code: '',
        shopId: '1',
      });

      expect(outcome).toEqual({
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects an empty refreshToken without calling fetch', async () => {
      const fetchImpl = jest.fn();
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.refreshAccessToken({
        refreshToken: '',
        shopId: '1',
      });

      expect(outcome).toEqual({
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects a malformed partnerId coming from configuration, without calling fetch', async () => {
      const fetchImpl = jest.fn();
      const client = new ShopeeHttpClient(
        makeCredentialsService({ ...VALID_CONFIG, partnerId: 'not-decimal' }),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.exchangeAuthorizationCode({
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({
        kind: 'invalid_request',
        failureCode: 'INVALID_AUTHORIZATION_RESPONSE',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('exchangeAuthorizationCode — rede e corpo', () => {
    it('sends the correct query (partner_id/timestamp/sign as strings) and a JSON body with numeric partner_id/shop_id', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validTokenBody()));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      await client.exchangeAuthorizationCode({
        code: 'auth-code-1',
        shopId: '200000',
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchImpl.mock.calls[0] as [
        string,
        RequestInit,
      ];
      const url = new URL(calledUrl);

      expect(url.hostname).toBe('openplatform.sandbox.test-stable.shopee.sg');
      expect(url.pathname).toBe('/api/v2/auth/token/get');
      expect(url.searchParams.get('partner_id')).toBe(PARTNER_ID);
      expect(url.searchParams.get('timestamp')).toBe(String(FIXED_TIMESTAMP));
      expect(url.searchParams.get('sign')).toMatch(/^[0-9a-f]{64}$/);

      expect(calledInit.method).toBe('POST');
      expect(
        (calledInit.headers as Record<string, string>)['Content-Type'],
      ).toBe('application/json');

      const body = JSON.parse(calledInit.body as string) as Record<
        string,
        unknown
      >;
      expect(body).toEqual({
        code: 'auth-code-1',
        shop_id: 200000,
        partner_id: Number(PARTNER_ID),
      });
      expect(typeof body.shop_id).toBe('number');
      expect(typeof body.partner_id).toBe('number');
    });

    it('never alters digits when converting shop_id/partner_id from string to number', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validTokenBody()));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      await client.exchangeAuthorizationCode({ code: 'c', shopId: '200000' });

      const [, calledInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(calledInit.body as string) as Record<
        string,
        unknown
      >;
      expect(String(body.shop_id)).toBe('200000');
      expect(String(body.partner_id)).toBe(PARTNER_ID);
    });

    it('computes sign as HMAC-SHA256(partner_id + api_path + timestamp, partner_key), using the string representation', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validTokenBody()));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      await client.exchangeAuthorizationCode({
        code: 'auth-code-1',
        shopId: '200000',
      });

      const expectedSign = createHmac('sha256', PARTNER_KEY)
        .update(`${PARTNER_ID}/api/v2/auth/token/get${FIXED_TIMESTAMP}`)
        .digest('hex');
      const [calledUrl] = fetchImpl.mock.calls[0] as [string];
      expect(new URL(calledUrl).searchParams.get('sign')).toBe(expectedSign);
    });

    it('returns success with the validated token on a well-formed 200', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validTokenBody()));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.exchangeAuthorizationCode({
        code: 'c',
        shopId: '1',
      });

      expect(outcome).toEqual({
        kind: 'success',
        token: {
          accessToken: 'access-token-example',
          refreshToken: 'refresh-token-example',
          expiresInSeconds: 14400,
          requestId: 'req-abc123',
        },
      });
    });

    it('returns provider_rejected when error is non-empty, never a raw provider message', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(
        jsonResponse(200, {
          error: 'error_auth',
          message: 'sensitive provider detail that must never leak',
        }),
      );
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.exchangeAuthorizationCode({ code: 'c', shopId: '1' }),
      ).toEqual({
        kind: 'provider_rejected',
      });
    });

    it('returns invalid_response when tokens are missing', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, { error: '', expire_in: 14400 }));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.exchangeAuthorizationCode({ code: 'c', shopId: '1' }),
      ).toEqual({
        kind: 'invalid_response',
      });
    });

    it('returns invalid_response for a non-JSON body (no abort involved)', async () => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.reject(new Error('not json')),
      });
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.exchangeAuthorizationCode({ code: 'c', shopId: '1' }),
      ).toEqual({
        kind: 'invalid_response',
      });
    });

    it('returns rate_limited with a valid Retry-After parsed to milliseconds', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '30' }));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.exchangeAuthorizationCode({ code: 'c', shopId: '1' }),
      ).toEqual({
        kind: 'rate_limited',
        retryAfterMs: 30000,
      });
    });

    it('returns rate_limited with retryAfterMs: null for an invalid Retry-After header', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(
          jsonResponse(429, {}, { 'retry-after': 'not-a-number' }),
        );
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.exchangeAuthorizationCode({ code: 'c', shopId: '1' }),
      ).toEqual({
        kind: 'rate_limited',
        retryAfterMs: null,
      });
    });

    it('returns unknown_result on HTTP 5xx', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, {}));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.exchangeAuthorizationCode({ code: 'c', shopId: '1' }),
      ).toEqual({
        kind: 'unknown_result',
      });
    });

    it.each([
      [
        'generic network error',
        () => Promise.reject(new Error('ECONNREFUSED')),
      ],
      ['DNS failure', () => Promise.reject(new Error('ENOTFOUND'))],
      ['TLS failure', () => Promise.reject(new Error('EPROTO'))],
      ['connection reset', () => Promise.reject(new Error('ECONNRESET'))],
      [
        'generic TypeError (how real fetch reports network failure)',
        () => Promise.reject(new TypeError('fetch failed')),
      ],
    ])(
      'returns unknown_result for any fetch rejection after dispatch (%s) — never claims the request was not received',
      async (_label, rejection) => {
        const fetchImpl = jest.fn().mockImplementation(rejection);
        const client = new ShopeeHttpClient(
          makeCredentialsService(),
          fetchImpl,
          fixedClock,
        );

        const outcome = await client.exchangeAuthorizationCode({
          code: 'c',
          shopId: '1',
        });
        expect(outcome).toEqual({ kind: 'unknown_result' });
      },
    );

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
      const client = new ShopeeHttpClient(
        makeCredentialsService({ ...VALID_CONFIG, httpTimeoutMs: 10 }),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.exchangeAuthorizationCode({
        code: 'c',
        shopId: '1',
      });
      expect(outcome).toEqual({ kind: 'unknown_result' });
    });

    it('never retries after any failure outcome — exactly one fetch call', async () => {
      const scenarios: Array<() => Response | Promise<Response>> = [
        () => jsonResponse(429, {}),
        () => jsonResponse(500, {}),
        () => jsonResponse(200, { error: 'error_auth' }),
        () => jsonResponse(200, {}),
      ];

      for (const makeResponse of scenarios) {
        const fetchImpl = jest.fn().mockResolvedValue(makeResponse());
        const client = new ShopeeHttpClient(
          makeCredentialsService(),
          fetchImpl,
          fixedClock,
        );
        await client.exchangeAuthorizationCode({ code: 'c', shopId: '1' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }

      const networkFailFetch = jest.fn().mockRejectedValue(new Error('down'));
      const clientNetworkFail = new ShopeeHttpClient(
        makeCredentialsService(),
        networkFailFetch,
        fixedClock,
      );
      await clientNetworkFail.exchangeAuthorizationCode({
        code: 'c',
        shopId: '1',
      });
      expect(networkFailFetch).toHaveBeenCalledTimes(1);
    });

    it('never includes the Partner Key, code, or any token in the outcome', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.exchangeAuthorizationCode({
        code: 'super-secret-code',
        shopId: '1',
      });

      const serialized = JSON.stringify(outcome);
      expect(serialized).not.toContain(PARTNER_KEY);
      expect(serialized).not.toContain('super-secret-code');
    });
  });

  describe('refreshAccessToken — rede e corpo', () => {
    it('sends the correct query and a JSON body with numeric partner_id/shop_id', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validTokenBody()));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      await client.refreshAccessToken({
        refreshToken: 'refresh-1',
        shopId: '300000',
      });

      const [calledUrl, calledInit] = fetchImpl.mock.calls[0] as [
        string,
        RequestInit,
      ];
      const url = new URL(calledUrl);

      expect(url.pathname).toBe('/api/v2/auth/access_token/get');
      expect(url.searchParams.get('partner_id')).toBe(PARTNER_ID);
      expect(url.searchParams.get('sign')).toMatch(/^[0-9a-f]{64}$/);

      const body = JSON.parse(calledInit.body as string) as Record<
        string,
        unknown
      >;
      expect(body).toEqual({
        refresh_token: 'refresh-1',
        shop_id: 300000,
        partner_id: Number(PARTNER_ID),
      });
      expect(typeof body.shop_id).toBe('number');
      expect(typeof body.partner_id).toBe('number');
    });

    it('computes a sign for the refresh path different from the token path sign at the same timestamp', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validTokenBody()));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      await client.refreshAccessToken({ refreshToken: 'r', shopId: '1' });

      const expectedSign = createHmac('sha256', PARTNER_KEY)
        .update(`${PARTNER_ID}/api/v2/auth/access_token/get${FIXED_TIMESTAMP}`)
        .digest('hex');
      const [calledUrl] = fetchImpl.mock.calls[0] as [string];
      expect(new URL(calledUrl).searchParams.get('sign')).toBe(expectedSign);
    });

    it('returns success with the validated token on a well-formed 200', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(200, validTokenBody()));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.refreshAccessToken({ refreshToken: 'r', shopId: '1' }),
      ).toEqual({
        kind: 'success',
        token: {
          accessToken: 'access-token-example',
          refreshToken: 'refresh-token-example',
          expiresInSeconds: 14400,
          requestId: 'req-abc123',
        },
      });
    });

    it('returns unknown_result for a fetch rejection, never claiming the request was not received', async () => {
      const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.refreshAccessToken({ refreshToken: 'r', shopId: '1' }),
      ).toEqual({
        kind: 'unknown_result',
      });
    });

    it('never retries after a failure — exactly one fetch call', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      await client.refreshAccessToken({ refreshToken: 'r', shopId: '1' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('never includes the refresh token or Partner Key in the outcome', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
      const client = new ShopeeHttpClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      const outcome = await client.refreshAccessToken({
        refreshToken: 'super-secret-refresh-token',
        shopId: '1',
      });

      const serialized = JSON.stringify(outcome);
      expect(serialized).not.toContain(PARTNER_KEY);
      expect(serialized).not.toContain('super-secret-refresh-token');
    });
  });
});
