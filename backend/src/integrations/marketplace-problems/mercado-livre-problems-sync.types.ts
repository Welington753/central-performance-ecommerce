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

export interface ProblemsSyncResult {
  complete: boolean;
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
}
