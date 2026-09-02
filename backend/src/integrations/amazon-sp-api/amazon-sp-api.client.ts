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

const SP_API_HTTP_TIMEOUT_MS = 10000;
const MARKETPLACE_PARTICIPATIONS_PATH = '/sellers/v1/marketplaceParticipations';

/**
 * Cliente SP-API mínimo (Etapa 7): autentica só com `x-amz-access-token`
 * (LWA) — NUNCA AWS SigV4/Access Key/Secret Key/IAM, conforme o fluxo atual
 * documentado pela Amazon para aplicações privadas. Nenhuma chamada real é
 * feita nesta fase (sem consumidor); todos os testes mockam a fronteira
 * HTTP via `AMAZON_FETCH`. Implementa apenas o método necessário para uma
 * futura verificação não sensível da conta — não implementa Orders API.
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
          headers: {
            host: url.host,
            'x-amz-access-token': input.accessToken,
            'x-amz-date': formatAmzDate(new Date()),
            'user-agent': input.userAgent,
          },
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
}
