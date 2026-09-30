import type { ClaimsHttpOutcome } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import {
  classifySearchOutcome,
  zeroProblemsSyncResult,
  stopReasonFromSearchClassification,
  type ProcessCandidatesOutcome,
} from './mercado-livre-claim-enrichment.util';
import type {
  commitSafeSubWindow,
  WindowRange,
} from './mercado-livre-claims-window.util';
import type {
  ProblemsSyncResult,
  ProblemsSyncStopReason,
} from './mercado-livre-problems-sync.types';

export type WindowCommit = Awaited<ReturnType<typeof commitSafeSubWindow>>;

/** Campos comuns entre o resultado de janela commitada e `assembleResult`
 * (censo direto/refresh) — nunca duplica a leitura dos 9 contadores em 2
 * lugares. */
export function resultFromOutcome(
  outcome: ProcessCandidatesOutcome,
): Omit<
  ProblemsSyncResult,
  | 'coverageFrom'
  | 'claimsFound'
  | 'httpCallsMade'
  | 'pagesFetched'
  | 'nextWindowFrom'
> {
  return {
    complete: outcome.stopReason === 'COMPLETED',
    stopReason: outcome.stopReason,
    failureCode: outcome.failureCode,
    retryAfterMs: outcome.retryAfterMs,
    claimsProcessed: outcome.counters.claimsProcessed,
    claimsCoreCovered: outcome.counters.claimsCoreCovered,
    claimsPersisted: outcome.counters.claimsPersisted,
    claimsPreserved: outcome.counters.claimsPreserved,
    claimsFailed: outcome.counters.claimsFailed,
    detailFailures: outcome.counters.detailFailures,
    reputationFailures: outcome.counters.reputationFailures,
    reasonLookupFailures: outcome.counters.reasonLookupFailures,
    reasonCacheRefreshed: outcome.counters.reasonCacheRefreshed,
  };
}

export function assembleResult(
  outcome: ProcessCandidatesOutcome,
  claimsFound: number,
  discoveryCallsUsed: number,
  coverageFrom: string | null,
  nextWindowFrom: string | null,
): ProblemsSyncResult {
  return {
    ...resultFromOutcome(outcome),
    coverageFrom,
    claimsFound,
    httpCallsMade: discoveryCallsUsed + outcome.callsUsed,
    pagesFetched: discoveryCallsUsed,
    nextWindowFrom,
  };
}

/** Busca direta do censo (sonda/paginação) que falhou: nada processado. */
export function resultFromCensusSearchFailure(
  outcome: ClaimsHttpOutcome<unknown>,
  callsUsed: number,
): ProblemsSyncResult {
  const { stopReason, retryAfterMs, failureCode } =
    stopReasonFromSearchClassification(classifySearchOutcome(outcome));
  return zeroProblemsSyncResult(
    stopReason,
    retryAfterMs,
    callsUsed,
    callsUsed,
    null,
    null,
    failureCode,
  );
}

/** Resultado para os ramos de `commitSafeSubWindow` que NÃO commitaram
 * (search_error / safety_limit / claim_budget / call_budget). */
export function resultFromUncommittedWindow(
  commit: Exclude<WindowCommit, { kind: 'committed' }>,
  window: WindowRange,
  coverageFrom: string | null,
  totalCalls: number,
): ProblemsSyncResult {
  if (commit.kind === 'search_error') {
    const { stopReason, retryAfterMs, failureCode } =
      stopReasonFromSearchClassification(commit.classification);
    return zeroProblemsSyncResult(
      stopReason,
      retryAfterMs,
      totalCalls,
      totalCalls,
      coverageFrom,
      window.from.toISOString(),
      failureCode,
    );
  }
  const stopReason: ProblemsSyncStopReason =
    commit.kind === 'safety_limit_reached'
      ? 'SAFETY_LIMIT_REACHED'
      : commit.kind === 'claim_budget_exhausted'
        ? 'CLAIM_BUDGET_EXHAUSTED'
        : 'CALL_BUDGET_EXHAUSTED';
  return zeroProblemsSyncResult(
    stopReason,
    null,
    totalCalls,
    totalCalls,
    coverageFrom,
    window.from.toISOString(),
  );
}
