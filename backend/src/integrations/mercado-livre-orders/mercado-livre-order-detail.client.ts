import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { validateOrderEntry } from './mercado-livre-order-response';

const ORDERS_ENDPOINT = 'https://api.mercadolibre.com/orders';

export type FetchOrderShipmentIdOutcome =
  | { kind: 'success'; shipmentId: string | null }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'unauthorized' }
  | { kind: 'provider_unavailable' }
  | { kind: 'invalid_response' };

const MAX_HONORED_RETRY_AFTER_MS = 60_000;

/** Mesma leitura de `Retry-After` usada em `mercado-livre-shipment.client.ts`. */
function parseRetryAfterMs(response: Response): number | null {
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string') return null;

  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  const ms = Math.round(seconds * 1000);
  return ms > MAX_HONORED_RETRY_AFTER_MS ? MAX_HONORED_RETRY_AFTER_MS : ms;
}

/**
 * Fallback de recuperação de `shipping.id` (correção da auditoria Full,
 * revisão crítica): existe SÓ porque um pedido histórico gravado antes da
 * migration 1789000000000 não tem `external_shipment_id` persistido, e sem
 * ele a reclassificação normal (`GET /shipments/{id}`) não tem o que
 * consultar. Único ponto do sistema que chama `GET /orders/{id}` fora da
 * sincronização — método exclusivamente GET, nunca escreve nada, nunca loga
 * o `accessToken` nem o corpo da resposta.
 *
 * A resposta é validada pela MESMA função usada pela sincronização normal
 * (`validateOrderEntry` — allowlist/schema já testada), nunca uma segunda
 * implementação de parsing. Só o `shipping.id` extraído é devolvido; o resto
 * do pedido (itens, pagamentos, valores) é descartado em memória — nunca
 * persistido por este cliente.
 */
@Injectable()
export class MercadoLivreOrderDetailClient {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ML_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  private get timeoutMs(): number {
    return this.configService.get<number>('ML_HTTP_TIMEOUT_MS', 10000);
  }

  async fetchOrderShipmentId(
    accessToken: string,
    externalOrderId: string,
  ): Promise<FetchOrderShipmentIdOutcome> {
    const url = `${ORDERS_ENDPOINT}/${encodeURIComponent(externalOrderId)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });
      } catch {
        return { kind: 'provider_unavailable' };
      }

      if (response.status === 404) {
        return { kind: 'not_found' };
      }
      if (response.status === 429) {
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response),
        };
      }
      // Mesma separação de `mercado-livre-shipment.client.ts`: 401/403 nunca
      // são transitórios, e precisam poder ABORTAR o lote (nunca degradar
      // vários pedidos em silêncio) — distinto de `provider_unavailable`.
      if (response.status === 401 || response.status === 403) {
        return { kind: 'unauthorized' };
      }
      if (!response.ok) {
        return { kind: 'provider_unavailable' };
      }

      try {
        const body: unknown = await response.json();
        const order = validateOrderEntry(body);
        if (!order) return { kind: 'invalid_response' };
        return { kind: 'success', shipmentId: order.shippingId };
      } catch {
        if (controller.signal.aborted) return { kind: 'provider_unavailable' };
        return { kind: 'invalid_response' };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
