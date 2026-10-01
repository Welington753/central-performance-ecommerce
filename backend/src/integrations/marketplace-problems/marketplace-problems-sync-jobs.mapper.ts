import type {
  MarketplaceProblemsHistoricalStatus,
  MarketplaceProblemsSyncJobRow,
  MarketplaceProblemsSyncJobStatus,
} from './marketplace-problems-sync-jobs.types';

export interface JobRawRow {
  id: string;
  marketplace_account_id: string;
  status: MarketplaceProblemsSyncJobStatus;
  window_cursor_at: Date;
  claims_processed_count: string;
  claims_persisted_count: string;
  claims_failed_count: string;
  calls_made_count: string;
  attempt_count: number;
  next_attempt_at: Date;
  last_error_code: string | null;
  pause_requested: boolean;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  version: number;
  last_activity_at: Date | null;
  last_census_at: Date | null;
  historical_covered_from: Date;
  historical_target_from: Date | null;
  historical_status: MarketplaceProblemsHistoricalStatus;
  historical_completed_at: Date | null;
  historical_last_error_code: string | null;
  historical_attempt_count: number;
  historical_next_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function mapJobRow(row: JobRawRow): MarketplaceProblemsSyncJobRow {
  return {
    id: row.id,
    marketplaceAccountId: row.marketplace_account_id,
    status: row.status,
    windowCursorAt: row.window_cursor_at,
    // `bigint` chega como string do driver — contadores nunca chegam perto de 2^53.
    claimsProcessedCount: Number(row.claims_processed_count),
    claimsPersistedCount: Number(row.claims_persisted_count),
    claimsFailedCount: Number(row.claims_failed_count),
    callsMadeCount: Number(row.calls_made_count),
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    pauseRequested: row.pause_requested,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    version: row.version,
    lastActivityAt: row.last_activity_at,
    lastCompleteCensusAt: row.last_census_at,
    historicalCoveredFrom: row.historical_covered_from,
    historicalTargetFrom: row.historical_target_from,
    historicalStatus: row.historical_status,
    historicalCompletedAt: row.historical_completed_at,
    historicalLastErrorCode: row.historical_last_error_code,
    historicalAttemptCount: row.historical_attempt_count,
    historicalNextAttemptAt: row.historical_next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const JOB_SELECT_COLUMNS = `
  id, marketplace_account_id, status, window_cursor_at,
  claims_processed_count, claims_persisted_count, claims_failed_count,
  calls_made_count, attempt_count, next_attempt_at, last_error_code,
  pause_requested, lease_owner, lease_expires_at, version, last_activity_at,
  last_census_at, historical_covered_from, historical_target_from,
  historical_status, historical_completed_at, historical_last_error_code,
  historical_attempt_count, historical_next_attempt_at, created_at, updated_at
`;
