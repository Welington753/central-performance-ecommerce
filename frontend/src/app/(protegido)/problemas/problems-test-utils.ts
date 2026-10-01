/**
 * Apoio dos testes da página Problemas: fixtures (ML1 × ML2) e um `apiFetch`
 * simulado que roteia cada endpoint. Só dados fictícios — nenhuma chamada real.
 */
import type { PermissionKey } from "@/types/users";
import type {
  ProblemDetailDto,
  ProblemReasonOptionDto,
  ProblemsCoverageAccountDto,
  ProblemsMonthlyItemDto,
  ProblemsPageDto,
  ProblemsSyncStatusDto,
} from "@/types/problems";

export const ML1_ID = "11111111-1111-4111-8111-111111111111";
export const ML2_ID = "22222222-2222-4222-8222-222222222222";
export const PROBLEM_1_ID = "33333333-3333-4333-8333-333333333333";
export const PROBLEM_2_ID = "44444444-4444-4444-8444-444444444444";

export { REASONS } from "./problems-test-reasons";
import { REASONS } from "./problems-test-reasons";

export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

export function monthlyItem(overrides: Partial<ProblemsMonthlyItemDto>): ProblemsMonthlyItemDto {
  return {
    yearMonth: "2026-03",
    accountId: ML1_ID,
    accountNickname: "ML1",
    marketplace: "MERCADO_LIVRE",
    totalProblems: 10,
    openProblems: 4,
    resolvedProblems: 6,
    reputationImpactCount: 2,
    totalOrders: 100,
    problemsPer100Orders: 10,
    resolutionRate: 60,
    averageResolutionHours: 24,
    topReasons: [
      { code: "repentant_buyer", label: "Arrependimento do comprador", count: 6 },
      { code: "broken_item", label: "Produto quebrado ou com defeito", count: 4 },
    ],
    coverage: "COMPLETE",
    rateDefinitive: true,
    quarantinedClaimsCount: 0,
    quarantinedClaimsInMonthCount: 0,
    quarantinedUnknownDateCount: 0,
    ...overrides,
  };
}

/** Abril de ML2 AUSENTE (mês sem linha ≠ zero); maio de ML1 sem pedidos (taxa N/D) e PARTIAL. */
export const MONTHLY_ITEMS: ProblemsMonthlyItemDto[] = [
  monthlyItem({}),
  monthlyItem({
    yearMonth: "2026-04",
    totalProblems: 20,
    resolvedProblems: 10,
    openProblems: 10,
    reputationImpactCount: 4,
    problemsPer100Orders: 20,
    averageResolutionHours: 48,
  }),
  monthlyItem({
    yearMonth: "2026-05",
    totalProblems: 5,
    openProblems: 5,
    resolvedProblems: 0,
    reputationImpactCount: 1,
    totalOrders: 0,
    problemsPer100Orders: null,
    averageResolutionHours: null,
    topReasons: [{ code: "mystery_code", label: "Mystery code", count: 5 }],
    coverage: "PARTIAL",
    rateDefinitive: false,
  }),
  monthlyItem({
    yearMonth: "2026-03",
    accountId: ML2_ID,
    accountNickname: "ML2",
    totalProblems: 4,
    openProblems: 1,
    resolvedProblems: 3,
    reputationImpactCount: 0,
    totalOrders: 40,
    problemsPer100Orders: 10,
    averageResolutionHours: 12,
    topReasons: [{ code: "repentant_buyer", label: "Arrependimento do comprador", count: 4 }],
  }),
  monthlyItem({
    yearMonth: "2026-05",
    accountId: ML2_ID,
    accountNickname: "ML2",
    totalProblems: 6,
    openProblems: 2,
    resolvedProblems: 4,
    reputationImpactCount: 1,
    totalOrders: 60,
    problemsPer100Orders: 10,
    averageResolutionHours: 36,
    topReasons: [{ code: "repentant_buyer", label: "Arrependimento do comprador", count: 6 }],
    coverage: "UNKNOWN",
    rateDefinitive: false,
  }),
];

