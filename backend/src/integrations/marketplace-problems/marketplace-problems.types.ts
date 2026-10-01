import type {
  MarketplaceProblemsHistoricalStatus,
  MarketplaceProblemsSyncJobStatus,
} from './marketplace-problems-sync-jobs.types';

/** Cobertura do backfill histórico de uma conta (compartilhada por status e resumo). */
export interface ProblemsHistoricalCoverageDto {
  /** Até onde o incremental varreu (= início da próxima janela de criação). */
  incrementalCoveredThrough: string | null;
  /** Menor data JÁ coberta pelo histórico (anda para trás). */
  historicalCoveredFrom: string | null;
  /** Pedido persistido mais antigo da conta; `null` = sem alvo (nenhuma data inventada). */
  historicalTargetFrom: string | null;
  historicalCompletedAt: string | null;
  /** `NOT_STARTED` = job nunca iniciado. "Completo" só com `COMPLETED`. */
  historicalStatus: MarketplaceProblemsHistoricalStatus | 'NOT_STARTED';
  historicalLastErrorCode: string | null;
  /** Claims em quarentena PENDENTES (403 em fetch_core) — fora dos KPIs. */
  quarantinedClaimsCount: number;
}

/** Responsabilidade de um problema. `UNKNOWN` é o default (nenhuma classificação automática existe). */
export const PROBLEM_RESPONSIBILITIES = [
  'UNKNOWN',
  'SELLER',
  'BUYER',
  'MARKETPLACE',
  'CARRIER',
  'OTHER',
] as const;
export type ProblemResponsibility = (typeof PROBLEM_RESPONSIBILITIES)[number];

/** Categorias que um usuário pode atribuir manualmente (`UNKNOWN` só existe como "ainda não classificado"). */
export const MANUAL_RESPONSIBILITIES = [
  'SELLER',
  'BUYER',
  'MARKETPLACE',
  'CARRIER',
  'OTHER',
] as const;
export type ManualProblemResponsibility =
  (typeof MANUAL_RESPONSIBILITIES)[number];

/** Allowlist de ordenação — nunca um nome de coluna vindo do cliente. */
export const PROBLEM_SORT_FIELDS = [
  'dateCreated',
  'lastUpdated',
  'nextActionDueDate',
] as const;
export type ProblemSortField = (typeof PROBLEM_SORT_FIELDS)[number];

export const PROBLEM_ACTION_DUE_FILTERS = ['overdue', 'next7days'] as const;
export type ProblemActionDueFilter =
  (typeof PROBLEM_ACTION_DUE_FILTERS)[number];

export const PROBLEM_REPUTATION_IMPACTS = [
  'affected',
  'not_affected',
  'not_applies',
] as const;

/** Filtros compartilhados por lista, resumo e motivos — a MESMA construção de WHERE. */
export interface ProblemsFilters {
  marketplace?: string;
  accountId?: string;
  /** `YYYY-MM-DD` (dia em America/Sao_Paulo, inclusivo). */
  from?: string;
  to?: string;
  status?: string;
  type?: string;
  stage?: string;
  reasonId?: string;
  responsibility?: ProblemResponsibility;
  reputationImpact?: string;
  pendingAction?: boolean;
  actionDue?: ProblemActionDueFilter;
  /** Pedido externo (número do pedido no marketplace). */
  orderId?: string;
}

/**
 * Somente campos necessários — nunca token, payload bruto, nem PII (sem
 * comprador, endereço, mensagens ou texto livre do provedor).
 */
export interface ProblemListItemDto {
  id: string;
  marketplace: string;
  accountId: string;
  accountNickname: string | null;
  orderExternalId: string | null;
  status: string;
  stage: string;
  type: string;
  reasonId: string | null;
  reasonName: string | null;
  /** Rótulo PT-BR do catálogo central (`null` só sem motivo); código desconhecido usa o fallback seguro. */
  reasonLabel: string | null;
  dateCreated: string;
  lastUpdated: string;
  resolutionDate: string | null;
  reputationImpact: string | null;
  nextActionCode: string | null;
  nextActionDueDate: string | null;
  pendingActionsCount: number;
  responsibility: ProblemResponsibility;
  responsibilityConfidence: string;
}

export interface ProblemActionDto {
  playerRole: string;
  actionCode: string;
  mandatory: boolean;
  dueDate: string | null;
}

export interface ProblemDetailDto extends ProblemListItemDto {
  externalClaimId: string;
  reasonFlow: string | null;
  reasonDetail: string | null;
  detailTitle: string | null;
  detailProblem: string | null;
  detailResponsible: string | null;
  detailDueDate: string | null;
  reputationHasIncentive: boolean | null;
  reputationDueDate: string | null;
  resolutionReason: string | null;
  resolutionClosedBy: string | null;
  lastCheckedAt: string | null;
  actions: ProblemActionDto[];
  order: { externalOrderId: string; status: string } | null;
  /** Última correção manual (a auditoria mais recente vive nas colunas do problema). */
  responsibilitySource: string | null;
  responsibilityOverriddenAt: string | null;
  responsibilityOverrideReason: string | null;
}

