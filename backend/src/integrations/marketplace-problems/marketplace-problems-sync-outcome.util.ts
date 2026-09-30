import type {
  MarketplaceProblemsSyncJobCommitUpdate,
  MarketplaceProblemsSyncJobRow,
} from './marketplace-problems-sync-jobs.types';
import type {
  ProblemsSyncTickReport,
  ProblemsSyncTickThrownCode,
} from './marketplace-problems-sync-tick.service';
import type { ProblemsSyncWorkerConfig } from './marketplace-problems-sync-worker-config.util';
import { WINDOW_SPLIT_OVERLAP_MS } from './mercado-livre-claims-window.util';
import type { ProblemsSyncStopReason } from './mercado-livre-problems-sync.types';

/**
 * Classificação de retry (mesma família de `MarketplaceBackfillWorkerService`):
 * - `SUCCESS`/`YIELD`: `attempt_count = 0` (yield = orçamento do tick acabou,
 *   nunca uma tentativa falha).
 * - `FAILED_AUTH`: autorização terminal — sem retry automático.
 * - `TERMINAL`: exige correção humana — `FAILED`, sem retry automático.
 * - `REQUEUE`: contenção OAuth temporária (conta ocupada/refresh pendente) —
 *   reagenda rápido, NUNCA conta como tentativa.
 * - `RATE_LIMITED`/`TRANSIENT`: incrementa `attempt_count` exatamente uma vez;
 *   ao atingir `maxAttempts` vira `FAILED`.
 */
type OutcomeKind =
  | 'SUCCESS'
  | 'YIELD'
  | 'FAILED_AUTH'
  | 'TERMINAL'
  | 'REQUEUE'
  | 'RATE_LIMITED'
  | 'TRANSIENT';

const THROWN_KIND: Record<ProblemsSyncTickThrownCode, OutcomeKind> = {
  ACCOUNT_NOT_CONNECTED: 'FAILED_AUTH',
  TOKEN_EXPIRED: 'FAILED_AUTH',
  ML_APP_CONFIGURATION_ERROR: 'TERMINAL',
  CREDENTIAL_DECRYPTION_FAILED: 'TERMINAL',
  ACCOUNT_BUSY: 'REQUEUE',
  TOKEN_REFRESH_PENDING: 'REQUEUE',
  SYNC_FAILED: 'TRANSIENT',
};

const STOP_REASON_KIND: Record<ProblemsSyncStopReason, OutcomeKind> = {
  COMPLETED: 'SUCCESS',
  CALL_BUDGET_EXHAUSTED: 'YIELD',
  CLAIM_BUDGET_EXHAUSTED: 'YIELD',
  TERMINAL_AUTH_ERROR: 'FAILED_AUTH',
  RATE_LIMITED: 'RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'TRANSIENT',
  PERSISTENCE_UNAVAILABLE: 'TRANSIENT',
  SEARCH_CONTRACT_ERROR: 'TRANSIENT',
  CORE_COVERAGE_INCOMPLETE: 'TRANSIENT',
  // Nunca fingir cobertura: falha explícita (exige ação humana).
  SAFETY_LIMIT_REACHED: 'TERMINAL',
};

/** Cursor a mais que isto atrás de `now` depois de um tick bem-sucedido = backlog: próximo tick já. */
const BACKLOG_TOLERANCE_MS = 2 * WINDOW_SPLIT_OVERLAP_MS;

function classify(report: ProblemsSyncTickReport): {
  kind: OutcomeKind;
  errorCode: string | null;
} {
  if (report.thrownCode !== null) {
    return {
      kind: THROWN_KIND[report.thrownCode],
      errorCode: report.thrownCode,
    };
  }
  const kind = STOP_REASON_KIND[report.stopReason];
  const isProblem = kind !== 'SUCCESS' && kind !== 'YIELD';
  return { kind, errorCode: isProblem ? report.stopReason : null };
}

