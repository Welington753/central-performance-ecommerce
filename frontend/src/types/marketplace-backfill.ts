export type BackfillStatusValue =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "SAFETY_LIMIT_REACHED"
  | "ERROR";

export interface BackfillProcessedChunk {
  from: string;
  to: string;
  ordersFetched: number;
}

/** Estado do job durável no backend — worker processa, a UI só acompanha. */
export type BackfillJobStatusValue =
  | "QUEUED"
  | "RUNNING"
  | "RETRY_WAIT"
  | "PAUSED"
  | "FAILED"
  | "SAFETY_LIMIT_REACHED";

export interface BackfillJobSummaryDto {
  id: string;
  status: BackfillJobStatusValue;
  chunksProcessed: number;
  attemptCount: number;
  requestedAt: string;
  startedAt: string | null;
  lastActivityAt: string | null;
  nextAttemptAt: string | null;
  completedAt: string | null;
  lastErrorCode: string | null;
  pauseRequested: boolean;
}

export interface BackfillStatusDto {
  status: BackfillStatusValue;
  oldestCoveredAt: string | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  synchronizedIntervals: Array<{ from: string; to: string }>;
  lastProcessedChunk: BackfillProcessedChunk | null;
  lastRunErrorCode: string | null;
  /** `null` enquanto nenhum "Completar histórico" jamais foi clicado. */
  job: BackfillJobSummaryDto | null;
}

export interface BackfillChunkResultDto {
  hasMoreHistory: boolean;
  oldestCoveredAt: string;
  ordersFetched: number;
}
