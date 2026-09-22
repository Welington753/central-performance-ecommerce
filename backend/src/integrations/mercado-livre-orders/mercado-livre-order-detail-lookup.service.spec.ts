import type { ConfigService } from '@nestjs/config';
import { MercadoLivreOrderDetailLookupService } from './mercado-livre-order-detail-lookup.service';

/**
 * Mesma política de retry testada em
 * `mercado-livre-shipment-lookup.service.spec.ts` (reaproveitada
 * deliberadamente — ver comentário do serviço). Aqui só o suficiente para
 * provar que a política REALMENTE se aplica também ao fallback de
 * recuperação, não uma repetição de toda a suíte de retry.
 */
function buildLookup(
  fetchOrderShipmentId: jest.Mock,
  configValues: Record<string, unknown> = {},
) {
  const sleep = jest.fn().mockResolvedValue(undefined);
  const configService = {
    get: (key: string, fallback?: unknown) => configValues[key] ?? fallback,
  } as unknown as ConfigService;
  const service = new MercadoLivreOrderDetailLookupService(
    { fetchOrderShipmentId } as never,
    configService,
    sleep,
  );
  return { service, sleep };
}

describe('MercadoLivreOrderDetailLookupService.lookup', () => {
  it('recovers from a transient 429 — the retry succeeds', async () => {
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'rate_limited', retryAfterMs: null })
      .mockResolvedValueOnce({ kind: 'success', shipmentId: 'ship-1' });
    const { service } = buildLookup(fetchOrderShipmentId);

    const result = await service.lookup('token', 'order-1');

    expect(fetchOrderShipmentId).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.outcome).toEqual({ kind: 'success', shipmentId: 'ship-1' });
  });

  it('never retries 404 — deterministic, retrying only burns quota', async () => {
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'not_found' });
    const { service } = buildLookup(fetchOrderShipmentId);

    const result = await service.lookup('token', 'order-1');

    expect(fetchOrderShipmentId).toHaveBeenCalledTimes(1);
    expect(result.outcome).toEqual({ kind: 'not_found' });
  });

  it('never retries 401/403 — needs to abort the batch, not degrade it', async () => {
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'unauthorized' });
    const { service } = buildLookup(fetchOrderShipmentId);

    const result = await service.lookup('token', 'order-1');

    expect(fetchOrderShipmentId).toHaveBeenCalledTimes(1);
    expect(result.outcome).toEqual({ kind: 'unauthorized' });
  });

  it('gives up after the configured attempts on persistent rate limiting', async () => {
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: null });
    const { service, sleep } = buildLookup(fetchOrderShipmentId, {
      ML_SHIPMENT_MAX_ATTEMPTS: 3,
    });

    const result = await service.lookup('token', 'order-1');

    expect(fetchOrderShipmentId).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result.outcome).toEqual({
      kind: 'rate_limited',
      retryAfterMs: null,
    });
  });

  it('never waits more attempts than the absolute hard cap, regardless of configuration', async () => {
    const fetchOrderShipmentId = jest
      .fn()
      .mockResolvedValue({ kind: 'provider_unavailable' });
    const { service } = buildLookup(fetchOrderShipmentId, {
      ML_SHIPMENT_MAX_ATTEMPTS: 999,
    });

    const result = await service.lookup('token', 'order-1');

    expect(fetchOrderShipmentId).toHaveBeenCalledTimes(6);
    expect(result.attempts).toBe(6);
  });
});
