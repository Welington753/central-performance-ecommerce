import type { MarketplaceProblemsSyncJobStatus } from './marketplace-problems-sync-jobs.types';

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

export interface ProblemsCoverageAccountDto {
  accountId: string;
  accountNickname: string | null;
  marketplace: string;
  problemsTotal: number;
  problemsOpen: number;
  jobStatus: MarketplaceProblemsSyncJobStatus | 'NOT_STARTED';
  /** Início da próxima janela de criação (tudo antes dele já foi varrido). */
  windowCursorAt: string | null;
  lastCompleteCensusAt: string | null;
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

export interface ProblemReasonOptionDto {
  reasonId: string;
  name: string | null;
  count: number;
}

/** Status do job de uma conta (`NOT_STARTED` = nunca iniciado; nada é criado automaticamente). */
export interface ProblemsSyncStatusDto {
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
