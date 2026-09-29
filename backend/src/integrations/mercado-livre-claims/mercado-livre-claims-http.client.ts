import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import {
  ClaimDetailValidation,
  validateClaimDetailResponseBody,
} from './mercado-livre-claim-detail-response';
import {
  ClaimReasonValidation,
  validateClaimReasonResponseBody,
} from './mercado-livre-claim-reason-response';
import {
  ClaimReputationValidation,
  validateClaimReputationResponseBody,
} from './mercado-livre-claim-reputation-response';
import {
  ClaimValidation,
  validateClaimResponseBody,
} from './mercado-livre-claim-response';
import {
  ClaimsSearchValidation,
  validateClaimsSearchResponseBody,
} from './mercado-livre-claims-search-response';

const CLAIMS_BASE_URL = 'https://api.mercadolibre.com/post-purchase/v1/claims';
const SEARCH_ENDPOINT = `${CLAIMS_BASE_URL}/search`;
const MAX_SEARCH_LIMIT = 100;
const MAX_OFFSET_PLUS_LIMIT = 10000;

export interface ClaimsDateRange {
  after: Date;
  before: Date;
}

export interface SearchClaimsInput {
  accessToken: string;
  sellerUserId: string;
  status?: string;
  dateRange?: ClaimsDateRange;
  offset: number;
  limit: number;
  sort?: string;
}

/**
 * Vocabulário de erro único dos 5 métodos — nunca mistura o `400`/`invalid_request`
 * do servidor (ou uma falha de validação LOCAL, que nunca chega a chamar
 * `fetch`) com `invalid_response` (corpo `2xx` que não passa no validador).
 * Rede/timeout/`5xx` caem todos em `provider_unavailable`, mesma convenção já
 * usada por `mercado-livre-orders-http.client.ts` (o `AbortController` do
 * timeout faz o próprio `fetch` rejeitar, caindo no mesmo `catch`).
 */
export type ClaimsHttpOutcome<T> =
  | { kind: 'success'; data: T }
  | { kind: 'invalid_request' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'provider_unavailable' }
  | { kind: 'invalid_response' };

type RawOutcome =
  | { kind: 'success'; body: unknown }
  | { kind: 'invalid_request' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'provider_unavailable' }
  | { kind: 'invalid_response' };

const MAX_HONORED_RETRY_AFTER_MS = 60_000;

function parseRetryAfterMs(response: Response): number | null {
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string') return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = Math.round(seconds * 1000);
  return ms > MAX_HONORED_RETRY_AFTER_MS ? MAX_HONORED_RETRY_AFTER_MS : ms;
}

/**
 * Único ponto do sistema que chama os endpoints de Claims do Mercado Livre.
 * Método HTTP exclusivamente GET (leitura) — nunca escreve nada no Mercado
 * Livre. `accessToken` chega já resolvido por
 * `MercadoLivreOAuthService.ensureValidAccessToken` (não é responsabilidade
 * desta classe); nunca é logado nem incluído em nenhuma mensagem de erro,
 * assim como o corpo bruto de qualquer resposta.
 */
@Injectable()
export class MercadoLivreClaimsHttpClient {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ML_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  private get timeoutMs(): number {
    return this.configService.get<number>('ML_HTTP_TIMEOUT_MS', 10000);
  }

  /**
   * Validação LOCAL da busca (nunca chama `fetch` quando falha): exige
   * `status` OU `dateRange` (evidência de produção confirma essa forma;
   * ambos juntos também são permitidos), `limit <= 100` e
   * `offset + limit < 10000`.
   */
  private validateSearchInput(input: SearchClaimsInput): boolean {
    if (!input.status && !input.dateRange) return false;
    if (input.limit > MAX_SEARCH_LIMIT) return false;
    if (input.offset + input.limit >= MAX_OFFSET_PLUS_LIMIT) return false;
    return true;
  }

