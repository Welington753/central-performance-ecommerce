import { AmazonLwaClient } from './amazon-lwa.client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const INPUT = {
  refreshToken: 'Atzr|fake-refresh-token',
  clientId: 'amzn1.application-oa2-client.example',
  clientSecret: 'lwa-secret-example',
};

describe('AmazonLwaClient', () => {
  it('posts form-urlencoded grant_type=refresh_token to the LWA token endpoint with no AWS SigV4 headers', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: 'Atza|fake-access-token',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    );
    const client = new AmazonLwaClient(fetchImpl);

    await client.refreshAccessToken(INPUT);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.amazon.com/auth/o2/token');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(init.headers).not.toHaveProperty('Authorization');
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe(INPUT.refreshToken);
    expect(body.get('client_id')).toBe(INPUT.clientId);
    expect(body.get('client_secret')).toBe(INPUT.clientSecret);
  });

  it('returns success with a camelCased token on a valid 200', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: 'Atza|fake-access-token',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    );
    const client = new AmazonLwaClient(fetchImpl);

    expect(await client.refreshAccessToken(INPUT)).toEqual({
      kind: 'success',
      token: {
        accessToken: 'Atza|fake-access-token',
        tokenType: 'bearer',
        expiresInSeconds: 3600,
      },
    });
  });

  it('maps a malformed 200 body to invalid_response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: '' }));
    const client = new AmazonLwaClient(fetchImpl);

    expect(await client.refreshAccessToken(INPUT)).toEqual({
      kind: 'invalid_response',
    });
  });

  it('maps a 400 with error=invalid_grant to invalid_grant', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    const client = new AmazonLwaClient(fetchImpl);

    expect(await client.refreshAccessToken(INPUT)).toEqual({
      kind: 'invalid_grant',
    });
  });

  it('maps a 400 with error=invalid_client to client_configuration_error (never destroys the refresh token)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }));
    const client = new AmazonLwaClient(fetchImpl);

    expect(await client.refreshAccessToken(INPUT)).toEqual({
      kind: 'client_configuration_error',
    });
  });

  it('maps 429 to rate_limited', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'too_many_requests' }));
    const client = new AmazonLwaClient(fetchImpl);

    expect(await client.refreshAccessToken(INPUT)).toEqual({
      kind: 'rate_limited',
    });
  });

  it('maps 5xx to provider_unavailable', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(503, { error: 'internal' }));
    const client = new AmazonLwaClient(fetchImpl);

    expect(await client.refreshAccessToken(INPUT)).toEqual({
      kind: 'provider_unavailable',
    });
  });

  it('maps a network failure/timeout to unknown_result', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new AmazonLwaClient(fetchImpl);

    expect(await client.refreshAccessToken(INPUT)).toEqual({
      kind: 'unknown_result',
    });
  });

  it('never includes the raw response body or the refresh token in a thrown error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(400, {
        error: 'invalid_grant',
        error_description: 'SENSITIVE-RAW-BODY',
      }),
    );
    const client = new AmazonLwaClient(fetchImpl);

    const outcome = await client.refreshAccessToken(INPUT);
    expect(JSON.stringify(outcome)).not.toContain('SENSITIVE-RAW-BODY');
    expect(JSON.stringify(outcome)).not.toContain(INPUT.refreshToken);
  });
});
