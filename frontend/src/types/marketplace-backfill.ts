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

export interface BackfillStatusDto {
  status: BackfillStatusValue;
  oldestCoveredAt: string | null;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  synchronizedIntervals: Array<{ from: string; to: string }>;
  lastProcessedChunk: BackfillProcessedChunk | null;
  lastRunErrorCode: string | null;
}

export interface BackfillChunkResultDto {
  hasMoreHistory: boolean;
  oldestCoveredAt: string;
  ordersFetched: number;
}
