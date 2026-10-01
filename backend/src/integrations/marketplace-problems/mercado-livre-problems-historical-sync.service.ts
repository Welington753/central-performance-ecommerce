import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import {
  MarketplaceProblemClaimQuarantineRepository,
  type DueQuarantinedClaim,
} from './marketplace-problem-claim-quarantine.repository';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import {
  assertPositiveIntegerSync,
  assertValidSyncDate,
  emptyProblemsSyncCounters,
  zeroProblemsSyncResult,
} from './mercado-livre-claim-enrichment.util';
import {
  commitSafeSubWindow,
  type WindowRange,
} from './mercado-livre-claims-window.util';
import { MercadoLivreProblemsCandidateProcessor } from './mercado-livre-problems-candidate-processor';
import { ProblemsSyncLimits } from './mercado-livre-problems-sync-limits';
import { MercadoLivreProblemsSyncPreflight } from './mercado-livre-problems-sync-preflight.util';
import {
  assembleResult,
  resultFromOutcome,
  resultFromUncommittedWindow,
} from './mercado-livre-problems-sync-result.util';
import { buildCreationWindowFetchers } from './mercado-livre-problems-window-fetchers.util';
import type {
  ProblemsSyncBudget,
  ProblemsSyncResult,
} from './mercado-livre-problems-sync.types';

/**
 * Passos "de fundo" da sincronização de Problemas — nunca a descoberta
 * incremental (`MercadoLivreProblemsSyncService`), que continua prioritária:
 * - `syncHistoricalWindow`: UMA janela do backfill histórico, `opened` +
 *   `closed`, divisão automática PARA TRÁS (`direction: 'backward'`).
 * - `retryQuarantinedClaims`: novo `fetch_core` de um lote pequeno de claims
 *   em quarentena (403 anterior).
 * Reaproveitam o MESMO processador por claim (upsert idempotente por
 * `(conta, claim)`) e a MESMA reserva de orçamento. Nunca abrem transação
 * durante HTTP.
 */
@Injectable()
export class MercadoLivreProblemsHistoricalSyncService {
  private readonly limits: ProblemsSyncLimits;
  private readonly processor: MercadoLivreProblemsCandidateProcessor;

  constructor(
    private readonly preflight: MercadoLivreProblemsSyncPreflight,
    private readonly httpClient: MercadoLivreClaimsHttpClient,
    reasonCache: MarketplaceProblemReasonsCacheRepository,
    persistence: MarketplaceProblemsPersistenceService,
    private readonly quarantine: MarketplaceProblemClaimQuarantineRepository,
    configService: ConfigService,
  ) {
    this.limits = new ProblemsSyncLimits(configService);
    this.processor = new MercadoLivreProblemsCandidateProcessor(
      httpClient,
      reasonCache,
      persistence,
      quarantine,
      this.limits,
    );
  }

  /**
   * Em `COMPLETED`, `nextWindowFrom` é o NOVO limite inferior coberto (o
   * `from` da sub-janela commitada): tudo `>=` esse instante, até o início da
   * cobertura anterior, foi varrido. Qualquer outro `stopReason` não avança nada.
   */
  async syncHistoricalWindow(
    accountId: string,
    window: WindowRange,
    budget: ProblemsSyncBudget = {},
  ): Promise<ProblemsSyncResult> {
    assertValidSyncDate(window.from, 'window.from');
    assertValidSyncDate(window.to, 'window.to');
    if (window.from.getTime() >= window.to.getTime()) {
      throw new Error('window.from precisa ser anterior a window.to.');
    }
    const maxClaims = this.limits.resolveMaxClaims(budget.maxClaims);
    const maxHttpCalls = this.limits.resolveMaxHttpCalls(budget.maxHttpCalls);
    this.limits.assertMinSplitInvariant();

    const { accessToken, externalSellerId } =
      await this.preflight.resolveAccountAndToken(accountId);

    const commit = await commitSafeSubWindow(
      buildCreationWindowFetchers(
        this.httpClient,
        accessToken,
        externalSellerId,
      ),
      window,
      maxClaims,
      maxHttpCalls,
      this.limits.minSplitMs,
      'backward',
    );
    if (commit.kind !== 'committed') {
      return resultFromUncommittedWindow(
        commit,
        window,
        null,
        commit.callsUsed,
      );
    }
    const outcome = await this.processor.processCandidates(
      commit.ids,
      accessToken,
      maxHttpCalls - commit.callsUsed,
      accountId,
      commit.dates,
    );
    return {
      ...resultFromOutcome(outcome),
      coverageFrom: null,
      claimsFound: commit.ids.length,
      httpCallsMade: commit.callsUsed + outcome.callsUsed,
      pagesFetched: commit.callsUsed,
      nextWindowFrom:
        outcome.stopReason === 'COMPLETED'
          ? commit.range.from.toISOString()
          : null,
    };
  }

  /** Reprocessa só os claims em quarentena com tentativa vencida (lote e orçamento limitados). */
  async retryQuarantinedClaims(
    accountId: string,
    batchSize: number,
    budget: ProblemsSyncBudget,
    now: Date,
  ): Promise<ProblemsSyncResult> {
    assertPositiveIntegerSync(batchSize, 'batchSize');
    const maxClaims = this.limits.resolveMaxClaims(budget.maxClaims);
    const maxHttpCalls = this.limits.resolveMaxHttpCalls(budget.maxHttpCalls);
    const effectiveLimit = Math.min(batchSize, maxClaims, maxHttpCalls);

    let due: DueQuarantinedClaim[];
    try {
      due = await this.quarantine.findDue(accountId, effectiveLimit, now);
    } catch {
      return zeroProblemsSyncResult(
        'PERSISTENCE_UNAVAILABLE',
        null,
        0,
        0,
        null,
        null,
      );
    }
    const ids = due.map((claim) => claim.externalClaimId);
    if (ids.length === 0) {
      return assembleResult(
        {
          stopReason: 'COMPLETED',
          retryAfterMs: null,
          failureCode: null,
          callsUsed: 0,
          counters: emptyProblemsSyncCounters(),
        },
        0,
        0,
        null,
        null,
      );
    }
    const { accessToken } =
      await this.preflight.resolveAccountAndToken(accountId);
    const outcome = await this.processor.processCandidates(
      ids,
      accessToken,
      maxHttpCalls,
      accountId,
      new Map(
        due.flatMap((claim): Array<[string, Date]> =>
          claim.claimDateCreated
            ? [[claim.externalClaimId, claim.claimDateCreated]]
            : [],
        ),
      ),
    );
    return assembleResult(outcome, ids.length, 0, null, null);
  }
}
