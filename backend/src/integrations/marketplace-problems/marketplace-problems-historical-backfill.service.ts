import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  MarketplaceProblemsHistoricalCommit,
  MarketplaceProblemsSyncJobRow,
} from './marketplace-problems-sync-jobs.types';
import { WINDOW_SPLIT_OVERLAP_MS } from './mercado-livre-claims-window.util';
import { MercadoLivreProblemsHistoricalSyncService } from './mercado-livre-problems-historical-sync.service';
import type {
  ProblemsSyncBudget,
  ProblemsSyncResult,
} from './mercado-livre-problems-sync.types';

/** Estados em que o histórico NÃO roda (pausa explícita ou falha que exige retomada). */
const IDLE_STATUSES: ReadonlySet<string> = new Set(['PAUSED', 'FAILED']);

/** Estouros de orçamento: yield normal, nunca erro. */
const BUDGET_YIELDS: ReadonlySet<string> = new Set([
  'CALL_BUDGET_EXHAUSTED',
  'CLAIM_BUDGET_EXHAUSTED',
]);

export interface HistoricalStepReport {
  /** Resultado da janela buscada; `null` quando nenhuma chamada foi feita. */
  result: ProblemsSyncResult | null;
  /** Progresso a gravar no commit (CAS); `null` = nada mudou. */
  commit: MarketplaceProblemsHistoricalCommit | null;
  /** `true` quando a janela falhou de forma TERMINAL só do histórico (não derruba o incremental). */
  terminalFailure: boolean;
}

/** Backoff durável de uma janela que falha por motivo por-claim (nunca retry a cada tick). */
export interface HistoricalRetryPolicy {
  baseMs: number;
  maxMs: number;
}

const idle = (): HistoricalStepReport => ({
  result: null,
  commit: null,
  terminalFailure: false,
});

/**
 * Passo de backfill histórico de UM tick (CP4). Anda para trás a partir do
 * início da cobertura incremental até a data do pedido persistido mais antigo
 * da conta (`MIN(marketplace_orders.date_created)`) — nunca inventa data: sem
 * pedido, o histórico fica `NO_TARGET`. Uma janela por tick, `opened` +
 * `closed`, com divisão automática; só avança o cursor (`coveredFrom`) quando
 * a janela inteira foi buscada E processada. Não grava nada: devolve o
 * progresso para o `commit` do tick (mesmo CAS do incremental).
 *
 * O alvo é recalculado UMA vez por chamada (uma por tick/conta) — inclusive
 * para um histórico `COMPLETED`: se aparecer pedido mais antigo que o alvo
 * gravado, o histórico REABRE (alvo atualizado, cursor preservado, nenhum
 * problema apagado, incremental intocado) e volta a andar para trás.
 */
@Injectable()
export class MarketplaceProblemsHistoricalBackfillService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly historicalSync: MercadoLivreProblemsHistoricalSyncService,
  ) {}

  async run(
    job: MarketplaceProblemsSyncJobRow,
    now: Date,
    budget: Required<ProblemsSyncBudget>,
    windowMs: number,
    retry: HistoricalRetryPolicy,
  ): Promise<HistoricalStepReport> {
    if (IDLE_STATUSES.has(job.historicalStatus)) return idle();
    // Espera durável de uma janela que falhou por motivo por-claim.
    if (
      job.historicalNextAttemptAt !== null &&
      job.historicalNextAttemptAt.getTime() > now.getTime()
    ) {
      return idle();
    }

    const target = await this.findOldestOrderDate(job.marketplaceAccountId);
    const completed = job.historicalStatus === 'COMPLETED';
    if (target === null) {
      // Sem pedido persistido: nenhuma data é inventada; reavaliado a cada tick.
      return completed
        ? idle()
        : { ...idle(), commit: this.commit({ status: 'NO_TARGET' }) };
    }
    if (
      completed &&
      job.historicalTargetFrom !== null &&
      target.getTime() >= job.historicalTargetFrom.getTime()
    ) {
      return idle(); // continua completo: nenhum pedido mais antigo apareceu
    }

    const coveredFrom = job.historicalCoveredFrom;
    if (coveredFrom.getTime() <= target.getTime()) {
      // Nada anterior ao início da cobertura atual a buscar.
      return {
        ...idle(),
        commit: this.commit({
          status: 'COMPLETED',
          targetFrom: target,
          completedAt: now,
        }),
      };
    }

    const to = new Date(coveredFrom.getTime() + WINDOW_SPLIT_OVERLAP_MS);
    const from = new Date(
      Math.max(target.getTime(), coveredFrom.getTime() - windowMs),
    );
    const result = await this.historicalSync.syncHistoricalWindow(
      job.marketplaceAccountId,
      { from, to },
      budget,
    );

    if (result.stopReason !== 'COMPLETED' || result.nextWindowFrom === null) {
      // Yield de orçamento não é erro; qualquer outra interrupção deixa o
      // cursor onde estava e registra o código (nunca mensagem).
      const isYield = BUDGET_YIELDS.has(result.stopReason);
      const terminalFailure = result.stopReason === 'SAFETY_LIMIT_REACHED';
      // Falha por-claim (ex.: `invalid_response`): o tick a isola do job
      // incremental, então a espera é do próprio histórico (backoff
      // exponencial DURÁVEL — nunca retry a cada tick).
      const perClaim = result.stopReason === 'CORE_COVERAGE_INCOMPLETE';
      const attemptCount = perClaim ? job.historicalAttemptCount + 1 : 0;
      return {
        result,
        commit: this.commit({
          status: terminalFailure ? 'FAILED' : 'RUNNING',
          targetFrom: target,
          errorCode: isYield ? null : (result.failureCode ?? result.stopReason),
          attemptCount,
          nextAttemptAt: perClaim
            ? new Date(
                now.getTime() +
                  Math.min(
                    retry.maxMs,
                    retry.baseMs * 2 ** Math.min(attemptCount - 1, 20),
                  ),
              )
            : null,
        }),
        terminalFailure,
      };
    }

    const newCoveredFrom = new Date(result.nextWindowFrom);
    // Defensivo: sem avanço real o cursor nunca é gravado.
    if (newCoveredFrom.getTime() >= coveredFrom.getTime()) {
      return {
        result,
        commit: this.commit({ status: 'RUNNING', targetFrom: target }),
        terminalFailure: false,
      };
    }
    const done = newCoveredFrom.getTime() <= target.getTime();
    return {
      result,
      commit: this.commit({
        status: done ? 'COMPLETED' : 'RUNNING',
        coveredFrom: newCoveredFrom,
        targetFrom: target,
        completedAt: done ? now : null,
      }),
      terminalFailure: false,
    };
  }

  private commit(
    fields: Partial<MarketplaceProblemsHistoricalCommit>,
  ): MarketplaceProblemsHistoricalCommit {
    return {
      coveredFrom: null,
      targetFrom: null,
      status: null,
      completedAt: null,
      errorCode: null,
      attemptCount: 0,
      nextAttemptAt: null,
      ...fields,
    };
  }

  private async findOldestOrderDate(accountId: string): Promise<Date | null> {
    const [row] = await this.dataSource.query<Array<{ oldest: Date | null }>>(
      `SELECT min(date_created) AS oldest
         FROM marketplace_orders WHERE marketplace_account_id = $1`,
      [accountId],
    );
    return row?.oldest ?? null;
  }
}