export const LIST: ProblemsPageDto = {
  items: [
    {
      id: PROBLEM_1_ID,
      marketplace: "MERCADO_LIVRE",
      accountId: ML1_ID,
      accountNickname: "ML1",
      orderExternalId: "ORD-A1",
      status: "opened",
      stage: "claim",
      type: "mediations",
      reasonId: "R1",
      reasonName: "repentant_buyer",
      reasonLabel: "Arrependimento do comprador",
      dateCreated: "2026-05-10T15:00:00.000Z",
      lastUpdated: "2026-05-11T15:00:00.000Z",
      resolutionDate: null,
      reputationImpact: "affected",
      nextActionCode: "send_proof",
      nextActionDueDate: "2026-05-12T15:00:00.000Z",
      pendingActionsCount: 1,
      responsibility: "UNKNOWN",
      responsibilityConfidence: "NONE",
    },
    {
      id: PROBLEM_2_ID,
      marketplace: "MERCADO_LIVRE",
      accountId: ML1_ID,
      accountNickname: "ML1",
      orderExternalId: null,
      status: "closed",
      stage: "dispute",
      type: "returns",
      reasonId: null,
      reasonName: null,
      reasonLabel: null,
      dateCreated: "2026-06-01T02:30:00.000Z",
      lastUpdated: "2026-06-02T15:00:00.000Z",
      resolutionDate: "2026-06-02T15:00:00.000Z",
      reputationImpact: "not_affected",
      nextActionCode: null,
      nextActionDueDate: null,
      pendingActionsCount: 0,
      responsibility: "SELLER",
      responsibilityConfidence: "MANUAL",
    },
  ],
  page: 1,
  pageSize: 25,
  total: 40,
  totalPages: 2,
};

export const DETAIL: ProblemDetailDto = {
  ...LIST.items[0],
  externalClaimId: "5001234567",
  reasonFlow: "mediations",
  reasonDetail: null,
  detailTitle: "Título do problema",
  detailProblem: null,
  detailResponsible: null,
  detailDueDate: null,
  reputationHasIncentive: null,
  reputationDueDate: null,
  resolutionReason: null,
  resolutionClosedBy: null,
  lastCheckedAt: null,
  actions: [
    { playerRole: "respondent", actionCode: "send_proof", mandatory: true, dueDate: "2026-05-12T15:00:00.000Z" },
  ],
  order: { externalOrderId: "ORD-A1", status: "paid" },
  responsibilitySource: null,
  responsibilityOverriddenAt: null,
  responsibilityOverrideReason: null,
};

export function coverageAccount(overrides: Partial<ProblemsCoverageAccountDto> = {}): ProblemsCoverageAccountDto {
  return {
    accountId: ML1_ID,
    accountNickname: "ML1",
    marketplace: "MERCADO_LIVRE",
    problemsTotal: 40,
    problemsOpen: 10,
    jobStatus: "RUNNING",
    windowCursorAt: "2026-09-15T12:00:00.000Z",
    lastCompleteCensusAt: null,
    lastActivityAt: "2026-09-15T12:30:00.000Z",
    lastErrorCode: null,
    incrementalCoveredThrough: "2026-09-15T12:00:00.000Z",
    historicalCoveredFrom: "2026-06-01T12:00:00.000Z",
    historicalTargetFrom: "2026-03-01T12:00:00.000Z",
    historicalCompletedAt: null,
    historicalStatus: "RUNNING",
    historicalLastErrorCode: null,
    quarantinedClaimsCount: 2,
    ...overrides,
  };
}

export function syncStatus(overrides: Partial<ProblemsSyncStatusDto> = {}): ProblemsSyncStatusDto {
  return {
    accountId: ML1_ID,
    accountNickname: "ML1",
    jobStatus: "RUNNING",
    windowCursorAt: "2026-09-15T12:00:00.000Z",
    lastCompleteCensusAt: null,
    lastActivityAt: "2026-09-15T12:30:00.000Z",
    nextAttemptAt: null,
    attemptCount: 0,
    lastErrorCode: null,
    pauseRequested: false,
    claimsProcessedCount: 0,
    workerEnabled: true,
    incrementalCoveredThrough: "2026-09-15T12:00:00.000Z",
    historicalCoveredFrom: "2026-06-01T12:00:00.000Z",
    historicalTargetFrom: "2026-03-01T12:00:00.000Z",
    historicalCompletedAt: null,
    historicalStatus: "RUNNING",
    historicalLastErrorCode: null,
    quarantinedClaimsCount: 2,
    ...overrides,
  };
}

