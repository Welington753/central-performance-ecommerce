import { Inject, Injectable } from '@nestjs/common';
import { isAllowedAmazonSpApiEndpoint } from './amazon-sp-api-endpoint.allowlist';
import { AMAZON_FETCH } from './amazon-lwa.client';
import { formatAmzDate } from './format-amz-date.util';

export type AmazonSpApiOutcome =
  | { kind: 'success'; body: unknown }
  | { kind: 'endpoint_not_allowed' }
  | { kind: 'unauthorized' }
  | { kind: 'rate_limited' }
  | { kind: 'provider_unavailable' }
  | { kind: 'invalid_response' };

export type AmazonSearchOrdersOutcome =
  | { kind: 'success'; body: unknown }
  | { kind: 'endpoint_not_allowed' }
  | { kind: 'unauthorized' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'provider_unavailable' }
  // Contrato inválido (ex.: parâmetro rejeitado pela Amazon) — 4xx que NÃO
  // é 401/403/429, nunca repetido pelo chamador.
  | { kind: 'client_error' }
  | { kind: 'invalid_response' };

export interface SearchOrdersInput {
  accessToken: string;
  endpoint: string;
  userAgent: string;
  marketplaceIds: readonly string[];
  createdAfter?: string;
  createdBefore?: string;
  lastUpdatedAfter?: string;
  lastUpdatedBefore?: string;
  paginationToken?: string;
}

const SP_API_HTTP_TIMEOUT_MS = 10000;
const MARKETPLACE_PARTICIPATIONS_PATH = '/sellers/v1/marketplaceParticipations';
const ORDERS_SEARCH_PATH = '/orders/2026-01-01/orders';
const ORDERS_MAX_RESULTS_PER_PAGE = 100;

/**
 * `includedData` fechado (Checkpoint 4-B): só o necessário para KPIs de
 * faturamento/pedidos/cancelamento — NUNCA `BUYER`/`RECIPIENT`/`PACKAGES`/
 * `TAX`/`PAYMENT` (dados de comprador/endereço/PII proibidos neste
 * sistema).
 */
const ORDERS_INCLUDED_DATA = ['PROCEEDS', 'FULFILLMENT', 'CANCELLATION'];

/**
 * Cliente SP-API mínimo (Checkpoint 4-A/4-B): autentica só com
 * `x-amz-access-token` (LWA) — NUNCA AWS SigV4/Access Key/Secret Key/IAM,
 * conforme o fluxo atual documentado pela Amazon para aplicações privadas.
 * Todos os testes mockam a fronteira HTTP via `AMAZON_FETCH`; nenhuma
 * chamada real ocorre. `searchOrders` busca APENAS uma página — a
 * paginação completa, as retentativas com backoff e a renovação forçada de
 * token em 401/403 vivem em `AmazonOrdersSyncService` (mesma separação
 * cliente/serviço já usada pela integração de pedidos do Mercado Livre).
 */
@Injectable()
export class AmazonSpApiClient {
  constructor(@Inject(AMAZON_FETCH) private readonly fetchImpl: typeof fetch) {}

  async getMarketplaceParticipations(input: {
    accessToken: string;
    endpoint: string;
    userAgent: string;
  }): Promise<AmazonSpApiOutcome> {
    if (!isAllowedAmazonSpApiEndpoint(input.endpoint)) {
      // Nunca aceita uma URL arbitrária: só os três hosts regionais oficiais
      // da allowlist — protege contra SSRF vindo de uma configuração
      // adulterada.
      return { kind: 'endpoint_not_allowed' };
    }

    const url = new URL(MARKETPLACE_PARTICIPATIONS_PATH, input.endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SP_API_HTTP_TIMEOUT_MS,
    );

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: this.buildHeaders(input),
          signal: controller.signal,
        });
      } catch {
        return { kind: 'provider_unavailable' };
      }

      if (response.status === 401 || response.status === 403) {
        return { kind: 'unauthorized' };
      }
      if (response.status === 429) return { kind: 'rate_limited' };
      if (!response.ok) return { kind: 'provider_unavailable' };

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

  /**
   * `GET /orders/2026-01-01/orders` — UMA página. Exige exatamente um dos
   * dois modos de data (`createdAfter` XOR `lastUpdatedAfter`) — lança
   * síncrono/rejeitado antes de qualquer chamada de rede quando violado,
   * nunca envia uma requisição ambígua. `marketplaceIds`/`includedData`
   * sempre presentes; `maxResultsPerPage` sempre 100; o token de
   * paginação, quando fornecido, é enviado como `paginationToken` — nunca
   * logado em nenhum ramo deste método.
   */
  async searchOrders(
    input: SearchOrdersInput,
  ): Promise<AmazonSearchOrdersOutcome> {
    const hasCreatedAfter = input.createdAfter !== undefined;
    const hasLastUpdatedAfter = input.lastUpdatedAfter !== undefined;
    if (hasCreatedAfter === hasLastUpdatedAfter) {
      throw new Error('AMAZON_SEARCH_ORDERS_INVALID_DATE_MODE');
    }

    if (!isAllowedAmazonSpApiEndpoint(input.endpoint)) {
      return { kind: 'endpoint_not_allowed' };
    }

    const url = new URL(ORDERS_SEARCH_PATH, input.endpoint);
    url.searchParams.set('marketplaceIds', input.marketplaceIds.join(','));
    url.searchParams.set(
      'maxResultsPerPage',
      String(ORDERS_MAX_RESULTS_PER_PAGE),
    );
    url.searchParams.set('includedData', ORDERS_INCLUDED_DATA.join(','));
    if (input.createdAfter !== undefined) {
      url.searchParams.set('createdAfter', input.createdAfter);
    }
    if (input.createdBefore !== undefined) {
      url.searchParams.set('createdBefore', input.createdBefore);
    }
    if (input.lastUpdatedAfter !== undefined) {
      url.searchParams.set('lastUpdatedAfter', input.lastUpdatedAfter);
    }
    if (input.lastUpdatedBefore !== undefined) {
      url.searchParams.set('lastUpdatedBefore', input.lastUpdatedBefore);
    }
    if (input.paginationToken !== undefined) {
      url.searchParams.set('paginationToken', input.paginationToken);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SP_API_HTTP_TIMEOUT_MS,
    );

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: this.buildHeaders(input),
          signal: controller.signal,
        });
      } catch {
        return { kind: 'provider_unavailable' };
      }

      if (response.status === 401 || response.status === 403) {
        return { kind: 'unauthorized' };
      }
      if (response.status === 429) {
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
        };
      }
      if (response.status >= 400 && response.status < 500) {
        return { kind: 'client_error' };
      }
      if (!response.ok) return { kind: 'provider_unavailable' };

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

  private buildHeaders(input: {
    accessToken: string;
    endpoint: string;
    userAgent: string;
  }): Record<string, string> {
    return {
      host: new URL(input.endpoint).host,
      'x-amz-access-token': input.accessToken,
      'x-amz-date': formatAmzDate(new Date()),
      'user-agent': input.userAgent,
    };
  }
}

/**
 * `Retry-After` só é honrado quando é um inteiro de segundos válido e não
 * negativo (formato HTTP-date não é suportado — nunca inventa um valor).
 */
function parseRetryAfterMs(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  if (!/^\d+$/.test(headerValue)) return null;
  const seconds = Number(headerValue);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  return seconds * 1000;
}
