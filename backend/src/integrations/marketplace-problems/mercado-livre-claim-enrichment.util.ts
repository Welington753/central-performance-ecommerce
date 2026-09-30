import type { ClaimsHttpOutcome } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import type { RawDetailPlayer } from '../mercado-livre-claims/mercado-livre-claim-detail-response';
import type { ClaimsSearchValidation } from '../mercado-livre-claims/mercado-livre-claims-search-response';
import type { ProblemActionInput } from './mercado-livre-claim-to-problem.mapper';
import type { SearchPageResult } from './mercado-livre-claims-window.util';
import type { ProblemsSyncStopReason } from './mercado-livre-problems-sync.service';

/**
 * Classificação das 4 chamadas POR-CLAIM (`fetchClaim`/`fetchClaimDetail`/
 * `fetchClaimReputationImpact`/`fetchClaimReason`). `isolated` afeta só o
 * claim/enriquecimento atual (CP2-B nunca aborta o lote inteiro por causa
 * disso); os demais são sintomas sistêmicos (token/limite/indisponibilidade)
 * e sempre abortam a execução inteira em `MercadoLivreProblemsSyncService`.
 */
export type ClaimOutcomeClassification =
  | { kind: 'ok' }
  | { kind: 'isolated' }
  | { kind: 'abort_auth' }
  | { kind: 'abort_provider' }
  | { kind: 'abort_rate_limit'; retryAfterMs: number | null };

export function classifyClaimsHttpOutcome(
  outcome: ClaimsHttpOutcome<unknown>,
): ClaimOutcomeClassification {
  switch (outcome.kind) {
    case 'success':
      return { kind: 'ok' };
    case 'unauthorized':
    case 'forbidden':
      return { kind: 'abort_auth' };
    case 'provider_unavailable':
      return { kind: 'abort_provider' };
    case 'rate_limited':
      return { kind: 'abort_rate_limit', retryAfterMs: outcome.retryAfterMs };
    case 'not_found':
    case 'invalid_response':
    case 'invalid_request':
      return { kind: 'isolated' };
  }
}

/**
 * Classificação da BUSCA (`searchClaims`) — vocabulário PRÓPRIO, nunca
 * reaproveita `isolated`: uma página de busca que falhe não tem como saber
 * com segurança quais claims ficaram de fora dela, então qualquer resultado
 * diferente de sucesso torna a cobertura da janela/censo INCOMPLETA e para a
 * descoberta imediatamente (nunca "isolado por página").
 */
export type SearchOutcomeClassification =
  | { kind: 'ok' }
  | { kind: 'SEARCH_CONTRACT_ERROR' }
  | { kind: 'TERMINAL_AUTH_ERROR' }
  | { kind: 'PROVIDER_UNAVAILABLE' }
  | { kind: 'RATE_LIMITED'; retryAfterMs: number | null };

export function classifySearchOutcome(
  outcome: ClaimsHttpOutcome<unknown>,
): SearchOutcomeClassification {
  switch (outcome.kind) {
    case 'success':
      return { kind: 'ok' };
    case 'unauthorized':
    case 'forbidden':
      return { kind: 'TERMINAL_AUTH_ERROR' };
    case 'provider_unavailable':
      return { kind: 'PROVIDER_UNAVAILABLE' };
    case 'rate_limited':
      return { kind: 'RATE_LIMITED', retryAfterMs: outcome.retryAfterMs };
    case 'not_found':
    case 'invalid_response':
    case 'invalid_request':
      return { kind: 'SEARCH_CONTRACT_ERROR' };
  }
}

/**
 * Achata `players[].availableActions` (`GET .../detail`) em 1
 * `ProblemActionInput` por `(player, action)` — papel/tipo do player
 * resolvidos aqui (CP2-A deixou isso explicitamente para o CP2-B). Ordem de
 * entrada preservada; player sem `availableActions` não gera nenhum item.
 */
export function flattenDetailActions(
  players: RawDetailPlayer[],
): ProblemActionInput[] {
  const actions: ProblemActionInput[] = [];
  for (const player of players) {
    for (const action of player.availableActions) {
      actions.push({
        playerRole: player.role,
        playerType: player.type ?? 'UNKNOWN',
        actionCode: action.actionCode,
        mandatory: action.mandatory,
        dueDate: action.dueDate === null ? null : new Date(action.dueDate),
      });
    }
  }
  return actions;
}

export interface ProblemsSyncCounters {
  claimsProcessed: number;
  claimsCoreCovered: number;
  claimsPersisted: number;
  claimsPreserved: number;
  claimsFailed: number;
  detailFailures: number;
  reputationFailures: number;
  reasonLookupFailures: number;
  reasonCacheRefreshed: number;
}

