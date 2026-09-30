import { Inject, Injectable, Logger } from '@nestjs/common';
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

/** Rótulo da busca no diagnóstico (a mesma rota serve à janela de criação, por status, e ao censo). */
export type ClaimsSearchOperation =
  'search_creation_closed' | 'search_creation_opened' | 'search_census';

/** Operação identificada no diagnóstico de falha — nunca a URL. */
export type ClaimsHttpOperation =
  | ClaimsSearchOperation
  | 'search'
  | 'fetch_core'
  | 'detail'
  | 'reputation'
  | 'reason';

export interface SearchClaimsInput {
  accessToken: string;
  sellerUserId: string;
  status?: string;
  dateRange?: ClaimsDateRange;
  offset: number;
  limit: number;
  sort?: string;
  operation?: ClaimsSearchOperation;
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

/** Resultado da ida à rede + o que o diagnóstico pode carregar (nunca corpo/URL). */
interface RawResult {
  raw: RawOutcome;
  httpStatus: number | null;
  validatorStage: string | null;
}

/** Diagnóstico sanitizado: SÓ estes 4 campos — nunca URL, IDs, token ou payload. */
export interface ClaimsHttpFailureDiagnostic {
  operation: ClaimsHttpOperation;
  category: Exclude<ClaimsHttpOutcome<unknown>['kind'], 'success'>;
  httpStatus: number | null;
  validatorStage: string | null;
}

export const CLAIMS_HTTP_FAILURE_EVENT = 'ml_claims_http_failure';

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
  private readonly logger = new Logger(MercadoLivreClaimsHttpClient.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(ML_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  private get timeoutMs(): number {
    return this.configService.get<number>('ML_HTTP_TIMEOUT_MS', 10000);
  }

  /**
   * Validação LOCAL da busca (nunca chama `fetch` quando falha): exige
   * `status` OU `dateRange`, `limit <= 100` e `offset + limit < 10000`.
   * Evidência de produção: busca SEM `status` responde 400 — os chamadores do
   * sync sempre enviam `status` (`closed` na criação, `opened` no censo).
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
    const operation = input.operation ?? 'search';
    if (!this.validateSearchInput(input)) {
      this.reportFailure({
        operation,
        category: 'invalid_request',
        httpStatus: null,
        validatorStage: 'request_input',
      });
      return { kind: 'invalid_request' };
    }

    const result = await this.get(
      this.buildSearchUrl(input),
      input.accessToken,
    );
    return this.toOutcome(result, validateClaimsSearchResponseBody, operation);
  }

  async fetchClaim(
    accessToken: string,
    claimId: string,
  ): Promise<ClaimsHttpOutcome<ClaimValidation & { valid: true }>> {
    const result = await this.get(
      `${CLAIMS_BASE_URL}/${encodeURIComponent(claimId)}`,
      accessToken,
    );
    return this.toOutcome(result, validateClaimResponseBody, 'fetch_core');
  }

  async fetchClaimDetail(
    accessToken: string,
    claimId: string,
  ): Promise<ClaimsHttpOutcome<ClaimDetailValidation & { valid: true }>> {
    const result = await this.get(
      `${CLAIMS_BASE_URL}/${encodeURIComponent(claimId)}/detail`,
      accessToken,
    );
    return this.toOutcome(result, validateClaimDetailResponseBody, 'detail');
  }

  async fetchClaimReason(
    accessToken: string,
    reasonId: string,
  ): Promise<ClaimsHttpOutcome<ClaimReasonValidation & { valid: true }>> {
    const result = await this.get(
      `${CLAIMS_BASE_URL}/reasons/${encodeURIComponent(reasonId)}`,
      accessToken,
    );
    return this.toOutcome(result, validateClaimReasonResponseBody, 'reason');
  }

  async fetchClaimReputationImpact(
    accessToken: string,
    claimId: string,
  ): Promise<ClaimsHttpOutcome<ClaimReputationValidation & { valid: true }>> {
    const result = await this.get(
      `${CLAIMS_BASE_URL}/${encodeURIComponent(claimId)}/affects-reputation`,
      accessToken,
    );
    return this.toOutcome(
      result,
      validateClaimReputationResponseBody,
      'reputation',
    );
  }

  /**
   * Mapeia o `RawOutcome` (rede/status HTTP) para o vocabulário público,
   * delegando a validação do corpo `2xx` ao validador específico do
   * contrato — nunca duplica a leitura/parse do corpo entre os 5 métodos.
   * Toda falha emite UM diagnóstico sanitizado.
   */
  private toOutcome<V extends { valid: boolean; stage?: string }>(
    { raw, httpStatus, validatorStage }: RawResult,
    validate: (body: unknown) => V,
    operation: ClaimsHttpOperation,
  ): ClaimsHttpOutcome<V & { valid: true }> {
    if (raw.kind !== 'success') {
      this.reportFailure({
        operation,
        category: raw.kind,
        httpStatus,
        validatorStage,
      });
      return raw;
    }
    const validation = validate(raw.body);
    if (!validation.valid) {
      this.reportFailure({
        operation,
        category: 'invalid_response',
        httpStatus,
        validatorStage: validation.stage ?? 'response_schema',
      });
      return { kind: 'invalid_response' };
    }
    return { kind: 'success', data: validation as V & { valid: true } };
  }

  /** Só os 4 campos do diagnóstico chegam ao log (nunca URL, IDs, token, corpo ou mensagem de erro). */
  private reportFailure(diagnostic: ClaimsHttpFailureDiagnostic): void {
    this.logger.warn(CLAIMS_HTTP_FAILURE_EVENT, {
      operation: diagnostic.operation,
      category: diagnostic.category,
      httpStatus: diagnostic.httpStatus,
      validatorStage: diagnostic.validatorStage,
    });
  }

  private async get(url: string, accessToken: string): Promise<RawResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const result = (
      raw: RawOutcome,
      httpStatus: number | null,
      validatorStage: string | null = null,
    ): RawResult => ({ raw, httpStatus, validatorStage });

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
        return result({ kind: 'provider_unavailable' }, null);
      }

      const status = response.status;
      if (status === 400) return result({ kind: 'invalid_request' }, status);
      if (status === 401) return result({ kind: 'unauthorized' }, status);
      if (status === 403) return result({ kind: 'forbidden' }, status);
      if (status === 404) return result({ kind: 'not_found' }, status);
      if (status === 429) {
        return result(
          { kind: 'rate_limited', retryAfterMs: parseRetryAfterMs(response) },
          status,
        );
      }
      if (!response.ok) {
        // 5xx e qualquer outro status não mapeado acima.
        return result({ kind: 'provider_unavailable' }, status);
      }

      try {
        const body: unknown = await response.json();
        return result({ kind: 'success', body }, status);
      } catch {
        if (controller.signal.aborted) {
          return result({ kind: 'provider_unavailable' }, status);
        }
        return result({ kind: 'invalid_response' }, status, 'json_parse');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