  private buildSearchUrl(input: SearchClaimsInput): string {
    const url = new URL(SEARCH_ENDPOINT);
    url.searchParams.set('players.user_id', input.sellerUserId);
    url.searchParams.set('players.role', 'respondent');
    if (input.status) url.searchParams.set('status', input.status);
    if (input.dateRange) {
      url.searchParams.set(
        'range',
        `date_created:after:${input.dateRange.after.toISOString()},before:${input.dateRange.before.toISOString()}`,
      );
    }
    url.searchParams.set('offset', String(input.offset));
    url.searchParams.set('limit', String(input.limit));
    if (input.sort) url.searchParams.set('sort', input.sort);
    return url.toString();
  }

  async searchClaims(
    input: SearchClaimsInput,
  ): Promise<ClaimsHttpOutcome<ClaimsSearchValidation & { valid: true }>> {
    if (!this.validateSearchInput(input)) {
      return { kind: 'invalid_request' };
    }

    const raw = await this.get(this.buildSearchUrl(input), input.accessToken);
    return this.toOutcome(raw, validateClaimsSearchResponseBody);
  }

  async fetchClaim(
    accessToken: string,
    claimId: string,
  ): Promise<ClaimsHttpOutcome<ClaimValidation & { valid: true }>> {
    const raw = await this.get(
      `${CLAIMS_BASE_URL}/${encodeURIComponent(claimId)}`,
      accessToken,
    );
    return this.toOutcome(raw, validateClaimResponseBody);
  }

  async fetchClaimDetail(
    accessToken: string,
    claimId: string,
  ): Promise<ClaimsHttpOutcome<ClaimDetailValidation & { valid: true }>> {
    const raw = await this.get(
      `${CLAIMS_BASE_URL}/${encodeURIComponent(claimId)}/detail`,
      accessToken,
    );
    return this.toOutcome(raw, validateClaimDetailResponseBody);
  }

  async fetchClaimReason(
    accessToken: string,
    reasonId: string,
  ): Promise<ClaimsHttpOutcome<ClaimReasonValidation & { valid: true }>> {
    const raw = await this.get(
      `${CLAIMS_BASE_URL}/reasons/${encodeURIComponent(reasonId)}`,
      accessToken,
    );
    return this.toOutcome(raw, validateClaimReasonResponseBody);
  }

  async fetchClaimReputationImpact(
    accessToken: string,
    claimId: string,
  ): Promise<ClaimsHttpOutcome<ClaimReputationValidation & { valid: true }>> {
    const raw = await this.get(
      `${CLAIMS_BASE_URL}/${encodeURIComponent(claimId)}/affects-reputation`,
      accessToken,
    );
    return this.toOutcome(raw, validateClaimReputationResponseBody);
  }

  /**
   * Mapeia o `RawOutcome` (rede/status HTTP) para o vocabulário público,
   * delegando a validação do corpo `2xx` ao validador específico do
   * contrato — nunca duplica a leitura/parse do corpo entre os 5 métodos.
   */
  private toOutcome<V extends { valid: boolean }>(
    raw: RawOutcome,
    validate: (body: unknown) => V,
  ): ClaimsHttpOutcome<V & { valid: true }> {
    if (raw.kind !== 'success') return raw;
    const validation = validate(raw.body);
    if (!validation.valid) return { kind: 'invalid_response' };
    return { kind: 'success', data: validation as V & { valid: true } };
  }

  private async get(url: string, accessToken: string): Promise<RawOutcome> {
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

      if (response.status === 400) return { kind: 'invalid_request' };
      if (response.status === 401) return { kind: 'unauthorized' };
      if (response.status === 403) return { kind: 'forbidden' };
      if (response.status === 404) return { kind: 'not_found' };
      if (response.status === 429) {
        return {
          kind: 'rate_limited',
          retryAfterMs: parseRetryAfterMs(response),
        };
      }
      if (!response.ok) {
        // 5xx e qualquer outro status não mapeado acima.
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