export function emptyProblemsSyncCounters(): ProblemsSyncCounters {
  return {
    claimsProcessed: 0,
    claimsCoreCovered: 0,
    claimsPersisted: 0,
    claimsPreserved: 0,
    claimsFailed: 0,
    detailFailures: 0,
    reputationFailures: 0,
    reasonLookupFailures: 0,
    reasonCacheRefreshed: 0,
  };
}

export type ProcessOutcomeStopReason = Extract<
  ProblemsSyncStopReason,
  | 'COMPLETED'
  | 'CORE_COVERAGE_INCOMPLETE'
  | 'TERMINAL_AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PERSISTENCE_UNAVAILABLE'
>;

export interface ProcessCandidatesOutcome {
  stopReason: ProcessOutcomeStopReason;
  retryAfterMs: number | null;
  callsUsed: number;
  counters: ProblemsSyncCounters;
}

/** Traduz uma classificação por-claim em interrupção do LOTE inteiro — só
 * para os 3 casos sistêmicos; `isolated`/`ok` devolvem `null` (seguem o
 * fluxo normal de `processClaim`, em `MercadoLivreProblemsSyncService`). */
export function abortFrom(
  classification: ClaimOutcomeClassification,
  callsUsed: number,
  counters: ProblemsSyncCounters,
): ProcessCandidatesOutcome | null {
  switch (classification.kind) {
    case 'abort_auth':
      return {
        stopReason: 'TERMINAL_AUTH_ERROR',
        retryAfterMs: null,
        callsUsed,
        counters,
      };
    case 'abort_rate_limit':
      return {
        stopReason: 'RATE_LIMITED',
        retryAfterMs: classification.retryAfterMs,
        callsUsed,
        counters,
      };
    case 'abort_provider':
      return {
        stopReason: 'PROVIDER_UNAVAILABLE',
        retryAfterMs: null,
        callsUsed,
        counters,
      };
    default:
      return null;
  }
}

export function stopReasonFromSearchClassification(
  classification: SearchOutcomeClassification,
): { stopReason: ProblemsSyncStopReason; retryAfterMs: number | null } {
  switch (classification.kind) {
    case 'SEARCH_CONTRACT_ERROR':
      return { stopReason: 'SEARCH_CONTRACT_ERROR', retryAfterMs: null };
    case 'TERMINAL_AUTH_ERROR':
      return { stopReason: 'TERMINAL_AUTH_ERROR', retryAfterMs: null };
    case 'PROVIDER_UNAVAILABLE':
      return { stopReason: 'PROVIDER_UNAVAILABLE', retryAfterMs: null };
    case 'RATE_LIMITED':
      return {
        stopReason: 'RATE_LIMITED',
        retryAfterMs: classification.retryAfterMs,
      };
    case 'ok':
      throw new Error(
        'estado inesperado: classificação ok tratada como erro de busca',
      );
  }
}

/** Converte o envelope real de `searchClaims` (`{valid, data, paging}`) no
 * formato abstrato `{ids, total}` que `commitSafeSubWindow` consome — único
 * ponto de conversão, reaproveitado pelos 3 métodos públicos do serviço. */
export function toSearchPageOutcome(
  outcome: ClaimsHttpOutcome<ClaimsSearchValidation & { valid: true }>,
): ClaimsHttpOutcome<SearchPageResult> {
  if (outcome.kind !== 'success') return outcome;
  return {
    kind: 'success',
    data: {
      ids: outcome.data.data.map((c) => c.externalClaimId),
      total: outcome.data.paging.total,
    },
  };
}

export function assertValidSyncDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} precisa ser uma Date válida.`);
  }
}

export function assertPositiveIntegerSync(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} precisa ser um inteiro positivo.`);
  }
}

export function zeroProblemsSyncResult(
  stopReason: ProblemsSyncStopReason,
  retryAfterMs: number | null,
  httpCallsMade: number,
  pagesFetched: number,
  coverageFrom: string | null,
  nextWindowFrom: string | null,
): {
  complete: false;
  stopReason: ProblemsSyncStopReason;
  retryAfterMs: number | null;
  coverageFrom: string | null;
  claimsFound: number;
  claimsProcessed: number;
  claimsCoreCovered: number;
  claimsPersisted: number;
  claimsPreserved: number;
  claimsFailed: number;
  detailFailures: number;
  reputationFailures: number;
  reasonLookupFailures: number;
  reasonCacheRefreshed: number;
  httpCallsMade: number;
  pagesFetched: number;
  nextWindowFrom: string | null;
} {
  return {
    complete: false,
    stopReason,
    retryAfterMs,
    coverageFrom,
    claimsFound: 0,
    claimsProcessed: 0,
    claimsCoreCovered: 0,
    claimsPersisted: 0,
    claimsPreserved: 0,
    claimsFailed: 0,
    detailFailures: 0,
    reputationFailures: 0,
    reasonLookupFailures: 0,
    reasonCacheRefreshed: 0,
    httpCallsMade,
    pagesFetched,
    nextWindowFrom,
  };
}
