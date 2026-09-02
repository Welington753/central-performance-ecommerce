import { Inject, Injectable } from '@nestjs/common';
import {
  AmazonLwaTokenResponse,
  validateAmazonLwaTokenResponseBody,
} from './amazon-lwa-token-response';

export type AmazonLwaRefreshOutcome =
  | { kind: 'success'; token: AmazonLwaTokenResponse }
  | { kind: 'invalid_grant' }
  | { kind: 'client_configuration_error' }
  | { kind: 'rate_limited' }
  | { kind: 'provider_unavailable' }
  | { kind: 'unknown_result' }
  | { kind: 'invalid_response' };

const LWA_TOKEN_ENDPOINT = 'https://api.amazon.com/auth/o2/token';
const LWA_HTTP_TIMEOUT_MS = 10000;

/**
 * Token de injeção explícito para `fetch`, mesmo padrão de `ML_FETCH`
 * (`mercado-livre-http.client.ts`) — necessário porque `jest.setup.ts`
 * bloqueia `global.fetch` em toda a suíte de testes; produção injeta o
 * `fetch` real via `AmazonModule`.
 */
export const AMAZON_FETCH = Symbol('AMAZON_FETCH');

/**
 * Único ponto do sistema que chama `POST
 * https://api.amazon.com/auth/o2/token` (Login with Amazon). Nunca inclui o
 * corpo bruto da resposta da Amazon em exceção ou log — só o campo `error`
 * estruturado é inspecionado, em memória, para classificar o resultado.
 */
@Injectable()
export class AmazonLwaClient {
  constructor(@Inject(AMAZON_FETCH) private readonly fetchImpl: typeof fetch) {}

  async refreshAccessToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<AmazonLwaRefreshOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LWA_HTTP_TIMEOUT_MS);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    });

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(LWA_TOKEN_ENDPOINT, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: controller.signal,
        });
      } catch {
        // Timeout (abort) ou falha de rede antes de qualquer resposta —
        // resultado desconhecido, nunca reenviado como rejeição definitiva
        // do refresh token.
        return { kind: 'unknown_result' };
      }

      if (response.status === 429) return { kind: 'rate_limited' };

      if (response.status >= 400 && response.status < 500) {
        let errorCode: unknown;
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          errorCode = errorBody.error;
        } catch {
          errorCode = undefined;
        }
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        if (errorCode === 'invalid_grant') return { kind: 'invalid_grant' };
        if (errorCode === 'invalid_client') {
          return { kind: 'client_configuration_error' };
        }
        return { kind: 'unknown_result' };
      }

      if (!response.ok) {
        // 5xx e qualquer outro status não coberto acima — falha transitória
        // do provedor, nunca prova de refresh token inválido.
        return { kind: 'provider_unavailable' };
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        return { kind: 'invalid_response' };
      }

      const validation = validateAmazonLwaTokenResponseBody(json);
      if (!validation.valid) return { kind: 'invalid_response' };

      return { kind: 'success', token: validation.token };
    } finally {
      clearTimeout(timeout);
    }
  }
}
