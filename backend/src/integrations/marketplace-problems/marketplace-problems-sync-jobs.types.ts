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

/**
 * Estado do backfill histórico (colunas `historical_*` do MESMO job):
 * - `RUNNING`: elegível; anda para trás a cada tick com o orçamento que sobrar.
 * - `PAUSED`: pausa explícita do histórico (o incremental segue).
 * - `COMPLETED`: o cursor alcançou o alvo; só então o histórico é "completo".
 * - `NO_TARGET`: a conta não tem pedido persistido — nenhuma data é inventada.
 * - `FAILED`: limite de segurança de uma janela; exige retomada explícita.
 */
export type MarketplaceProblemsHistoricalStatus =
  'RUNNING' | 'PAUSED' | 'COMPLETED' | 'NO_TARGET' | 'FAILED';

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
  /** Cursor do histórico = menor data JÁ coberta (anda para trás). */
  historicalCoveredFrom: Date;
  /** Data do pedido persistido mais antigo da conta (`null` = sem alvo). */
  historicalTargetFrom: Date | null;
  historicalStatus: MarketplaceProblemsHistoricalStatus;
  historicalCompletedAt: Date | null;
  historicalLastErrorCode: string | null;
  /** Falhas consecutivas por-claim do histórico (espera durável; 0 = sem espera). */
  historicalAttemptCount: number;
  /** O histórico não busca antes disto (backoff durável); `null` = sem espera. */
  historicalNextAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Progresso do histórico gravado no MESMO commit (CAS) do tick. Campo `null` =
 * mantém o valor atual; `errorCode`, `attemptCount` e `nextAttemptAt` são
 * explícitos (`null`/0 limpam a espera).
 */
export interface MarketplaceProblemsHistoricalCommit {
  coveredFrom: Date | null;
  targetFrom: Date | null;
  status: MarketplaceProblemsHistoricalStatus | null;
  completedAt: Date | null;
  errorCode: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
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
  /** `null` = o tick não tocou no histórico (nada é alterado). */
  historical: MarketplaceProblemsHistoricalCommit | null;
}
