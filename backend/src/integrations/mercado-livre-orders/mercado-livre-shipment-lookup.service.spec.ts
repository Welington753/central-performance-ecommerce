import type { ConfigService } from '@nestjs/config';
import { classifyLogisticType } from './mercado-livre-logistics.util';
import { MercadoLivreShipmentLookupService } from './mercado-livre-shipment-lookup.service';

function buildLookup(
  fetchShipment: jest.Mock,
  configValues: Record<string, unknown> = {},
) {
  const sleep = jest.fn().mockResolvedValue(undefined);
  const configService = {
    get: (key: string, fallback?: unknown) => configValues[key] ?? fallback,
  } as unknown as ConfigService;
  const service = new MercadoLivreShipmentLookupService(
    { fetchShipment } as never,
    configService,
    sleep,
  );
  return { service, sleep };
}

describe('MercadoLivreShipmentLookupService.lookup', () => {
  it('recovers from a transient 429 — the retry succeeds and the order is classified', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'rate_limited', retryAfterMs: null })
      .mockResolvedValueOnce({ kind: 'success', logisticType: 'fulfillment' });
    const { service } = buildLookup(fetchShipment);

    const result = await service.lookup('token', 'ship-1');

    expect(fetchShipment).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.outcome).toEqual({
      kind: 'success',
      logisticType: 'fulfillment',
    });
    expect(classifyLogisticType('fulfillment')).toBe('MARKETPLACE_FULFILLED');
  });

  it('recovers from a transient provider outage', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'provider_unavailable' })
      .mockResolvedValueOnce({ kind: 'success', logisticType: 'drop_off' });
    const { service } = buildLookup(fetchShipment);

    const result = await service.lookup('token', 'ship-1');

    expect(result.attempts).toBe(2);
    expect(result.outcome).toEqual({
      kind: 'success',
      logisticType: 'drop_off',
    });
  });

  it('gives up after the configured attempts on a persistent 429 — never SELLER_FULFILLED', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: null });
    const { service } = buildLookup(fetchShipment);

    const result = await service.lookup('token', 'ship-1');

    expect(fetchShipment).toHaveBeenCalledTimes(3);
    expect(result.outcome.kind).toBe('rate_limited');
    // A falha sempre cai em UNKNOWN — jamais é interpretada como "sem Full".
    expect(classifyLogisticType(null)).toBe('UNKNOWN');
  });

  it('gives up after the configured attempts on a persistent timeout — never SELLER_FULFILLED', async () => {
    // Timeout de rede é mapeado pelo cliente para `provider_unavailable`.
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'provider_unavailable' });
    const { service } = buildLookup(fetchShipment);

    const result = await service.lookup('token', 'ship-1');

    expect(fetchShipment).toHaveBeenCalledTimes(3);
    expect(result.outcome.kind).toBe('provider_unavailable');
    expect(classifyLogisticType(null)).toBe('UNKNOWN');
  });

  it.each(['not_found', 'unauthorized', 'invalid_response'] as const)(
    'never retries a deterministic outcome (%s)',
    async (kind) => {
      const fetchShipment = jest.fn().mockResolvedValue({ kind });
      const { service, sleep } = buildLookup(fetchShipment);

      const result = await service.lookup('token', 'ship-1');

      expect(fetchShipment).toHaveBeenCalledTimes(1);
      expect(result.attempts).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it('never retries a success', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
    const { service, sleep } = buildLookup(fetchShipment);

    await service.lookup('token', 'ship-1');

    expect(fetchShipment).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honours Retry-After over its own backoff', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'rate_limited', retryAfterMs: 1234 })
      .mockResolvedValueOnce({ kind: 'success', logisticType: 'fulfillment' });
    const { service, sleep } = buildLookup(fetchShipment);

    await service.lookup('token', 'ship-1');

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1234);
  });

  it('uses an exponential backoff, capped, when no Retry-After is given', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'provider_unavailable' });
    const { service, sleep } = buildLookup(fetchShipment, {
      ML_SHIPMENT_MAX_ATTEMPTS: 4,
      ML_SHIPMENT_RETRY_BASE_DELAY_MS: 100,
      ML_SHIPMENT_RETRY_MAX_DELAY_MS: 250,
    });

    await service.lookup('token', 'ship-1');

    const delays = (sleep.mock.calls as Array<[number]>).map(
      ([delay]) => delay,
    );
    expect(delays).toEqual([100, 200, 250]);
  });

  it('caps a Retry-After larger than the configured maximum delay', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'rate_limited', retryAfterMs: 60000 })
      .mockResolvedValueOnce({ kind: 'success', logisticType: 'fulfillment' });
    const { service, sleep } = buildLookup(fetchShipment, {
      ML_SHIPMENT_RETRY_MAX_DELAY_MS: 2000,
    });

    await service.lookup('token', 'ship-1');

    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('never waits forever — an absurd attempt count is clamped to the hard cap', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'provider_unavailable' });
    const { service } = buildLookup(fetchShipment, {
      ML_SHIPMENT_MAX_ATTEMPTS: 10_000,
    });

    const result = await service.lookup('token', 'ship-1');

    expect(fetchShipment).toHaveBeenCalledTimes(6);
    expect(result.attempts).toBe(6);
  });

  it('falls back to the default attempt count when the configured value is invalid', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'provider_unavailable' });
    const { service } = buildLookup(fetchShipment, {
      ML_SHIPMENT_MAX_ATTEMPTS: 0,
    });

    await service.lookup('token', 'ship-1');

    expect(fetchShipment).toHaveBeenCalledTimes(3);
  });

  it('never leaks the access token into the outcome', async () => {
    const fetchShipment = jest
      .fn()
      .mockResolvedValue({ kind: 'success', logisticType: 'fulfillment' });
    const { service } = buildLookup(fetchShipment);

    const result = await service.lookup('secret-token-value', 'ship-1');

    expect(JSON.stringify(result)).not.toContain('secret-token-value');
  });
});
