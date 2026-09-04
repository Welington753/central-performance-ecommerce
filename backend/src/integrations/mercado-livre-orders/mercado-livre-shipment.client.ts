import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { validateShipmentResponseBody } from './mercado-livre-shipment-response';

const SHIPMENTS_ENDPOINT = 'https://api.mercadolibre.com/shipments';

export type FetchShipmentOutcome =
  | { kind: 'success'; logisticType: string | null }
  | { kind: 'not_found' }
  | { kind: 'rate_limited' }
  | { kind: 'provider_unavailable' }
  | { kind: 'invalid_response' };

/**
 * Único ponto do sistema que chama `GET /shipments/{id}` (Fase 4, "Full") —
 * necessário porque `GET /orders/search` só devolve o `shipping.id`, nunca o
 * `logistic_type` que distingue Full. Método exclusivamente GET; nunca loga
 * o `accessToken`. Falha aqui NUNCA derruba a sincronização do pedido — o
 * chamador (`MercadoLivreOrdersSyncService`) trata qualquer resultado
 * diferente de `success` como classificação `UNKNOWN`, preservando o pedido.
 */
@Injectable()
export class MercadoLivreShipmentClient {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ML_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  private get timeoutMs(): number {
    return this.configService.get<number>('ML_HTTP_TIMEOUT_MS', 10000);
  }

  async fetchShipment(
    accessToken: string,
    shipmentId: string,
  ): Promise<FetchShipmentOutcome> {
    const url = `${SHIPMENTS_ENDPOINT}/${encodeURIComponent(shipmentId)}`;

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
        return { kind: 'rate_limited' };
      }
      if (!response.ok) {
        return { kind: 'provider_unavailable' };
      }

      try {
        const body: unknown = await response.json();
        const shipment = validateShipmentResponseBody(body);
        if (!shipment) return { kind: 'invalid_response' };
        return { kind: 'success', logisticType: shipment.logisticType };
      } catch {
        if (controller.signal.aborted) return { kind: 'provider_unavailable' };
        return { kind: 'invalid_response' };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
