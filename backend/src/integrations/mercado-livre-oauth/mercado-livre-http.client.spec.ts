import { ConfigService } from '@nestjs/config';
import { MercadoLivreHttpClient } from './mercado-livre-http.client';

function makeConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    ML_CLIENT_ID: 'app-id',
    ML_CLIENT_SECRET: 'app-secret',
    ML_REDIRECT_URI:
      'https://api.example.com/integrations/mercado-livre/callback',
    ML_HTTP_TIMEOUT_MS: 50,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MercadoLivreHttpClient', () => {
  it('exchangeCode: returns success with the validated, camelCased token on a 200 with a valid body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: 'APP_USR-1',
        refresh_token: 'TG-1',
        expires_in: 10800,
        user_id: 42,
        token_type: 'bearer',
        scope: 'offline_access read',
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    const outcome = await client.exchangeCode({ code: 'c', codeVerifier: 'v' });

    expect(outcome).toEqual({
      kind: 'success',
      token: {
        accessToken: 'APP_USR-1',
        refreshToken: 'TG-1',
        expiresInSeconds: 10800,
        userId: 42,
        tokenType: 'bearer',
        scope: 'offline_access read',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('exchangeCode: maps a 4xx (e.g. invalid_grant) to definitive_error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'definitive_error',
      },
    );
  });

  it('exchangeCode: maps a 5xx to unknown_result', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'internal' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'unknown_result',
      },
    );
  });

  it('exchangeCode: maps a network/abort error to unknown_result, never retries', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'unknown_result',
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exchangeCode: maps a 200 with a structurally incomplete body to invalid_response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: 'x' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'invalid_response',
      },
    );
  });

  it('exchangeCode: maps a 200 response whose body is not even valid JSON to invalid_response — NOT unknown_result (structurally invalid is a different case from an ambiguous/timeout result)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response('this is not json at all', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'invalid_response',
      },
    );
  });

  it('exchangeCode: times out and resolves unknown_result when the request exceeds ML_HTTP_TIMEOUT_MS', async () => {
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    const outcome = await client.exchangeCode({ code: 'c', codeVerifier: 'v' });
    expect(outcome).toEqual({ kind: 'unknown_result' });
  });

  it('exchangeCode: quando fetch() resolve rápido (headers já chegaram) mas response.json() trava, ML_HTTP_TIMEOUT_MS ainda aborta a leitura do corpo, e o resultado é unknown_result', async () => {
    // Simula um corpo cuja leitura trava DEPOIS que os headers já
    // resolveram — a promise de `json()` só rejeita quando o AbortSignal do
    // timeout dispara, nunca por conta própria. Prova que o timeout
    // continua ativo durante `response.json()`, não só durante o `fetch()`
    // (item 7 da segunda revisão). Determinístico: a rejeição é amarrada ao
    // evento `abort` do próprio signal usado pelo cliente, não a uma espera
    // arbitrária — só depende do `ML_HTTP_TIMEOUT_MS=50` já configurado por
    // `makeConfigService()`.
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedSignal = options?.signal ?? undefined;
        const response = {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              capturedSignal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              );
            }),
        } as unknown as Response;
        return Promise.resolve(response);
      },
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    const outcome = await client.exchangeCode({ code: 'c', codeVerifier: 'v' });
    expect(outcome).toEqual({ kind: 'unknown_result' });
  });

  it('exchangeCode: maps a 400 invalid_client to client_configuration_error — NEVER definitive_error (a misconfigured client_id/client_secret is not a rejection of the code itself), so the callback can still report TOKEN_EXCHANGE_FAILED per design §6.2 step 7', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'client_configuration_error',
      },
    );
  });

  it('exchangeCode: maps a 408 to unknown_result, not definitive_error (the provider timed out, the code was never actually evaluated)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(408, { error: 'request_timeout' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'unknown_result',
      },
    );
  });

  it('exchangeCode: maps a 429 to unknown_result, not definitive_error (rate limited, not rejected)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'too_many_requests' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual(
      {
        kind: 'unknown_result',
      },
    );
  });

  it('refreshToken: sends grant_type=refresh_token and the refresh token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: 'APP_USR-2',
        refresh_token: 'TG-2',
        expires_in: 10800,
        user_id: 42,
        token_type: 'bearer',
        scope: 'offline_access read',
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    await client.refreshToken({ refreshToken: 'TG-old' });

    const [, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const sentBody = (options.body as URLSearchParams).toString();
    expect(sentBody).toContain('grant_type=refresh_token');
    expect(sentBody).toContain('refresh_token=TG-old');
  });

  it('refreshToken: maps a 400 invalid_grant to invalid_grant (the refresh token itself was rejected — the only confirmed case requiring reconnection)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'invalid_grant',
    });
  });

  it("refreshToken: maps a 400 invalid_client to invalid_client — a global app misconfiguration, never proof that this account's refresh token is invalid", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'invalid_client',
    });
  });

  it('refreshToken: maps an unrecognized 4xx error code to outcome_unknown, not temporary_failure (a complete response was received, its meaning is just unknown)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { error: 'unsupported_grant_type' }),
      );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'outcome_unknown',
    });
  });

  it('refreshToken: maps a 408 to temporary_failure with retryAfterMs null', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(408, { error: 'request_timeout' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'temporary_failure',
      retryAfterMs: null,
    });
  });

  it('refreshToken: maps a 429 to temporary_failure and parses a valid Retry-After header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'too_many_requests' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '30',
        },
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'temporary_failure',
      retryAfterMs: 30000,
    });
  });

  it('refreshToken: 429 without a valid Retry-After falls back to retryAfterMs null', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'too_many_requests' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'temporary_failure',
      retryAfterMs: null,
    });
  });

  it('refreshToken: maps a 500 to temporary_failure', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'internal' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'temporary_failure',
      retryAfterMs: null,
    });
  });

  it('refreshToken: maps a network/timeout error (no response at all) to temporary_failure — DNS/connection-refused/timeout-before-response', async () => {
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'temporary_failure',
      retryAfterMs: null,
    });
  });

  it('refreshToken: maps a 200 response with invalid JSON to outcome_unknown — malformed success body, never treated as a clean network failure', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response('this is not json at all', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'outcome_unknown',
    });
  });

  it('refreshToken: a connection interrupted while reading an already-received 200 body maps to outcome_unknown, not temporary_failure', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = jest.fn(
      (_url: RequestInfo | URL, options?: RequestInit) => {
        capturedSignal = options?.signal ?? undefined;
        const response = {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () =>
            new Promise((_resolve, reject) => {
              capturedSignal?.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              );
            }),
        } as unknown as Response;
        return Promise.resolve(response);
      },
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'outcome_unknown',
    });
  });

  it('fetchIdentity: returns success with the numeric id from /users/me', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: 42 }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.fetchIdentity('APP_USR-1')).toEqual({
      kind: 'success',
      externalUserId: 42,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/users/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer APP_USR-1' },
      }),
    );
  });

  it('fetchIdentity: returns failure on a non-OK response or a malformed body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(401, {}));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.fetchIdentity('bad-token')).toEqual({
      kind: 'failure',
    });
  });
});
