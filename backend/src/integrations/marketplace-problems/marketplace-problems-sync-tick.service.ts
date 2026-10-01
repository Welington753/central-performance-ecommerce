import { Injectable } from '@nestjs/common';
import { MarketplaceProblemsHistoricalBackfillService } from './marketplace-problems-historical-backfill.service';
import type {
  MarketplaceProblemsHistoricalCommit,
  MarketplaceProblemsSyncJobRow,
} from './marketplace-problems-sync-jobs.types';
import type { ProblemsSyncWorkerConfig } from './marketplace-problems-sync-worker-config.util';
import { INCREMENTAL_BACKLOG_TOLERANCE_MS } from './mercado-livre-claims-window.util';
import { MercadoLivreProblemsHistoricalSyncService } from './mercado-livre-problems-historical-sync.service';
import { MercadoLivreProblemsSyncService } from './mercado-livre-problems-sync.service';
import { ProblemsSyncError } from './mercado-livre-problems-sync-preflight.util';
import type {
  ProblemsSyncFailureCode,
  ProblemsSyncResult,
  ProblemsSyncStopReason,
} from './mercado-livre-problems-sync.types';

/** Estouros de orçamento: yield normal, nunca falha. */
const BUDGET_YIELDS: ReadonlySet<ProblemsSyncStopReason> = new Set([
  'CALL_BUDGET_EXHAUSTED',
  'CLAIM_BUDGET_EXHAUSTED',
]);

/** Status consultados pelo censo (um status por chamada de `censusOpenClaims`). */
const CENSUS_STATUSES: readonly string[] = ['opened'];

/** Etapa "de fundo" isolada: devolve o relatório ao estado limpo do incremental. */
function resetStop(report: ProblemsSyncTickReport): void {
  report.stopReason = 'COMPLETED';
  report.retryAfterMs = null;
  report.failureCode = null;
}

export type ProblemsSyncTickConfig = Pick<
  ProblemsSyncWorkerConfig,
  | 'tickMaxClaims'
  | 'tickMaxHttpCalls'
  | 'refreshBatchSize'
  | 'censusIntervalMs'
  | 'quarantineBatchSize'
  | 'backfillWindowMs'
  | 'retryBaseMs'
  | 'retryMaxMs'
>;

/** Código de falha lançada: vocabulário do pré-voo do CP2-B + `SYNC_FAILED` (nunca a mensagem do erro). */
export type ProblemsSyncTickThrownCode =
  ProblemsSyncError['code'] | 'SYNC_FAILED';

export interface ProblemsSyncTickReport {
  /** `stopReason` da última etapa executada (`COMPLETED` se todas completaram/foram puladas). */
  stopReason: ProblemsSyncStopReason;
  retryAfterMs: number | null;
  thrownCode: ProblemsSyncTickThrownCode | null;
  /** Diagnóstico sanitizado da última etapa (operação + natureza do 401/403). */
  failureCode: ProblemsSyncFailureCode | null;
  /** Novo cursor da janela de criação; `null` quando a criação não avançou. */
  creationCursorAdvancedTo: Date | null;
  /**
   * `true` SOMENTE quando o censo completo terminou `COMPLETED` neste tick —
   * única condição que atualiza `last_census_at` ("último censo completo e
   * bem-sucedido"). Yield, safety limit, erro HTTP, falha de core ou de
   * persistência nunca o marcam.
   */
  censusCompletedInFull: boolean;
  /** Progresso do backfill histórico a gravar no commit (CAS); `null` = o tick não o tocou. */
  historical: MarketplaceProblemsHistoricalCommit | null;
  claimsProcessed: number;
  claimsPersisted: number;
  claimsFailed: number;
  callsMade: number;
}

