import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';

const ORDERS_SEARCH_ENDPOINT = 'https://api.mercadolibre.com/orders/search';

/**
 * Tamanho de página usado nas chamadas a `GET /orders/search` (design da
 * Fase 3, confirmado na documentação oficial via busca indexada — o fetch
 * direto às páginas de developers.mercadolivre.com.br retornou 403/
 * Cloudflare durante a implementação): padrão documentado é `limit=50`,
 * `offset=0`; o teto documentado por página é 100.
 */
export const ORDERS_PAGE_LIMIT = 50;

export interface FetchOrdersPageInput {
  accessToken: string;
  sellerId: string;
  dateCreatedFrom: Date;
  dateCreatedTo: Date;
  offset: number;
  limit: number;
}

export type FetchOrdersPageOutcome =
  | { kind: 'success'; body: unknown }
  | { kind: 'unauthorized' }
  | { kind: 'rate_limited' }
  | { kind: 'provider_unavailable' }
  | { kind: 'invalid_response' };

/**
 * Único ponto do sistema que chama `GET /orders/search`. Método HTTP
 * exclusivamente GET (leitura) — nunca escreve nada no Mercado Livre. O
 * `accessToken` chega já resolvido por
 * `MercadoLivreOAuthService.ensureValidAccessToken` (Fase 2); esta classe
 * nunca o loga nem o inclui em qualquer mensagem de erro.
 */
@Injectable()
export class MercadoLivreOrdersHttpClient {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ML_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  private get timeoutMs(): number {
    return this.configService.get<number>('ML_HTTP_TIMEOUT_MS', 10000);
  }

  async fetchOrdersPage(
    input: FetchOrdersPageInput,
  ): Promise<FetchOrdersPageOutcome> {
    const url = new URL(ORDERS_SEARCH_ENDPOINT);
    url.searchParams.set('seller', input.sellerId);
    url.searchParams.set(
      'order.date_created.from',
      input.dateCreatedFrom.toISOString(),
    );
    url.searchParams.set(
      'order.date_created.to',
      input.dateCreatedTo.toISOString(),
    );
    url.searchParams.set('offset', String(input.offset));
    url.searchParams.set('limit', String(input.limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${input.accessToken}`,
          },
          signal: controller.signal,
        });
      } catch {
        return { kind: 'provider_unavailable' };
      }

      if (response.status === 401 || response.status === 403) {
        return { kind: 'unauthorized' };
      }
      if (response.status === 429) {
        return { kind: 'rate_limited' };
      }
      if (!response.ok) {
        return { kind: 'provider_unavailable' };
      }

      try {
        const body: unknown = await response.json();
        return { kind: 'success', body };
      } catch {
        if (controller.signal.aborted) return { kind: 'provider_unavailable' };
        return { kind: 'invalid_response' };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
