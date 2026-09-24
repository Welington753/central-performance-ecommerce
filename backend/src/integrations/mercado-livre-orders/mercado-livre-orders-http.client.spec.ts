import { ConfigService } from '@nestjs/config';
import { MercadoLivreOrdersHttpClient } from './mercado-livre-orders-http.client';

function configService(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    ML_HTTP_TIMEOUT_MS: 50,
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function baseInput() {
  return {
    accessToken: 'secret-token-value',
    sellerId: '1548451374',
    dateFilter: 'CREATED' as const,
    dateFrom: new Date('2026-07-03T00:00:00.000Z'),
    dateTo: new Date('2026-09-01T00:00:00.000Z'),
    offset: 0,
    limit: 50,
  };
}

describe('MercadoLivreOrdersHttpClient.fetchOrdersPage', () => {
  it('calls GET on the orders/search endpoint with seller, period and pagination as query params', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          paging: { total: 0, offset: 0, limit: 50 },
          results: [],
        }),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    await client.fetchOrdersPage(baseInput());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledOptions.method).toBe('GET');
    const url = new URL(calledUrl);
    expect(url.origin + url.pathname).toBe(
      'https://api.mercadolibre.com/orders/search',
    );
    expect(url.searchParams.get('seller')).toBe('1548451374');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.get('limit')).toBe('50');
  });

  it('sends order.date_created.from/to when dateFilter is CREATED (backfill/histórico) — never order.date_last_updated', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          paging: { total: 0, offset: 0, limit: 50 },
          results: [],
        }),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    await client.fetchOrdersPage({ ...baseInput(), dateFilter: 'CREATED' });

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('order.date_created.from')).toBe(
      '2026-07-03T00:00:00.000Z',
    );
    expect(url.searchParams.get('order.date_created.to')).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    expect(url.searchParams.has('order.date_last_updated.from')).toBe(false);
    expect(url.searchParams.has('order.date_last_updated.to')).toBe(false);
  });

  it('sends order.date_last_updated.from/to when dateFilter is LAST_UPDATED (sincronização incremental, correção B1) — never order.date_created', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          paging: { total: 0, offset: 0, limit: 50 },
          results: [],
        }),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    await client.fetchOrdersPage({
      ...baseInput(),
      dateFilter: 'LAST_UPDATED',
    });

    const [calledUrl] = fetchImpl.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('order.date_last_updated.from')).toBe(
      '2026-07-03T00:00:00.000Z',
    );
    expect(url.searchParams.get('order.date_last_updated.to')).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    expect(url.searchParams.has('order.date_created.from')).toBe(false);
    expect(url.searchParams.has('order.date_created.to')).toBe(false);
  });

  it('sends the access token only via the Authorization header, never as a query param', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          paging: { total: 0, offset: 0, limit: 50 },
          results: [],
        }),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    await client.fetchOrdersPage(baseInput());

    const [calledUrl, calledOptions] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).not.toContain('secret-token-value');
    expect(
      (calledOptions.headers as Record<string, string>).Authorization,
    ).toBe('Bearer secret-token-value');
  });

  it('returns success with the parsed body on 200', async () => {
    const body = { paging: { total: 1, offset: 0, limit: 50 }, results: [] };
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    const outcome = await client.fetchOrdersPage(baseInput());
    expect(outcome).toEqual({ kind: 'success', body });
  });

  it.each([401, 403])('maps HTTP %i to "unauthorized"', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve({}),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    expect(await client.fetchOrdersPage(baseInput())).toEqual({
      kind: 'unauthorized',
    });
  });

  it('maps HTTP 429 to "rate_limited"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({}),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    expect(await client.fetchOrdersPage(baseInput())).toEqual({
      kind: 'rate_limited',
    });
  });

  it.each([500, 502, 503])(
    'maps HTTP %i to "provider_unavailable"',
    async (status) => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({}),
      });
      const client = new MercadoLivreOrdersHttpClient(
        configService(),
        fetchImpl,
      );

      expect(await client.fetchOrdersPage(baseInput())).toEqual({
        kind: 'provider_unavailable',
      });
    },
  );

  it('maps a network failure/timeout to "provider_unavailable"', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    expect(await client.fetchOrdersPage(baseInput())).toEqual({
      kind: 'provider_unavailable',
    });
  });

  it('maps a 200 response with a non-JSON body to "invalid_response"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('unexpected token')),
    });
    const client = new MercadoLivreOrdersHttpClient(configService(), fetchImpl);

    expect(await client.fetchOrdersPage(baseInput())).toEqual({
      kind: 'invalid_response',
    });
  });

  it('aborts and returns "provider_unavailable" when the request exceeds ML_HTTP_TIMEOUT_MS', async () => {
    const fetchImpl = jest.fn(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = options.signal as AbortSignal;
          signal.addEventListener('abort', () =>
            reject(new Error('The operation was aborted')),
          );
        }),
    );
    const client = new MercadoLivreOrdersHttpClient(
      configService({ ML_HTTP_TIMEOUT_MS: 20 }),
      fetchImpl as unknown as typeof fetch,
    );

    const outcome = await client.fetchOrdersPage(baseInput());
    expect(outcome).toEqual({ kind: 'provider_unavailable' });
  });
});
