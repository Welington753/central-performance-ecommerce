import { Marketplace } from '../contracts/marketplace.enum';
import type { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import type { RawClaimReputationImpact } from '../mercado-livre-claims/mercado-livre-claim-reputation-response';
import type { RawClaimDetailInfo } from '../mercado-livre-claims/mercado-livre-claim-detail-response';
import type { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import type { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import {
  mapClaimToProblemInput,
  type FetchOutcome,
  type ProblemActionInput,
} from './mercado-livre-claim-to-problem.mapper';
import {
  classifyClaimsHttpOutcome,
  flattenDetailActions,
  abortFrom,
  emptyProblemsSyncCounters,
  type ProcessCandidatesOutcome,
} from './mercado-livre-claim-enrichment.util';
import type { ProblemsSyncLimits } from './mercado-livre-problems-sync-limits';

/**
 * Laço por claim do sync do Mercado Livre Claims (CP2-B). Nunca abre
 * transação durante uma chamada HTTP (as chamadas de rede de um claim
 * terminam antes de `upsertProblem` começar).
 */
export class MercadoLivreProblemsCandidateProcessor {
  constructor(
    private readonly httpClient: MercadoLivreClaimsHttpClient,
    private readonly reasonCache: MarketplaceProblemReasonsCacheRepository,
    private readonly persistence: MarketplaceProblemsPersistenceService,
    private readonly limits: ProblemsSyncLimits,
  ) {}

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
  async processCandidates(
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
            this.limits.reasonCacheTtlMs,
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
