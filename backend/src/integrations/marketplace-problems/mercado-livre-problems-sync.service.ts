import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import { MarketplaceProblemClaimQuarantineRepository } from './marketplace-problem-claim-quarantine.repository';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import {
  toSearchPageOutcome,
  assertValidSyncDate,
  assertPositiveIntegerSync,
  zeroProblemsSyncResult,
} from './mercado-livre-claim-enrichment.util';
import {
  commitSafeSubWindow,
  computeAdvancedWindowFrom,
  type FetchWindowPage,
  type WindowRange,
} from './mercado-livre-claims-window.util';
import { buildCreationWindowFetchers } from './mercado-livre-problems-window-fetchers.util';
import { MercadoLivreProblemsSyncPreflight } from './mercado-livre-problems-sync-preflight.util';
import { MercadoLivreProblemsCandidateProcessor } from './mercado-livre-problems-candidate-processor';
import {
  MAX_OFFSET_PLUS_LIMIT,
  ProblemsSyncLimits,
  SEARCH_PAGE_LIMIT,
} from './mercado-livre-problems-sync-limits';
import {
  assembleResult,
  resultFromCensusSearchFailure,
  resultFromOutcome,
  resultFromUncommittedWindow,
  type WindowCommit,
} from './mercado-livre-problems-sync-result.util';
import type {
  ProblemsSyncBudget,
  ProblemsSyncResult,
  ProblemsSyncStopReason,
} from './mercado-livre-problems-sync.types';

export { ProblemsSyncError } from './mercado-livre-problems-sync-preflight.util';
export type {
  ProblemsSyncBudget,
  ProblemsSyncResult,
  ProblemsSyncStopReason,
} from './mercado-livre-problems-sync.types';

export { CREATION_WINDOW_STATUSES } from './mercado-livre-problems-window-fetchers.util';

/**
 * Orquestração de sincronização do Mercado Livre Claims (CP2-B) — descobre
 * quais claims existem/mudaram e alimenta a persistência do CP2-A
 * (`MarketplaceProblemsPersistenceService.upsertProblem`). Sem job/lease/
 * worker (CP2-C), sem controller/frontend, nunca abre transação durante uma
 * chamada HTTP (as chamadas de rede de um claim terminam antes de
 * `upsertProblem` começar).
 */
@Injectable()
export class MercadoLivreProblemsSyncService {
  private readonly limits: ProblemsSyncLimits;
  private readonly processor: MercadoLivreProblemsCandidateProcessor;

