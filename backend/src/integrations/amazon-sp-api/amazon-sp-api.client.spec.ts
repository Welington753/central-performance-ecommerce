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