/**
 * Executa UM tick de um job (CP2-C) reaproveitando os 3 métodos públicos do
 * CP2-B, sem duplicar nenhuma regra de cobertura/sobreposição/idempotência:
 * criação -> censo completo -> refresh, com UM orçamento global por tick — chamadas e
 * claims consumidos por uma etapa reduzem o que sobra para as seguintes
 * (nunca reinicia o orçamento por método). Uma etapa que não termine
 * `COMPLETED` encerra o tick (a classificação em retry/yield/falha é do
 * `buildCommitUpdate`), EXCETO o yield de orçamento da criação (pula o censo) e do
 * censo, que seguem para o refresh com o orçamento restante. Nunca abre transação de banco nem lê/grava o job.
 *
 * Depois do incremental (CP4), com o orçamento que SOBRAR e só se as etapas
 * anteriores completaram (sem yield) e o cursor incremental está em dia:
 * 4. retry de um lote pequeno de claims em quarentena; 5. UMA janela do
 * backfill histórico. O incremental nunca espera por essas etapas.
 */
@Injectable()
export class MarketplaceProblemsSyncTickService {
  constructor(
    private readonly syncService: MercadoLivreProblemsSyncService,
    private readonly historicalSync: MercadoLivreProblemsHistoricalSyncService,
    private readonly backfill: MarketplaceProblemsHistoricalBackfillService,
  ) {}