/**
 * Traduz o relatório de UM tick na atualização de commit do job. Função pura
 * (relógio e config injetados) — pausa NÃO é tratada aqui: o `commit` do
 * banco converte em `PAUSED` de forma atômica se `pause_requested` estiver
 * marcado. Todo tick preserva o progresso já feito (cursor avançado e
 * contadores), mesmo quando termina em falha.
 */
export function buildCommitUpdate(
  job: MarketplaceProblemsSyncJobRow,
  report: ProblemsSyncTickReport,
  now: Date,
  config: ProblemsSyncWorkerConfig,
): MarketplaceProblemsSyncJobCommitUpdate {
  const { kind, errorCode } = classify(report);
  const windowCursorAt = report.creationCursorAdvancedTo ?? job.windowCursorAt;
  const base = {
    windowCursorAt,
    claimsProcessedDelta: report.claimsProcessed,
    claimsPersistedDelta: report.claimsPersisted,
    claimsFailedDelta: report.claimsFailed,
    callsMadeDelta: report.callsMade,
    lastActivityAt: now,
    // `last_census_at` = último censo COMPLETO e bem-sucedido; qualquer outra
    // coisa (yield, safety limit, erro, falha) mantém o valor anterior (`null`).
    lastCompleteCensusAt: report.censusCompletedInFull ? now : null,
  };
  const at = (ms: number) => new Date(now.getTime() + ms);

  switch (kind) {
    case 'SUCCESS': {
      const backlog =
        now.getTime() - windowCursorAt.getTime() > BACKLOG_TOLERANCE_MS &&
        report.creationCursorAdvancedTo !== null;
      return {
        ...base,
        status: 'RUNNING',
        attemptCount: 0,
        nextAttemptAt: backlog ? now : at(config.syncIntervalMs),
        lastErrorCode: null,
      };
    }
    case 'YIELD':
      // Yield de orçamento (criação ou censo) repete a cada intervalo normal —
      // reagendar imediatamente viraria hot loop permanente, já que o mesmo
      // orçamento nunca comportará a etapa. Só o SUCESSO com cursor atrasado
      // (backlog real, com progresso) agenda o próximo tick imediato.
      return {
        ...base,
        status: 'RUNNING',
        attemptCount: 0,
        nextAttemptAt: at(config.syncIntervalMs),
        lastErrorCode: null,
      };
    case 'FAILED_AUTH':
      return {
        ...base,
        status: 'FAILED_AUTH',
        attemptCount: job.attemptCount,
        nextAttemptAt: now,
        lastErrorCode: errorCode,
      };
    case 'TERMINAL':
      return {
        ...base,
        status: 'FAILED',
        attemptCount: job.attemptCount,
        nextAttemptAt: now,
        lastErrorCode: errorCode,
      };
    case 'REQUEUE':
      return {
        ...base,
        status: 'WAITING_RETRY',
        attemptCount: job.attemptCount,
        nextAttemptAt: at(config.requeueDelayMs),
        lastErrorCode: errorCode,
      };
    case 'RATE_LIMITED':
    case 'TRANSIENT': {
      const attemptCount = job.attemptCount + 1;
      if (attemptCount >= config.maxAttempts) {
        return {
          ...base,
          status: 'FAILED',
          attemptCount,
          nextAttemptAt: now,
          lastErrorCode: errorCode,
        };
      }
      const retryAfter = report.retryAfterMs;
      const delayMs =
        kind === 'RATE_LIMITED'
          ? retryAfter !== null && Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter
            : config.rateLimitBackoffMs
          : Math.min(
              config.retryMaxMs,
              config.retryBaseMs * 2 ** (attemptCount - 1),
            );
      return {
        ...base,
        status: 'WAITING_RETRY',
        attemptCount,
        nextAttemptAt: at(delayMs),
        lastErrorCode: errorCode,
      };
    }
  }
}
