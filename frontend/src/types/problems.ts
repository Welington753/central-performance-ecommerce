/**
 * Espelha exatamente os contratos de `backend/src/integrations/marketplace-problems`
 * (`marketplace-problems.types.ts`) — nunca inventar campo novo aqui sem antes
 * existir no backend. Sem token, payload bruto nem PII: o backend nunca os envia.
 */

export type ProblemResponsibility =
  | "UNKNOWN"
  | "SELLER"
  | "BUYER"
  | "MARKETPLACE"
  | "CARRIER"
  | "OTHER";

/** Categorias que um usuário com `problems.manage` pode atribuir. */
export type ManualProblemResponsibility = Exclude<ProblemResponsibility, "UNKNOWN">;

export type ProblemSortField = "dateCreated" | "lastUpdated" | "nextActionDueDate";
export type SortDirection = "asc" | "desc";

export type ProblemsSyncJobStatus =
  | "RUNNING"
  | "PAUSED"
  | "WAITING_RETRY"
  | "FAILED"
  | "FAILED_AUTH";

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

export interface ProblemReasonOptionDto {
  reasonId: string;
  name: string | null;
  count: number;
}

export interface ProblemsCoverageAccountDto {
  accountId: string;
  accountNickname: string | null;
  marketplace: string;
  problemsTotal: number;
  problemsOpen: number;
  jobStatus: ProblemsSyncJobStatus | "NOT_STARTED";
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
  byResponsibility: Array<{ responsibility: ProblemResponsibility; count: number }>;
  topReasons: ProblemReasonOptionDto[];
  coverage: ProblemsCoverageAccountDto[];
}

export interface ProblemsSyncStatusDto {
  accountId: string;
  accountNickname: string | null;
  jobStatus: ProblemsSyncJobStatus | "NOT_STARTED";
  windowCursorAt: string | null;
  lastCompleteCensusAt: string | null;
  lastActivityAt: string | null;
  nextAttemptAt: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  pauseRequested: boolean;
  claimsProcessedCount: number;
  /** `false` = job preparado, mas o servidor não o processará até ativar o worker. */
  workerEnabled: boolean;
}

/** Estado dos filtros da tela — strings vazias / "ALL" significam "sem filtro". */
export interface ProblemsFilters {
  from: string;
  to: string;
  marketplace: "ALL" | "MERCADO_LIVRE" | "SHOPEE" | "AMAZON";
  accountId: string;
  status: "ALL" | "opened" | "closed";
  reasonId: string;
  responsibility: "ALL" | ProblemResponsibility;
  reputationImpact: "ALL" | "affected" | "not_affected" | "not_applies";
  pendingAction: "ALL" | "true";
  actionDue: "ALL" | "overdue" | "next7days";
  orderId: string;
}

export const EMPTY_PROBLEMS_FILTERS: ProblemsFilters = {
  from: "",
  to: "",
  marketplace: "ALL",
  accountId: "",
  status: "ALL",
  reasonId: "",
  responsibility: "ALL",
  reputationImpact: "ALL",
  pendingAction: "ALL",
  actionDue: "ALL",
  orderId: "",
};