  async runTick(
    job: MarketplaceProblemsSyncJobRow,
    now: Date,
    config: ProblemsSyncTickConfig,
  ): Promise<ProblemsSyncTickReport> {
    const accountId = job.marketplaceAccountId;
    const report: ProblemsSyncTickReport = {
      stopReason: 'COMPLETED',
      retryAfterMs: null,
      thrownCode: null,
      failureCode: null,
      creationCursorAdvancedTo: null,
      censusCompletedInFull: false,
      historical: null,
      claimsProcessed: 0,
      claimsPersisted: 0,
      claimsFailed: 0,
      callsMade: 0,
    };
    let remainingClaims = config.tickMaxClaims;
    let remainingCalls = config.tickMaxHttpCalls;
    const hasBudget = () => remainingClaims >= 1 && remainingCalls >= 1;
    const budget = () => ({
      maxClaims: remainingClaims,
      maxHttpCalls: remainingCalls,
    });
    // Devolve `true` quando a etapa completou e o tick pode seguir.
    const absorb = (result: ProblemsSyncResult): boolean => {
      report.claimsProcessed += result.claimsProcessed;
      report.claimsPersisted += result.claimsPersisted;
      report.claimsFailed += result.claimsFailed;
      report.callsMade += result.httpCallsMade;
      remainingClaims -= result.claimsFound;
      remainingCalls -= result.httpCallsMade;
      report.stopReason = result.stopReason;
      report.retryAfterMs = result.retryAfterMs;
      report.failureCode = result.failureCode;
      return result.stopReason === 'COMPLETED';
    };

    try {
      let pendingYield: ProblemsSyncStopReason | null = null;
      // 1. Criação — sempre primeiro. Cursor >= now (relógio adiantado): pula.
      if (job.windowCursorAt.getTime() < now.getTime()) {
        const creation = await this.syncService.syncCreationWindow(
          accountId,
          { from: job.windowCursorAt, to: now },
          budget(),
        );
        if (!absorb(creation)) {
          // Yield de orçamento da criação: normal (cursor NÃO avança, sem censo
          // — a criação ficou incompleta), mas o refresh ainda usa o que sobrou.
          if (!BUDGET_YIELDS.has(creation.stopReason)) return report;
          pendingYield = creation.stopReason;
        }
        // O CP2-B já aplicou a sobreposição em `nextWindowFrom`; só aceita
        // se for de fato posterior ao cursor atual (nunca regride/repete).
        if (pendingYield === null && creation.nextWindowFrom !== null) {
          const advanced = new Date(creation.nextWindowFrom);
          if (advanced.getTime() > job.windowCursorAt.getTime()) {
            report.creationCursorAdvancedTo = advanced;
          }
        }
      }

      // 2. Censo COMPLETO de abertos — só se houver orçamento e a cadência
      // venceu. `coverageFrom` é SEMPRE `null` (nunca o `window_cursor_at` da
      // janela de criação): sem cobertura alternativa, o CP2-B aplica all-or-nothing — se
      // o censo inteiro não couber no orçamento, NENHUM claim é processado
      // (nem os primeiros, nem só uma janela recente) e nada é declarado
      // coberto. Estouro de orçamento é yield normal: o tick segue para o
      // refresh com o orçamento que realmente restou.
      const censusDue =
        job.lastCompleteCensusAt === null ||
        now.getTime() - job.lastCompleteCensusAt.getTime() >=
          config.censusIntervalMs;
      if (pendingYield === null && censusDue && hasBudget()) {
        let allCompleted = true;
        for (const status of CENSUS_STATUSES) {
          if (!hasBudget()) {
            allCompleted = false;
            break;
          }
          const census = await this.syncService.censusOpenClaims(
            accountId,
            status,
            null,
            budget(),
          );
          if (absorb(census)) continue;
          if (!BUDGET_YIELDS.has(census.stopReason)) return report;
          allCompleted = false;
          pendingYield = census.stopReason;
          break;
        }
        // Só um censo COMPLETO e bem-sucedido marca cobertura.
        report.censusCompletedInFull = allCompleted;
      }

      // 3. Refresh da fila de não-terminais (linhas JÁ conhecidas, ordenadas
      // por `last_checked_at`) — sem cursor persistido. Roda também depois de
      // um yield do censo, com o orçamento restante.
      if (hasBudget()) {
        const refresh = await this.syncService.refreshNonTerminalBatch(
          accountId,
          config.refreshBatchSize,
          budget(),
        );
        // Refresh COMPLETED preserva o stopReason de yield (criação ou censo); qualquer
        // outro resultado do refresh prevalece (falha ou novo yield).
        if (absorb(refresh) && pendingYield !== null) {
          report.stopReason = pendingYield;
        }
      }

      // 4./5. Só com o incremental limpo: nenhum yield, nenhuma falha e cursor
      // em dia (backlog de criação tem prioridade sobre tudo que é "de fundo").
      const creationCursor =
        report.creationCursorAdvancedTo ?? job.windowCursorAt;
      const incrementalClean =
        report.stopReason === 'COMPLETED' &&
        now.getTime() - creationCursor.getTime() <=
          INCREMENTAL_BACKLOG_TOLERANCE_MS;

      // 4. Quarentena: lote pequeno, orçamento restante. Falha (exceto yield)
      // encerra o tick como qualquer outra etapa.
      if (incrementalClean && hasBudget()) {
        const retry = await this.historicalSync.retryQuarantinedClaims(
          accountId,
          config.quarantineBatchSize,
          budget(),
          now,
        );
        if (!absorb(retry)) {
          // Falha por-claim (ex.: 404) nunca derruba o incremental; as demais
          // (auth, rate limit, provedor, persistência) encerram o tick.
          if (retry.stopReason !== 'CORE_COVERAGE_INCOMPLETE') return report;
          resetStop(report);
        }
      }

      // 5. Backfill histórico: uma janela por tick, só com o que sobrou.
      if (incrementalClean && hasBudget()) {
        const step = await this.backfill.run(
          job,
          now,
          budget(),
          config.backfillWindowMs,
          { baseMs: config.retryBaseMs, maxMs: config.retryMaxMs },
        );
        report.historical = step.commit;
        if (step.result !== null) {
          const proceeds = absorb(step.result);
          // Yield de orçamento, limite de segurança e claim problemático só do
          // histórico nunca viram falha do job incremental (o cursor histórico
          // não avança e o código fica em `historical_last_error_code`).
          const isolated =
            step.terminalFailure ||
            BUDGET_YIELDS.has(step.result.stopReason) ||
            step.result.stopReason === 'CORE_COVERAGE_INCOMPLETE';
          if (!proceeds && isolated) resetStop(report);
        }
      }
    } catch (error) {
      report.thrownCode =
        error instanceof ProblemsSyncError ? error.code : 'SYNC_FAILED';
    }
    return report;
  }
}
