import { ConfigService } from '@nestjs/config';
import { MercadoLivreShipmentClient } from './mercado-livre-shipment.client';

function configService(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    ML_HTTP_TIMEOUT_MS: 50,
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('MercadoLivreShipmentClient.fetchShipment', () => {
  it('calls GET on shipments/{id} with the access token only in the Authorization header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 999, logistic_type: 'fulfillment' }),
    });
    const client = new MercadoLivreShipmentClient(configService(), fetchImpl);

    const outcome = await client.fetchShipment('secret-token-value', '999');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('https://api.mercadolibre.com/shipments/999');
    expect(calledOptions.method).toBe('GET');
    expect(calledUrl).not.toContain('secret-token-value');
    expect(
      (calledOptions.headers as Record<string, string>).Authorization,
    ).toBe('Bearer secret-token-value');
    expect(outcome).toEqual({ kind: 'success', logisticType: 'fulfillment' });
  });

  it('maps HTTP 404 to "not_found"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });
    const client = new MercadoLivreShipmentClient(configService(), fetchImpl);

    expect(await client.fetchShipment('token', '1')).toEqual({
      kind: 'not_found',
    });
  });

  it('maps HTTP 429 to "rate_limited"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({}),
    });
    const client = new MercadoLivreShipmentClient(configService(), fetchImpl);

    expect(await client.fetchShipment('token', '1')).toEqual({
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
      const client = new MercadoLivreShipmentClient(configService(), fetchImpl);

      expect(await client.fetchShipment('token', '1')).toEqual({
        kind: 'provider_unavailable',
      });
    },
  );

  it('maps a network failure/timeout to "provider_unavailable"', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new MercadoLivreShipmentClient(configService(), fetchImpl);

    expect(await client.fetchShipment('token', '1')).toEqual({
      kind: 'provider_unavailable',
    });
  });

  it('maps a 200 response with a non-JSON body to "invalid_response"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('unexpected token')),
    });
    const client = new MercadoLivreShipmentClient(configService(), fetchImpl);

    expect(await client.fetchShipment('token', '1')).toEqual({
      kind: 'invalid_response',
    });
  });

  it('maps a 200 response failing the allowlist validation to "invalid_response"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ no_id_here: true }),
    });
    const client = new MercadoLivreShipmentClient(configService(), fetchImpl);

    expect(await client.fetchShipment('token', '1')).toEqual({
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
    const client = new MercadoLivreShipmentClient(
      configService({ ML_HTTP_TIMEOUT_MS: 20 }),
      fetchImpl as unknown as typeof fetch,
    );

    expect(await client.fetchShipment('token', '1')).toEqual({
      kind: 'provider_unavailable',
    });
  });
});
