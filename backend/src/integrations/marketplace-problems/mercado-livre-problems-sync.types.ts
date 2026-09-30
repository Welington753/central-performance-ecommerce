export interface ProblemsSyncBudget {
  maxClaims?: number;
  maxHttpCalls?: number;
}

export type ProblemsSyncStopReason =
  | 'COMPLETED'
  | 'CORE_COVERAGE_INCOMPLETE'
  | 'CLAIM_BUDGET_EXHAUSTED'
  | 'CALL_BUDGET_EXHAUSTED'
  | 'SAFETY_LIMIT_REACHED'
  | 'SEARCH_CONTRACT_ERROR'
  | 'TERMINAL_AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PERSISTENCE_UNAVAILABLE';

/**
 * Diagnóstico fechado de 401/403 por operação (nunca URL, token, seller ID,
 * claim ID, payload ou mensagem crua) — gravado em `last_error_code` no lugar
 * do `stopReason` genérico. `*_UNAUTHORIZED` (401, qualquer operação) e
 * `SEARCH_FORBIDDEN` são falhas globais; `CORE_FORBIDDEN` é 403 isolado de UM
 * claim (cobertura incompleta, nunca FAILED_AUTH). 403 em detail/reputation/
 * reason é enriquecimento isolado e não gera código.
 */
export type ProblemsSyncFailureCode =
  | 'SEARCH_UNAUTHORIZED'
  | 'SEARCH_FORBIDDEN'
  | 'CORE_UNAUTHORIZED'
  | 'CORE_FORBIDDEN'
  | 'DETAIL_UNAUTHORIZED'
  | 'REPUTATION_UNAUTHORIZED'
  | 'REASON_UNAUTHORIZED';

export interface ProblemsSyncResult {
  complete: boolean;
  stopReason: ProblemsSyncStopReason;
  /** Diagnóstico específico da falha; `null` quando o `stopReason` basta. */
  failureCode: ProblemsSyncFailureCode | null;
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
}
