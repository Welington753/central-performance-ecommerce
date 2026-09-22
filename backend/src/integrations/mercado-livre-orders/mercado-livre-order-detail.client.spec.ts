import { ConfigService } from '@nestjs/config';
import { MercadoLivreOrderDetailClient } from './mercado-livre-order-detail.client';

function configService(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    ML_HTTP_TIMEOUT_MS: 50,
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function validOrderBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 999,
    status: 'paid',
    currency_id: 'BRL',
    total_amount: 100,
    date_created: '2025-03-10T10:00:00.000-04:00',
    order_items: [],
    shipping: { id: 555 },
    ...overrides,
  };
}

describe('MercadoLivreOrderDetailClient.fetchOrderShipmentId (fallback de recuperação, revisão crítica)', () => {
  it('calls GET on orders/{id} with the access token only in the Authorization header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(validOrderBody()),
    });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    const outcome = await client.fetchOrderShipmentId('secret-token', '999');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('https://api.mercadolibre.com/orders/999');
    expect(calledOptions.method).toBe('GET');
    expect(calledUrl).not.toContain('secret-token');
    expect(
      (calledOptions.headers as Record<string, string>).Authorization,
    ).toBe('Bearer secret-token');
    expect(outcome).toEqual({ kind: 'success', shipmentId: '555' });
  });

  it('extracts null when the order has no shipping — never invents an id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(validOrderBody({ shipping: undefined })),
    });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    expect(await client.fetchOrderShipmentId('token', '999')).toEqual({
      kind: 'success',
      shipmentId: null,
    });
  });

  it('never confuses pack_id with the shipment id', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          validOrderBody({ pack_id: 'PACK-777', shipping: undefined }),
        ),
    });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    const outcome = await client.fetchOrderShipmentId('token', '999');

    expect(outcome).toEqual({ kind: 'success', shipmentId: null });
  });

  it('maps HTTP 404 to "not_found"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    expect(await client.fetchOrderShipmentId('token', '1')).toEqual({
      kind: 'not_found',
    });
  });

  it('maps HTTP 429 to "rate_limited" honouring Retry-After', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === 'retry-after' ? '2' : null) },
    });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    expect(await client.fetchOrderShipmentId('token', '1')).toEqual({
      kind: 'rate_limited',
      retryAfterMs: 2000,
    });
  });

  it.each([401, 403])('maps HTTP %s to "unauthorized"', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    expect(await client.fetchOrderShipmentId('token', '1')).toEqual({
      kind: 'unauthorized',
    });
  });

  it('maps a network failure to "provider_unavailable"', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    expect(await client.fetchOrderShipmentId('token', '1')).toEqual({
      kind: 'provider_unavailable',
    });
  });

  it('maps a malformed 200 body (fails the allowlist) to "invalid_response"', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 999 }), // faltam campos obrigatórios
    });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    expect(await client.fetchOrderShipmentId('token', '1')).toEqual({
      kind: 'invalid_response',
    });
  });

  it('never leaks the access token or the response body in the outcome', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(validOrderBody()),
    });
    const client = new MercadoLivreOrderDetailClient(
      configService(),
      fetchImpl,
    );

    const outcome = await client.fetchOrderShipmentId('secret-token', '999');

    expect(JSON.stringify(outcome)).not.toContain('secret-token');
    expect(JSON.stringify(outcome)).not.toContain('BRL');
  });
});
