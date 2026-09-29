import type { RawClaim } from '../mercado-livre-claims/mercado-livre-claim-response';
import type { RawClaimDetailInfo } from '../mercado-livre-claims/mercado-livre-claim-detail-response';
import type { RawClaimReputationImpact } from '../mercado-livre-claims/mercado-livre-claim-reputation-response';

/**
 * Três estados, nunca dois: `{fetched:false}` = não consultado (teto,
 * falha, ou nem tentado) — a persistência preserva tudo. `{fetched:true,
 * value:null}` = consultado e a fonte confirmou ausência do bloco inteiro —
 * a persistência trata como valor real e limpa as colunas. `{fetched:true,
 * value:{...}}` = consultado com dado — substitui.
 */
export type FetchOutcome<T> =
  { fetched: true; value: T | null } | { fetched: false };

/** Ação já achatada (papel/tipo do player resolvidos pelo chamador — CP2-B, futuro). */
export interface ProblemActionInput {
  playerRole: string;
  playerType: string;
  actionCode: string;
  mandatory: boolean;
  dueDate: Date | null;
}

export interface ProblemDetailValue {
  dueDate: Date | null;
  responsible: string | null;
  title: string | null;
  description: string | null;
  problem: string | null;
  actions: ProblemActionInput[];
}

export interface ProblemReputationValue {
  impact: string;
  hasIncentive: boolean | null;
  dueDate: Date | null;
}

export interface UpsertProblemInput {
  marketplaceAccountId: string;
  externalClaimId: string;
  resource: string;
  resourceId: string;
  status: string;
  type: string;
  stage: string;
  siteId: string;
  reasonId: string | null;
  parentClaimId: string | null;
  fulfilled: boolean | null;
  quantityType: string | null;
  claimVersion: string | null;
  resolutionReason: string | null;
  resolutionBenefitedRoles: string[];
  resolutionClosedBy: string | null;
  resolutionAppliedCoverage: boolean | null;
  resolutionDate: Date | null;
  dateCreated: Date;
  lastUpdated: Date;
  detail: FetchOutcome<ProblemDetailValue>;
  reputation: FetchOutcome<ProblemReputationValue>;
}

export interface MapClaimToProblemInput {
  marketplaceAccountId: string;
  /** Fonte canônica do core/estado — nunca `fetchClaimDetail` (ver plano CP2). */
  claim: RawClaim;
  detail: FetchOutcome<{
    info: RawClaimDetailInfo | null;
    actions: ProblemActionInput[];
  }>;
  reputation: FetchOutcome<RawClaimReputationImpact>;
}

function toDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function mapDetail(
  detail: MapClaimToProblemInput['detail'],
): FetchOutcome<ProblemDetailValue> {
  if (!detail.fetched) return { fetched: false };
  if (detail.value === null) return { fetched: true, value: null };
  const { info, actions } = detail.value;
  return {
    fetched: true,
    value: {
      dueDate: toDateOrNull(info?.dueDate ?? null),
      responsible: info?.responsible ?? null,
      title: info?.title ?? null,
      description: info?.description ?? null,
      problem: info?.problem ?? null,
      actions,
    },
  };
}

function mapReputation(
  reputation: MapClaimToProblemInput['reputation'],
): FetchOutcome<ProblemReputationValue> {
  if (!reputation.fetched) return { fetched: false };
  if (reputation.value === null) return { fetched: true, value: null };
  return {
    fetched: true,
    value: {
      impact: reputation.value.impact,
      hasIncentive: reputation.value.hasIncentive,
      dueDate: toDateOrNull(reputation.value.dueDate),
    },
  };
}

/**
 * Função pura — nunca chama HTTP nem banco. `claim` (de `fetchClaim`) é a
 * ÚNICA fonte do core/estado; nunca define
 * `responsibility`/`responsibilityConfidence`/`responsibilitySource` (ficam
 * de fora do objeto produzido de propósito — o `DEFAULT` do banco cuida da
 * criação, e a persistência nunca os inclui no `UPDATE`).
 */
export function mapClaimToProblemInput(
  input: MapClaimToProblemInput,
): UpsertProblemInput {
  const { claim } = input;
  return {
    marketplaceAccountId: input.marketplaceAccountId,
    externalClaimId: claim.externalClaimId,
    resource: claim.resource,
    resourceId: claim.resourceId,
    status: claim.status,
    type: claim.type,
    stage: claim.stage,
    siteId: claim.siteId,
    reasonId: claim.reasonId,
    parentClaimId: claim.parentClaimId,
    fulfilled: claim.fulfilled,
    quantityType: claim.quantityType,
    claimVersion: claim.claimVersion,
    resolutionReason: claim.resolution?.reason ?? null,
    resolutionBenefitedRoles: claim.resolution?.benefitedRoles ?? [],
    resolutionClosedBy: claim.resolution?.closedBy ?? null,
    resolutionAppliedCoverage: claim.resolution?.appliedCoverage ?? null,
    resolutionDate: toDateOrNull(claim.resolution?.date ?? null),
    dateCreated: new Date(claim.dateCreated),
    lastUpdated: new Date(claim.lastUpdated),
    detail: mapDetail(input.detail),
    reputation: mapReputation(input.reputation),
  };
}
