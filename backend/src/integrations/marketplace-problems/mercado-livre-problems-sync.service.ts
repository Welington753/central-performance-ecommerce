import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../contracts/marketplace.enum';
import { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import type { RawClaimReputationImpact } from '../mercado-livre-claims/mercado-livre-claim-reputation-response';
import type { RawClaimDetailInfo } from '../mercado-livre-claims/mercado-livre-claim-detail-response';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import {
  mapClaimToProblemInput,
  type FetchOutcome,
  type ProblemActionInput,
} from './mercado-livre-claim-to-problem.mapper';
import {
  classifyClaimsHttpOutcome,
  classifySearchOutcome,
  flattenDetailActions,
  abortFrom,
  stopReasonFromSearchClassification,
  toSearchPageOutcome,
  assertValidSyncDate,
  assertPositiveIntegerSync,
  zeroProblemsSyncResult,
  emptyProblemsSyncCounters,
  type ProcessCandidatesOutcome,
} from './mercado-livre-claim-enrichment.util';
import {
  commitSafeSubWindow,
  computeAdvancedWindowFrom,
  WINDOW_SPLIT_OVERLAP_MS,
  type FetchWindowPage,
  type WindowRange,
} from './mercado-livre-claims-window.util';
import { MercadoLivreProblemsSyncPreflight } from './mercado-livre-problems-sync-preflight.util';

export { ProblemsSyncError } from './mercado-livre-problems-sync-preflight.util';

export interface ProblemsSyncBudget {
  maxClaims?: number;
  maxHttpCalls?: number;
}

export type ProblemsSyncStopReason =
  | 'COMPLETED'
  | 'CORE_COVERAGE_INCOMPLETE'
  | 'CLAIM_BUDGET_EXHAUSTED'
  | 'CALL_BUDGET_EXHAUSTED'
  | 'SAFETY_LIMIT_REACHED'
  | 'SEARCH_CONTRACT_ERROR'
  | 'TERMINAL_AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PERSISTENCE_UNAVAILABLE';

export interface ProblemsSyncResult {
  complete: boolean;
  stopReason: ProblemsSyncStopReason;
  retryAfterMs: number | null;
  coverageFrom: string | null;
  claimsFound: number;
  claimsProcessed: number;
  claimsCoreCovered: number;
  claimsPersisted: number;
  claimsPreserved: number;
  claimsFailed: number;
  detailFailures: number;
  reputationFailures: number;
  reasonLookupFailures: number;
  reasonCacheRefreshed: number;
  httpCallsMade: number;
  pagesFetched: number;
  nextWindowFrom: string | null;
}

const DEFAULT_MAX_CLAIMS = 200;
const HARD_MAX_CLAIMS = 2000;
const DEFAULT_MAX_HTTP_CALLS = 800;
const HARD_MAX_HTTP_CALLS = 5000;
// Bem acima de 2 * WINDOW_SPLIT_OVERLAP_MS (2000ms) — a recursão de divisão
// de `commitSafeSubWindow` converge para esse ponto fixo, nunca abaixo dele.
const DEFAULT_MIN_SPLIT_MS = 5 * 60 * 1000;
const DEFAULT_REASON_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_PAGE_LIMIT = 100;
const MAX_OFFSET_PLUS_LIMIT = 10000;

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
  constructor(
    private readonly preflight: MercadoLivreProblemsSyncPreflight,
    private readonly httpClient: MercadoLivreClaimsHttpClient,
    private readonly reasonCache: MarketplaceProblemReasonsCacheRepository,
    private readonly persistence: MarketplaceProblemsPersistenceService,
    private readonly configService: ConfigService,
  ) {}

  private get minSplitMs(): number {
    const configured = this.configService.get<number>(
      'PROBLEMS_SYNC_MIN_WINDOW_SPLIT_MS',
      DEFAULT_MIN_SPLIT_MS,
    );
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_MIN_SPLIT_MS;
  }

  private get reasonCacheTtlMs(): number {
    const configured = this.configService.get<number>(
      'PROBLEMS_SYNC_REASON_CACHE_TTL_MS',
      DEFAULT_REASON_CACHE_TTL_MS,
    );
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_REASON_CACHE_TTL_MS;
  }

  private resolveMaxClaims(value: number | undefined): number {
    if (value === undefined) {
      return this.configService.get<number>(
        'PROBLEMS_SYNC_MAX_CLAIMS_PER_RUN',
        DEFAULT_MAX_CLAIMS,
      );
    }
    assertPositiveIntegerSync(value, 'budget.maxClaims');
    return Math.min(value, HARD_MAX_CLAIMS);
  }

  private resolveMaxHttpCalls(value: number | undefined): number {
    if (value === undefined) {
      return this.configService.get<number>(
        'PROBLEMS_SYNC_MAX_HTTP_CALLS_PER_RUN',
        DEFAULT_MAX_HTTP_CALLS,
      );
    }
    assertPositiveIntegerSync(value, 'budget.maxHttpCalls');
    return Math.min(value, HARD_MAX_HTTP_CALLS);
  }

  private assertMinSplitInvariant(): void {
    if (this.minSplitMs <= 2 * WINDOW_SPLIT_OVERLAP_MS) {
      throw new Error(
        'minSplitMs precisa ser maior que 2 * WINDOW_SPLIT_OVERLAP_MS.',
      );
    }
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
    const maxClaims = this.resolveMaxClaims(budget.maxClaims);
    const maxHttpCalls = this.resolveMaxHttpCalls(budget.maxHttpCalls);
    this.assertMinSplitInvariant();

    const { accessToken, externalSellerId } =
      await this.preflight.resolveAccountAndToken(accountId);

    const fetchPage: FetchWindowPage = async (range, offset, limit) => {
      const outcome = await this.httpClient.searchClaims({
        accessToken,
        sellerUserId: externalSellerId,
        dateRange: { after: range.from, before: range.to },
        offset,
        limit,
      });
      return toSearchPageOutcome(outcome);
    };

    const commit = await commitSafeSubWindow(
      fetchPage,
      window,
      maxClaims,
      maxHttpCalls,
      this.minSplitMs,
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
    const maxClaims = this.resolveMaxClaims(budget.maxClaims);
    const maxHttpCalls = this.resolveMaxHttpCalls(budget.maxHttpCalls);
    this.assertMinSplitInvariant();

    const { accessToken, externalSellerId } =
      await this.preflight.resolveAccountAndToken(accountId);

    const probeRaw = await this.httpClient.searchClaims({
      accessToken,
      sellerUserId: externalSellerId,
      status,
      offset: 0,
      limit: SEARCH_PAGE_LIMIT,
    });
    let callsUsed = 1;
    const probe = toSearchPageOutcome(probeRaw);
    if (probe.kind !== 'success') {
      const { stopReason, retryAfterMs } = stopReasonFromSearchClassification(
        classifySearchOutcome(probeRaw),
      );
      return zeroProblemsSyncResult(
        stopReason,
        retryAfterMs,
        callsUsed,
        callsUsed,
        null,
        null,
      );
    }

    const total = probe.data.total;
    const pagesNeeded = total > 0 ? Math.ceil(total / SEARCH_PAGE_LIMIT) : 0;
    const additional = Math.max(pagesNeeded - 1, 0);
    const fitsCap = total <= MAX_OFFSET_PLUS_LIMIT - SEARCH_PAGE_LIMIT;
    const fitsClaimBudget = total <= maxClaims;
    const fitsReservation = additional + total <= maxHttpCalls - callsUsed;

    if (fitsCap && fitsClaimBudget && fitsReservation) {
      const ids = new Set<string>(probe.data.ids);
      let offset = SEARCH_PAGE_LIMIT;
      while (offset < total) {
        const pageRaw = await this.httpClient.searchClaims({
          accessToken,
          sellerUserId: externalSellerId,
          status,
          offset,
          limit: SEARCH_PAGE_LIMIT,
        });
        callsUsed += 1;
        const page = toSearchPageOutcome(pageRaw);
        if (page.kind !== 'success') {
          const { stopReason, retryAfterMs } =
            stopReasonFromSearchClassification(classifySearchOutcome(pageRaw));
          return zeroProblemsSyncResult(
            stopReason,
            retryAfterMs,
            callsUsed,
            callsUsed,
            null,
            null,
          );
        }
        for (const id of page.data.ids) ids.add(id);
        offset += SEARCH_PAGE_LIMIT;
      }
      const idsArr = [...ids];
      const outcome = await this.processCandidates(
        idsArr,
        accessToken,
        maxHttpCalls - callsUsed,
        accountId,
      );
      return this.assembleResult(outcome, idsArr.length, callsUsed, null, null);
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
      });
      return toSearchPageOutcome(outcome);
    };
    const commit = await commitSafeSubWindow(
      fetchPageWithStatus,
      { from: coverageFrom, to: now },
      maxClaims,
      maxHttpCalls - callsUsed,
      this.minSplitMs,
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
    const maxClaims = this.resolveMaxClaims(budget.maxClaims);
    const maxHttpCalls = this.resolveMaxHttpCalls(budget.maxHttpCalls);
    const effectiveLimit = Math.min(batchSize, maxClaims, maxHttpCalls);

    const { accessToken } =
      await this.preflight.resolveAccountAndToken(accountId);

    let rows: Array<{ externalClaimId: string }>;
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
    const outcome = await this.processCandidates(
      ids,
      accessToken,
      maxHttpCalls,
      accountId,
    );
    return this.assembleResult(outcome, ids.length, 0, null, null);
  }

  private async finishFromWindowCommit(
    commit: Awaited<ReturnType<typeof commitSafeSubWindow>>,
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
      const outcome = await this.processCandidates(
        commit.ids,
        accessToken,
        remainingForProcessing,
        accountId,
      );
      return {
        ...this.resultFromOutcome(outcome),
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

    const totalCalls = extraCallsUsed + commit.callsUsed;
    if (commit.kind === 'search_error') {
      const { stopReason, retryAfterMs } = stopReasonFromSearchClassification(
        commit.classification,
      );
      return zeroProblemsSyncResult(
        stopReason,
        retryAfterMs,
        totalCalls,
        totalCalls,
        coverageFrom,
        window.from.toISOString(),
      );
    }
    const stopReason: ProblemsSyncStopReason =
      commit.kind === 'safety_limit_reached'
        ? 'SAFETY_LIMIT_REACHED'
        : commit.kind === 'claim_budget_exhausted'
          ? 'CLAIM_BUDGET_EXHAUSTED'
          : 'CALL_BUDGET_EXHAUSTED';
    return zeroProblemsSyncResult(
      stopReason,
      null,
      totalCalls,
      totalCalls,
      coverageFrom,
      window.from.toISOString(),
    );
  }

  /** Campos comuns entre `finishFromWindowCommit` (janela commitada) e
   * `assembleResult` (censo direto/refresh) — nunca duplica a leitura dos 9
   * contadores em 2 lugares. */
  private resultFromOutcome(
    outcome: ProcessCandidatesOutcome,
  ): Omit<
    ProblemsSyncResult,
    | 'coverageFrom'
    | 'claimsFound'
    | 'httpCallsMade'
    | 'pagesFetched'
    | 'nextWindowFrom'
  > {
    return {
      complete: outcome.stopReason === 'COMPLETED',
      stopReason: outcome.stopReason,
      retryAfterMs: outcome.retryAfterMs,
      claimsProcessed: outcome.counters.claimsProcessed,
      claimsCoreCovered: outcome.counters.claimsCoreCovered,
      claimsPersisted: outcome.counters.claimsPersisted,
      claimsPreserved: outcome.counters.claimsPreserved,
      claimsFailed: outcome.counters.claimsFailed,
      detailFailures: outcome.counters.detailFailures,
      reputationFailures: outcome.counters.reputationFailures,
      reasonLookupFailures: outcome.counters.reasonLookupFailures,
      reasonCacheRefreshed: outcome.counters.reasonCacheRefreshed,
    };
  }

  private assembleResult(
    outcome: ProcessCandidatesOutcome,
    claimsFound: number,
    discoveryCallsUsed: number,
    coverageFrom: string | null,
    nextWindowFrom: string | null,
  ): ProblemsSyncResult {
    return {
      ...this.resultFromOutcome(outcome),
      coverageFrom,
      claimsFound,
      httpCallsMade: discoveryCallsUsed + outcome.callsUsed,
      pagesFetched: discoveryCallsUsed,
      nextWindowFrom,
    };
  }

  /**
   * Processa cada `externalClaimId` em ordem: `fetchClaim` (core) sempre
   * tentado; detail/reputation/reason só chamados se, depois de gastar essa
   * chamada opcional, ainda sobrar 1 `fetchClaim` reservado para CADA
   * candidato que ainda não começou (nunca rouba a reserva de um candidato
   * seguinte). Um claim só conta como CORE COBERTO quando `fetchClaim` teve
   * sucesso **e** `upsertProblem` terminou sem lançar — uma falha isolada de
   * `fetchClaim` marca `CORE_COVERAGE_INCOMPLETE` no resultado final (nunca
   * avança janela/cursor), mas o laço continua para os candidatos seguintes,
   * aproveitando o lote.
   */
  private async processCandidates(
    ids: string[],
    accessToken: string,
    remainingHttpCallsAtStart: number,
    accountId: string,
  ): Promise<ProcessCandidatesOutcome> {
    let remainingHttpCalls = remainingHttpCallsAtStart;
    const counters = emptyProblemsSyncCounters();
    let anyCoreFailure = false;
    const callsUsedSoFar = () => remainingHttpCallsAtStart - remainingHttpCalls;

    for (let i = 0; i < ids.length; i += 1) {
      const externalClaimId = ids[i];
      const remainingCandidatesAfterThis = ids.length - i - 1;

      const claimOutcome = await this.httpClient.fetchClaim(
        accessToken,
        externalClaimId,
      );
      remainingHttpCalls -= 1;
      counters.claimsProcessed += 1;
      const claimClass = classifyClaimsHttpOutcome(claimOutcome);
      const claimAbort = abortFrom(claimClass, callsUsedSoFar(), counters);
      if (claimAbort) return claimAbort;
      if (claimClass.kind === 'isolated') {
        counters.claimsFailed += 1;
        anyCoreFailure = true;
        continue;
      }
      if (claimOutcome.kind !== 'success') {
        throw new Error('estado inesperado: fetchClaim ok sem success');
      }
      const claim = claimOutcome.data.claim;

      let detail: FetchOutcome<{
        info: RawClaimDetailInfo | null;
        actions: ProblemActionInput[];
      }> = { fetched: false };
      if (remainingHttpCalls - 1 >= remainingCandidatesAfterThis) {
        const detailOutcome = await this.httpClient.fetchClaimDetail(
          accessToken,
          externalClaimId,
        );
        remainingHttpCalls -= 1;
        const detailClass = classifyClaimsHttpOutcome(detailOutcome);
        const detailAbort = abortFrom(detailClass, callsUsedSoFar(), counters);
        if (detailAbort) return detailAbort;
        if (detailClass.kind === 'isolated') {
          counters.detailFailures += 1;
        } else {
          if (detailOutcome.kind !== 'success') {
            throw new Error(
              'estado inesperado: fetchClaimDetail ok sem success',
            );
          }
          const rawDetail = detailOutcome.data.claim;
          // `rawDetail.detail` já é RawClaimDetailInfo|null (string dueDate)
          // — a conversão para Date é responsabilidade do mapper (CP2-A).
          detail = {
            fetched: true,
            value: {
              info: rawDetail.detail,
              actions: flattenDetailActions(rawDetail.players),
            },
          };
        }
      }

      let reputation: FetchOutcome<RawClaimReputationImpact> = {
        fetched: false,
      };
      if (remainingHttpCalls - 1 >= remainingCandidatesAfterThis) {
        const reputationOutcome =
          await this.httpClient.fetchClaimReputationImpact(
            accessToken,
            externalClaimId,
          );
        remainingHttpCalls -= 1;
        const reputationClass = classifyClaimsHttpOutcome(reputationOutcome);
        const reputationAbort = abortFrom(
          reputationClass,
          callsUsedSoFar(),
          counters,
        );
        if (reputationAbort) return reputationAbort;
        if (reputationClass.kind === 'isolated') {
          counters.reputationFailures += 1;
        } else {
          if (reputationOutcome.kind !== 'success') {
            throw new Error(
              'estado inesperado: fetchClaimReputationImpact ok sem success',
            );
          }
          reputation = {
            fetched: true,
            value: reputationOutcome.data.reputation,
          };
        }
      }

      if (claim.reasonId !== null) {
        let cached;
        try {
          cached = await this.reasonCache.findFresh(
            Marketplace.MERCADO_LIVRE,
            claim.siteId,
            claim.reasonId,
            this.reasonCacheTtlMs,
            new Date(),
          );
        } catch {
          counters.claimsFailed += 1;
          return {
            stopReason: 'PERSISTENCE_UNAVAILABLE',
            retryAfterMs: null,
            callsUsed: callsUsedSoFar(),
            counters,
          };
        }
        if (
          cached === null &&
          remainingHttpCalls - 1 >= remainingCandidatesAfterThis
        ) {
          const reasonOutcome = await this.httpClient.fetchClaimReason(
            accessToken,
            claim.reasonId,
          );
          remainingHttpCalls -= 1;
          const reasonClass = classifyClaimsHttpOutcome(reasonOutcome);
          const reasonAbort = abortFrom(
            reasonClass,
            callsUsedSoFar(),
            counters,
          );
          if (reasonAbort) return reasonAbort;
          if (reasonClass.kind === 'isolated') {
            counters.reasonLookupFailures += 1;
          } else {
            if (reasonOutcome.kind !== 'success') {
              throw new Error(
                'estado inesperado: fetchClaimReason ok sem success',
              );
            }
            try {
              await this.reasonCache.upsert({
                marketplace: Marketplace.MERCADO_LIVRE,
                siteId: claim.siteId,
                reasonId: claim.reasonId,
                ...reasonOutcome.data.reason,
                fetchedAt: new Date(),
              });
              counters.reasonCacheRefreshed += 1;
            } catch {
              counters.claimsFailed += 1;
              return {
                stopReason: 'PERSISTENCE_UNAVAILABLE',
                retryAfterMs: null,
                callsUsed: callsUsedSoFar(),
                counters,
              };
            }
          }
        }
      }

      const input = mapClaimToProblemInput({
        marketplaceAccountId: accountId,
        claim,
        detail,
        reputation,
      });
      try {
        const result = await this.persistence.upsertProblem(input);
        counters.claimsCoreCovered += 1;
        if (result.accepted) {
          counters.claimsPersisted += 1;
        } else {
          counters.claimsPreserved += 1;
        }
      } catch {
        counters.claimsFailed += 1;
        return {
          stopReason: 'PERSISTENCE_UNAVAILABLE',
          retryAfterMs: null,
          callsUsed: callsUsedSoFar(),
          counters,
        };
      }
    }

    return {
      stopReason: anyCoreFailure ? 'CORE_COVERAGE_INCOMPLETE' : 'COMPLETED',
      retryAfterMs: null,
      callsUsed: callsUsedSoFar(),
      counters,
    };
  }
}