export interface SetupOptions {
  permissions?: PermissionKey[];
  monthly?: ProblemsMonthlyItemDto[] | Error;
  reasons?: ProblemReasonOptionDto[] | Error;
  list?: ProblemsPageDto | Error;
  coverage?: ProblemsCoverageAccountDto[];
  statuses?: ProblemsSyncStatusDto[];
}

export interface Call {
  path: string;
  method: string;
  body?: string;
}

interface Mocks {
  apiFetch: jest.Mock;
  fetchMarketplaceAccounts: jest.Mock;
  useCurrentUser: jest.Mock;
}

export function installApi(mocks: Mocks, options: SetupOptions = {}): Call[] {
  const calls: Call[] = [];
  mocks.useCurrentUser.mockReturnValue({
    user: {
      id: "u1",
      name: "Ana",
      email: "ana@example.com",
      isAdmin: false,
      role: "ANALYST",
      permissions: options.permissions ?? ["problems.view"],
      accountScope: { mode: "ALL" },
      mustChangePassword: false,
    },
    isLoading: false,
    status: "ready",
  });
  mocks.fetchMarketplaceAccounts.mockResolvedValue([
    { id: ML1_ID, marketplace: "MERCADO_LIVRE", nickname: "ML1" },
    { id: ML2_ID, marketplace: "MERCADO_LIVRE", nickname: "ML2" },
    { id: "55555555-5555-4555-8555-555555555555", marketplace: "SHOPEE", nickname: "Loja Shopee" },
  ]);
  let statuses = options.statuses ?? [syncStatus()];
  mocks.apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body as string | undefined });
    if (path.startsWith("/problems/monthly")) {
      if (options.monthly instanceof Error) return jsonResponse({}, 500);
      return jsonResponse({ timezone: "America/Sao_Paulo", items: options.monthly ?? MONTHLY_ITEMS });
    }
    if (path.startsWith("/problems/summary")) {
      return jsonResponse({
        total: 40, open: 10, resolved: 30, reputationAffected: 4, pendingAction: 0, overdueAction: 0,
        unknownResponsibility: 0, byResponsibility: [], topReasons: [],
        coverage: options.coverage ?? [coverageAccount()],
      });
    }
    if (path.startsWith("/problems/reasons")) {
      if (options.reasons instanceof Error) return jsonResponse({}, 500);
      return jsonResponse(options.reasons ?? REASONS);
    }
    if (path.startsWith("/problems/sync/status")) return jsonResponse(statuses);
    const action = /^\/problems\/sync\/accounts\/([^/]+)\/(?:(historical)\/)?(start|pause|resume)$/.exec(path);
    if (action) {
      const next =
        action[2] === "historical"
          ? syncStatus({ historicalStatus: action[3] === "pause" ? "PAUSED" : "RUNNING" })
          : syncStatus({ jobStatus: action[3] === "pause" ? "PAUSED" : "RUNNING" });
      statuses = [next];
      return jsonResponse(next);
    }
    if (new RegExp(`^/problems/${PROBLEM_1_ID}/responsibility$`).test(path)) {
      return jsonResponse({ ...DETAIL, responsibility: "SELLER", responsibilityConfidence: "MANUAL" });
    }
    if (path === `/problems/${PROBLEM_1_ID}`) return jsonResponse(DETAIL);
    if (path.startsWith("/problems")) {
      if (options.list instanceof Error) return jsonResponse({}, 500);
      return jsonResponse(options.list ?? LIST);
    }
    return jsonResponse({}, 404);
  });
  return calls;
}

export const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const callsTo = (calls: Call[], prefix: string): Call[] =>
  calls.filter((call) => call.path === prefix || call.path.startsWith(`${prefix}?`));

export const paramsOf = (call: Call): URLSearchParams => new URL(call.path, "http://x").searchParams;