  constructor(
    private readonly preflight: MercadoLivreProblemsSyncPreflight,
    private readonly httpClient: MercadoLivreClaimsHttpClient,
    reasonCache: MarketplaceProblemReasonsCacheRepository,
    private readonly persistence: MarketplaceProblemsPersistenceService,
    quarantine: MarketplaceProblemClaimQuarantineRepository,
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

  async syncCreationWindow(
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

    const fetchPages = buildCreationWindowFetchers(
      this.httpClient,
      accessToken,
      externalSellerId,
    );

    const commit = await commitSafeSubWindow(
      fetchPages,
      window,
      maxClaims,
      maxHttpCalls,
      this.limits.minSplitMs,
    );

    return this.finishFromWindowCommit(
      commit,
      window,
      accessToken,
      accountId,
      null,
      maxHttpCalls,
    );
  }

  async censusOpenClaims(
    accountId: string,
    status: string,
    coverageFrom: Date | null,
    budget: ProblemsSyncBudget = {},
  ): Promise<ProblemsSyncResult> {
    if (typeof status !== 'string' || status.length === 0) {
      throw new Error('status precisa ser uma string não vazia.');
    }
    if (coverageFrom !== null) {
      assertValidSyncDate(coverageFrom, 'coverageFrom');
    }
    const maxClaims = this.limits.resolveMaxClaims(budget.maxClaims);
    const maxHttpCalls = this.limits.resolveMaxHttpCalls(budget.maxHttpCalls);
    this.limits.assertMinSplitInvariant();

    const { accessToken, externalSellerId } =
      await this.preflight.resolveAccountAndToken(accountId);

    const probeRaw = await this.httpClient.searchClaims({
      accessToken,
      sellerUserId: externalSellerId,
      status,
      offset: 0,
      limit: SEARCH_PAGE_LIMIT,
      operation: 'search_census',
    });
    let callsUsed = 1;
    const probe = toSearchPageOutcome(probeRaw);
    if (probe.kind !== 'success') {
      return resultFromCensusSearchFailure(probeRaw, callsUsed);
    }

    const total = probe.data.total;
    const pagesNeeded = total > 0 ? Math.ceil(total / SEARCH_PAGE_LIMIT) : 0;
    const additional = Math.max(pagesNeeded - 1, 0);
    const fitsCap = total <= MAX_OFFSET_PLUS_LIMIT - SEARCH_PAGE_LIMIT;
    const fitsClaimBudget = total <= maxClaims;
    const fitsReservation = additional + total <= maxHttpCalls - callsUsed;

    if (fitsCap && fitsClaimBudget && fitsReservation) {
      const ids = new Set<string>(probe.data.ids);
      const dates = new Map<string, Date>(probe.data.dates ?? []);
      let offset = SEARCH_PAGE_LIMIT;
      while (offset < total) {
        const pageRaw = await this.httpClient.searchClaims({
          accessToken,
          sellerUserId: externalSellerId,
          status,
          offset,
          limit: SEARCH_PAGE_LIMIT,
          operation: 'search_census',
        });
        callsUsed += 1;
        const page = toSearchPageOutcome(pageRaw);
        if (page.kind !== 'success') {
          return resultFromCensusSearchFailure(pageRaw, callsUsed);
        }
        for (const id of page.data.ids) ids.add(id);
        page.data.dates?.forEach((date, id) => dates.set(id, date));
        offset += SEARCH_PAGE_LIMIT;
      }
      const idsArr = [...ids];
      const outcome = await this.processor.processCandidates(
        idsArr,
        accessToken,
        maxHttpCalls - callsUsed,
        accountId,
        dates,
      );
      return assembleResult(outcome, idsArr.length, callsUsed, null, null);
    }

    if (coverageFrom === null) {
      const stopReason: ProblemsSyncStopReason = !fitsCap
        ? 'SAFETY_LIMIT_REACHED'
        : !fitsClaimBudget
          ? 'CLAIM_BUDGET_EXHAUSTED'
          : 'CALL_BUDGET_EXHAUSTED';
      return zeroProblemsSyncResult(
        stopReason,
        null,
        callsUsed,
        callsUsed,
        null,
        null,
      );
    }

    const now = new Date();
    const fetchPageWithStatus: FetchWindowPage = async (
      range,
      offset,
      limit,
    ) => {
      const outcome = await this.httpClient.searchClaims({
        accessToken,
        sellerUserId: externalSellerId,
        status,
        dateRange: { after: range.from, before: range.to },
        offset,
        limit,
        operation: 'search_census',
      });
      return toSearchPageOutcome(outcome);
    };
    const commit = await commitSafeSubWindow(
      fetchPageWithStatus,
      { from: coverageFrom, to: now },
      maxClaims,
      maxHttpCalls - callsUsed,
      this.limits.minSplitMs,
    );
    return this.finishFromWindowCommit(
      commit,
      { from: coverageFrom, to: now },
      accessToken,
      accountId,
      coverageFrom.toISOString(),
      maxHttpCalls,
      callsUsed,
    );
  }

  async refreshNonTerminalBatch(
    accountId: string,
    batchSize: number,
    budget: ProblemsSyncBudget = {},
  ): Promise<ProblemsSyncResult> {
    assertPositiveIntegerSync(batchSize, 'batchSize');
    const maxClaims = this.limits.resolveMaxClaims(budget.maxClaims);
    const maxHttpCalls = this.limits.resolveMaxHttpCalls(budget.maxHttpCalls);
    const effectiveLimit = Math.min(batchSize, maxClaims, maxHttpCalls);

    const { accessToken } =
      await this.preflight.resolveAccountAndToken(accountId);

    let rows: Array<{ externalClaimId: string; dateCreated?: Date }>;
    try {
      rows = await this.persistence.findProblemsNeedingRefresh(
        accountId,
        effectiveLimit,
      );
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

    const ids = rows.map((row) => row.externalClaimId);
    // A data do problema já persistido acompanha uma eventual quarentena.
    const dates = new Map<string, Date>(
      rows.flatMap((row): Array<[string, Date]> =>
        row.dateCreated instanceof Date
          ? [[row.externalClaimId, row.dateCreated]]
          : [],
      ),
    );
    const outcome = await this.processor.processCandidates(
      ids,
      accessToken,
      maxHttpCalls,
      accountId,
      dates,
    );
    return assembleResult(outcome, ids.length, 0, null, null);
  }

  private async finishFromWindowCommit(
    commit: WindowCommit,
    window: WindowRange,
    accessToken: string,
    accountId: string,
    coverageFrom: string | null,
    maxHttpCalls: number,
    extraCallsUsed = 0,
  ): Promise<ProblemsSyncResult> {
    if (commit.kind === 'committed') {
      // `commitSafeSubWindow` já garantiu, por construção, que o que sobra
      // aqui é >= commit.ids.length (reserva de 1 fetchClaim por candidato).
      const remainingForProcessing =
        maxHttpCalls - extraCallsUsed - commit.callsUsed;
      const outcome = await this.processor.processCandidates(
        commit.ids,
        accessToken,
        remainingForProcessing,
        accountId,
        commit.dates,
      );
      return {
        ...resultFromOutcome(outcome),
        coverageFrom,
        claimsFound: commit.ids.length,
        httpCallsMade: extraCallsUsed + commit.callsUsed + outcome.callsUsed,
        pagesFetched: commit.callsUsed,
        nextWindowFrom:
          outcome.stopReason === 'COMPLETED'
            ? computeAdvancedWindowFrom(commit.range.to, window.from)
            : window.from.toISOString(),
      };
    }

    return resultFromUncommittedWindow(
      commit,
      window,
      coverageFrom,
      extraCallsUsed + commit.callsUsed,
    );
  }
}
