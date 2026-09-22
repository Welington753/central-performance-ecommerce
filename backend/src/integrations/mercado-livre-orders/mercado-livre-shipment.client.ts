import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { validateShipmentResponseBody } from './mercado-livre-shipment-response';

const SHIPMENTS_ENDPOINT = 'https://api.mercadolibre.com/shipments';

export type FetchShipmentOutcome =
  | { kind: 'success'; logisticType: string | null }
  | { kind: 'not_found' }
  /**
   * `Retry-After` (em milissegundos) quando o provedor informou explicitamente
   * quanto esperar; `null` quando o header está ausente ou em formato não
   * reconhecido — NUNCA um palpite. Quem faz retry (ver
   * `mercado-livre-shipment-lookup.service.ts`) usa o backoff próprio nesse
   * caso, nunca um valor inventado.
   */
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'unauthorized' }
  | { kind: 'provider_unavailable' }
  | { kind: 'invalid_response' };

/**
 * Teto defensivo para o `Retry-After` recebido do provedor — um header
 * absurdo (ou hostil) nunca pode transformar uma consulta de envio numa
 * espera indefinida. Acima disto, o valor é descartado e o backoff próprio
 * do chamador assume.
 */
const MAX_HONORED_RETRY_AFTER_MS = 60_000;

/**
 * Lê `Retry-After` no formato "delay em segundos" (o único que o Mercado
 * Livre usa para 429). O formato HTTP-date é deliberadamente IGNORADO
 * (`null`) em vez de convertido: depender do relógio local para calcular a
 * espera é menos confiável que o backoff exponencial do chamador.
 */
function parseRetryAfterMs(response: Response): number | null {
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string') return null;

  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  const ms = Math.round(seconds * 1000);
  return ms > MAX_HONORED_RETRY_AFTER_MS ? MAX_HONORED_RETRY_AFTER_MS : ms;
}

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
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response),
        };
      }
      // 401/403 NUNCA são transitórios: repetir a mesma chamada com o mesmo
      // token só queima cota e atrasa o diagnóstico. Separado de
      // `provider_unavailable` para que a reclassificação em lote possa
      // ABORTAR (nunca degradar centenas de registros em silêncio).
      if (response.status === 401 || response.status === 403) {
        return { kind: 'unauthorized' };
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
