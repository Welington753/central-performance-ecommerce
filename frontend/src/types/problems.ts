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

/** `NOT_STARTED` = job nunca iniciado; "completo" só com `COMPLETED`. */
export type ProblemsHistoricalStatus =
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "NO_TARGET"
  | "FAILED"
  | "NOT_STARTED";

/** Cobertura do histórico de uma conta — enviada tanto no resumo quanto no status. */
export interface ProblemsHistoricalCoverageDto {
  incrementalCoveredThrough: string | null;
  historicalCoveredFrom: string | null;
  historicalTargetFrom: string | null;
  historicalCompletedAt: string | null;
  historicalStatus: ProblemsHistoricalStatus;
  historicalLastErrorCode: string | null;
  /** Claims inacessíveis pendentes (fora dos KPIs). Nunca vêm os identificadores. */
  quarantinedClaimsCount: number;
}

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
  /** Rótulo PT-BR da fonte central (backend); `null` só quando o problema não tem motivo. */
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

export interface ProblemReasonAccountCountDto {
  accountId: string;
  accountNickname: string | null;
  count: number;
}

/** Motivo do período: distribuição COMPLETA (sem top N), ordenada por quantidade. */
export interface ProblemReasonOptionDto {
  reasonId: string;
  /** Código original — só diagnóstico. */
  name: string | null;
  reasonLabel: string;
  count: number;
  /** % sobre todos os problemas do recorte (0–100, 2 casas); `null` sem problemas. */
  percentage: number | null;
  byAccount: ProblemReasonAccountCountDto[];
}

export interface ProblemsCoverageAccountDto extends ProblemsHistoricalCoverageDto {
  accountId: string;
  accountNickname: string | null;
  marketplace: string;
  problemsTotal: number;
  problemsOpen: number;
  jobStatus: ProblemsSyncJobStatus | "NOT_STARTED";
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
  byResponsibility: Array<{ responsibility: ProblemResponsibility; count: number }>;
  topReasons: ProblemReasonOptionDto[];
  coverage: ProblemsCoverageAccountDto[];
}

export interface ProblemsSyncStatusDto extends ProblemsHistoricalCoverageDto {
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

/** Cobertura de um mês: `COMPLETE` só com o mês inteiro varrido e sem pendência que o toque. */
export type ProblemsMonthlyCoverage = "COMPLETE" | "PARTIAL" | "UNKNOWN";

export interface ProblemsMonthlyReasonDto {
  /** Código original do motivo — só diagnóstico, nunca texto principal. */
  code: string;
  /** Rótulo PT-BR da fonte central (backend). */
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
  problemsPer100Orders: number | null;
  resolutionRate: number | null;
  averageResolutionHours: number | null;
  topReasons: ProblemsMonthlyReasonDto[];
  coverage: ProblemsMonthlyCoverage;
  rateDefinitive: boolean;
  quarantinedClaimsCount: number;
  quarantinedClaimsInMonthCount: number;
  quarantinedUnknownDateCount: number;
}

export interface ProblemsMonthlyDto {
  timezone: "America/Sao_Paulo";
  items: ProblemsMonthlyItemDto[];
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
