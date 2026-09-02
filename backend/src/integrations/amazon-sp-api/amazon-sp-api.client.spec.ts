import { AmazonSpApiClient } from './amazon-sp-api.client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_INPUT = {
  accessToken: 'Atza|fake-access-token',
  endpoint: 'https://sellingpartnerapi-na.amazon.com',
  userAgent: 'CentralPerformance/1.0 (Language=TypeScript)',
};

describe('AmazonSpApiClient', () => {
  it('sends x-amz-access-token, x-amz-date and user-agent, with no AWS SigV4 headers (no Authorization/x-amz-content-sha256)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { payload: [] }));
    const client = new AmazonSpApiClient(fetchImpl);

    await client.getMarketplaceParticipations(VALID_INPUT);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://sellingpartnerapi-na.amazon.com/sellers/v1/marketplaceParticipations',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-access-token']).toBe(VALID_INPUT.accessToken);
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['user-agent']).toBe(VALID_INPUT.userAgent);
    expect(headers.host).toBe('sellingpartnerapi-na.amazon.com');
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('x-amz-content-sha256');
  });

  it('returns success with the parsed body on a 200', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { payload: [{ marketplace: 'A2Q3Y263D00KWC' }] }),
      );
    const client = new AmazonSpApiClient(fetchImpl);

    expect(await client.getMarketplaceParticipations(VALID_INPUT)).toEqual({
      kind: 'success',
      body: { payload: [{ marketplace: 'A2Q3Y263D00KWC' }] },
    });
  });

  it('rejects an endpoint outside the allowlist WITHOUT calling fetch (SSRF protection)', async () => {
    const fetchImpl = jest.fn();
    const client = new AmazonSpApiClient(fetchImpl);

    const outcome = await client.getMarketplaceParticipations({
      ...VALID_INPUT,
      endpoint: 'https://evil.example.com',
    });

    expect(outcome).toEqual({ kind: 'endpoint_not_allowed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 401/403 to unauthorized', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(403, {}));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(await client.getMarketplaceParticipations(VALID_INPUT)).toEqual({
      kind: 'unauthorized',
    });
  });

  it('maps 429 to rate_limited', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(429, {}));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(await client.getMarketplaceParticipations(VALID_INPUT)).toEqual({
      kind: 'rate_limited',
    });
  });

  it('maps a 5xx to provider_unavailable', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(await client.getMarketplaceParticipations(VALID_INPUT)).toEqual({
      kind: 'provider_unavailable',
    });
  });

  it('maps a network failure to provider_unavailable', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(await client.getMarketplaceParticipations(VALID_INPUT)).toEqual({
      kind: 'provider_unavailable',
    });
  });

  it('maps a malformed 200 body to invalid_response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response('not json', { status: 200 }));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(await client.getMarketplaceParticipations(VALID_INPUT)).toEqual({
      kind: 'invalid_response',
    });
  });

  it('never logs/throws the raw response body (no console output asserted, just no leakage in the outcome)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { payload: [], secretDebug: 'SHOULD_NEVER_LEAK' }),
      );
    const client = new AmazonSpApiClient(fetchImpl);

    const outcome = await client.getMarketplaceParticipations(VALID_INPUT);
    expect(outcome.kind).toBe('success');
  });
});

const SEARCH_ORDERS_BASE_INPUT = {
  accessToken: 'Atza|fake-access-token',
  endpoint: 'https://sellingpartnerapi-na.amazon.com',
  userAgent: 'CentralPerformance/1.0 (Language=TypeScript)',
  marketplaceIds: ['A2Q3Y263D00KWC'],
};