export interface ProblemsPageDto {
  items: ProblemListItemDto[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProblemsCoverageAccountDto extends ProblemsHistoricalCoverageDto {
  accountId: string;
  accountNickname: string | null;
  marketplace: string;
  problemsTotal: number;
  problemsOpen: number;
  jobStatus: MarketplaceProblemsSyncJobStatus | 'NOT_STARTED';
  /** Início da próxima janela de criação (tudo antes dele já foi varrido). */
  windowCursorAt: string | null;
  lastCompleteCensusAt: string | null;
  lastActivityAt: string | null;
  lastErrorCode: string | null;
}

export interface ProblemsSummaryDto {
  total: number;
  open: number;
  resolved: number;
  reputationAffected: number;
  pendingAction: number;
  overdueAction: number;
  unknownResponsibility: number;
  byResponsibility: Array<{
    responsibility: ProblemResponsibility;
    count: number;
  }>;
  topReasons: ProblemReasonOptionDto[];
  coverage: ProblemsCoverageAccountDto[];
}

/** Quantidade de problemas de um motivo numa conta (breakdown). */
export interface ProblemReasonAccountCountDto {
  accountId: string;
  accountNickname: string | null;
  count: number;
}

export interface ProblemReasonOptionDto {
  reasonId: string;
  /** Código original (nome no cache de motivos); `null` se o cache não o tiver. */
  name: string | null;
  /** Rótulo PT-BR do catálogo central. */
  reasonLabel: string;
  count: number;
  /** % (0–100, 2 casas) sobre TODOS os problemas do recorte; `null` sem problemas. */
  percentage: number | null;
  byAccount: ProblemReasonAccountCountDto[];
}

/** Status do job de uma conta (`NOT_STARTED` = nunca iniciado; nada é criado automaticamente). */
export interface ProblemsSyncStatusDto extends ProblemsHistoricalCoverageDto {
  accountId: string;
  accountNickname: string | null;
  jobStatus: MarketplaceProblemsSyncJobStatus | 'NOT_STARTED';
  windowCursorAt: string | null;
  lastCompleteCensusAt: string | null;
  lastActivityAt: string | null;
  nextAttemptAt: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  claimsProcessedCount: number;
  /** `false` = o job está preparado, mas o servidor não o processará até a ativação do worker. */
  workerEnabled: boolean;
}

/**
 * Cobertura de um mês: `COMPLETE` só com o mês inteiro dentro do intervalo
 * varrido e sem pendência que o toque; `PARTIAL` fora/atravessando o intervalo
 * ou com quarentena datada no mês; `UNKNOWN` sem job ou com quarentena legada
 * sem data (ver `monthlyCoverage`).
 */
export type ProblemsMonthlyCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

export interface ProblemsMonthlyReasonDto {
  /** Código original (nome do motivo no cache; `reason_id` se o cache não o tiver) — para diagnóstico. */
  code: string;
  /** Rótulo PT-BR do catálogo central; código desconhecido vira texto legível seguro. */
  label: string;
  count: number;
}

/** Um mês (America/Sao_Paulo) de UMA conta. */
export interface ProblemsMonthlyItemDto {
  yearMonth: string;
  accountId: string;
  accountNickname: string | null;
  marketplace: string;
  totalProblems: number;
  openProblems: number;
  resolvedProblems: number;
  reputationImpactCount: number;
  totalOrders: number;
  /** `null` quando o mês não tem pedidos (nunca divide por zero). */
  problemsPer100Orders: number | null;
  /** Percentual 0–100 (resolvidos / total); `null` sem problemas. */
  resolutionRate: number | null;
  /** `null` sem nenhum problema resolvido com datas de criação e resolução. */
  averageResolutionHours: number | null;
  topReasons: ProblemsMonthlyReasonDto[];
  coverage: ProblemsMonthlyCoverage;
  /** `true` só com cobertura `COMPLETE` e pedidos no mês; caso contrário a taxa é provisória. */
  rateDefinitive: boolean;
  /** Quarentenas pendentes da conta (todas as datas). */
  quarantinedClaimsCount: number;
  /** Pendentes cuja data de criação (da busca) cai neste mês — só estas tornam o mês PARTIAL. */
  quarantinedClaimsInMonthCount: number;
  /** Pendentes legadas sem data conhecida — deixam a cobertura de todos os meses completos INDETERMINADA (UNKNOWN). */
  quarantinedUnknownDateCount: number;
}

export interface ProblemsMonthlyDto {
  timezone: 'America/Sao_Paulo';
  items: ProblemsMonthlyItemDto[];
}
