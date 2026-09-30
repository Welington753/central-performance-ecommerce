/**
 * Estados do job de sincronização incremental de "Problemas" (CP2-C). Sem
 * `COMPLETED`: a sincronização é perene. Vocabulário do projeto
 * (`ml_logistics_reclassification_jobs`/backfill):
 * - `RUNNING`: elegível a claim quando `next_attempt_at <= now()` e sem lease
 *   ativo (também é o estado "aguardando próximo ciclo").
 * - `WAITING_RETRY`: falha transitória, aguardando o backoff.
 * - `PAUSED`: pausado por pedido explícito.
 * - `FAILED_AUTH`: autorização terminal — exige reconexão + retomada.
 * - `FAILED`: limite de tentativas, `SAFETY_LIMIT_REACHED` ou configuração
 *   terminal — exige retomada explícita.
 */
export type MarketplaceProblemsSyncJobStatus =
  'RUNNING' | 'PAUSED' | 'WAITING_RETRY' | 'FAILED' | 'FAILED_AUTH';

export interface MarketplaceProblemsSyncJobRow {
  id: string;
  marketplaceAccountId: string;
  status: MarketplaceProblemsSyncJobStatus;
  windowCursorAt: Date;
  claimsProcessedCount: number;
  claimsPersistedCount: number;
  claimsFailedCount: number;
  callsMadeCount: number;
  attemptCount: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  version: number;
  lastActivityAt: Date | null;
  lastCompleteCensusAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketplaceProblemsSyncJobCommitUpdate {
  status: MarketplaceProblemsSyncJobStatus;
  /** Valor EXPLÍCITO e definitivo (o chamador ecoa o cursor anterior quando a etapa de criação não avançou). */
  windowCursorAt: Date;
  claimsProcessedDelta: number;
  claimsPersistedDelta: number;
  claimsFailedDelta: number;
  callsMadeDelta: number;
  attemptCount: number;
  nextAttemptAt: Date;
  lastActivityAt: Date;
  lastErrorCode: string | null;
  /** `null` mantém o valor atual (censo não rodou neste tick). */
  lastCompleteCensusAt: Date | null;
}