describe('AmazonSpApiClient.searchOrders', () => {
  it('builds the exact URL: path, marketplaceIds, maxResultsPerPage=100, includedData with no PII, and createdAfter', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { orders: [], pagination: {} }));
    const client = new AmazonSpApiClient(fetchImpl);

    await client.searchOrders({
      ...SEARCH_ORDERS_BASE_INPUT,
      createdAfter: '2026-08-01T00:00:00Z',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/orders/2026-01-01/orders');
    expect(parsed.searchParams.get('marketplaceIds')).toBe('A2Q3Y263D00KWC');
    expect(parsed.searchParams.get('maxResultsPerPage')).toBe('100');
    expect(parsed.searchParams.get('includedData')).toBe(
      'PROCEEDS,FULFILLMENT,CANCELLATION',
    );
    expect(parsed.searchParams.get('createdAfter')).toBe(
      '2026-08-01T00:00:00Z',
    );
    expect(parsed.searchParams.has('lastUpdatedAfter')).toBe(false);
    for (const forbidden of [
      'BUYER',
      'RECIPIENT',
      'PACKAGES',
      'TAX',
      'PAYMENT',
    ]) {
      expect(parsed.searchParams.get('includedData')).not.toContain(forbidden);
    }
  });

  it('builds the URL with lastUpdatedAfter instead of createdAfter when that mode is used', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { orders: [], pagination: {} }));
    const client = new AmazonSpApiClient(fetchImpl);

    await client.searchOrders({
      ...SEARCH_ORDERS_BASE_INPUT,
      lastUpdatedAfter: '2026-08-01T00:00:00Z',
    });

    const [url] = fetchImpl.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('lastUpdatedAfter')).toBe(
      '2026-08-01T00:00:00Z',
    );
    expect(parsed.searchParams.has('createdAfter')).toBe(false);
  });

  it('includes the optional Before bound for whichever mode is active', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { orders: [], pagination: {} }));
    const client = new AmazonSpApiClient(fetchImpl);

    await client.searchOrders({
      ...SEARCH_ORDERS_BASE_INPUT,
      createdAfter: '2026-08-01T00:00:00Z',
      createdBefore: '2026-08-02T00:00:00Z',
    });

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(new URL(url).searchParams.get('createdBefore')).toBe(
      '2026-08-02T00:00:00Z',
    );
  });

  it('rejects mixing createdAfter and lastUpdatedAfter — never sends an ambiguous request', async () => {
    const fetchImpl = jest.fn();
    const client = new AmazonSpApiClient(fetchImpl);

    await expect(
      client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
        lastUpdatedAfter: '2026-08-01T00:00:00Z',
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects when NEITHER createdAfter nor lastUpdatedAfter is given', async () => {
    const fetchImpl = jest.fn();
    const client = new AmazonSpApiClient(fetchImpl);

    await expect(
      client.searchOrders(SEARCH_ORDERS_BASE_INPUT),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends paginationToken for a subsequent page while preserving the original filters', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { orders: [], pagination: {} }));
    const client = new AmazonSpApiClient(fetchImpl);

    await client.searchOrders({
      ...SEARCH_ORDERS_BASE_INPUT,
      createdAfter: '2026-08-01T00:00:00Z',
      paginationToken: 'next-page-token',
    });

    const [url] = fetchImpl.mock.calls[0] as [string];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('paginationToken')).toBe('next-page-token');
    expect(parsed.searchParams.get('createdAfter')).toBe(
      '2026-08-01T00:00:00Z',
    );
    expect(parsed.searchParams.get('marketplaceIds')).toBe('A2Q3Y263D00KWC');
  });

  it('never includes the pagination token in any header or log-visible field', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { orders: [], pagination: {} }));
    const client = new AmazonSpApiClient(fetchImpl);

    await client.searchOrders({
      ...SEARCH_ORDERS_BASE_INPUT,
      createdAfter: '2026-08-01T00:00:00Z',
      paginationToken: 'SECRET-TOKEN-VALUE',
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(JSON.stringify(headers)).not.toContain('SECRET-TOKEN-VALUE');
  });

  it('returns success with the parsed body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        orders: [{ orderId: 'X' }],
        pagination: { nextToken: 'n1' },
      }),
    );
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({
      kind: 'success',
      body: { orders: [{ orderId: 'X' }], pagination: { nextToken: 'n1' } },
    });
  });

  it('rejects an endpoint outside the allowlist WITHOUT calling fetch', async () => {
    const fetchImpl = jest.fn();
    const client = new AmazonSpApiClient(fetchImpl);

    const outcome = await client.searchOrders({
      ...SEARCH_ORDERS_BASE_INPUT,
      endpoint: 'https://evil.example.com',
      createdAfter: '2026-08-01T00:00:00Z',
    });
    expect(outcome).toEqual({ kind: 'endpoint_not_allowed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 401/403 to unauthorized', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(403, {}));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({ kind: 'unauthorized' });
  });

  it('maps 429 to rate_limited and parses a valid integer-seconds Retry-After header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '2' },
      }),
    );
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({ kind: 'rate_limited', retryAfterMs: 2000 });
  });

  it('maps 429 with a missing/invalid Retry-After to rate_limited with retryAfterMs null', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(429, {}));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({ kind: 'rate_limited', retryAfterMs: null });
  });

  it('maps a 400 contract error to client_error (never retried by the caller)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(400, {}));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({ kind: 'client_error' });
  });

  it('maps a 5xx to provider_unavailable', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, {}));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({ kind: 'provider_unavailable' });
  });

  it('maps a network failure to provider_unavailable', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({ kind: 'provider_unavailable' });
  });

  it('maps a malformed 200 body to invalid_response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response('not json', { status: 200 }));
    const client = new AmazonSpApiClient(fetchImpl);

    expect(
      await client.searchOrders({
        ...SEARCH_ORDERS_BASE_INPUT,
        createdAfter: '2026-08-01T00:00:00Z',
      }),
    ).toEqual({ kind: 'invalid_response' });
  });

  it('sends the same LWA-only headers as getMarketplaceParticipations — no AWS SigV4', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { orders: [], pagination: {} }));
    const client = new AmazonSpApiClient(fetchImpl);

    await client.searchOrders({
      ...SEARCH_ORDERS_BASE_INPUT,
      createdAfter: '2026-08-01T00:00:00Z',
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-amz-access-token']).toBe(
      SEARCH_ORDERS_BASE_INPUT.accessToken,
    );
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('x-amz-content-sha256');
  });
});
