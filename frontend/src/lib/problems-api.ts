import { ApiFetchError, apiFetch } from "@/lib/api";
import type {
  ManualProblemResponsibility,
  ProblemDetailDto,
  ProblemReasonOptionDto,
  ProblemSortField,
  ProblemsFilters,
  ProblemsPageDto,
  ProblemsSummaryDto,
  ProblemsSyncStatusDto,
  SortDirection,
} from "@/types/problems";

/** 403: o usuário não tem a permissão exigida pela rota. */
export class ProblemsForbiddenError extends ApiFetchError {}
/** 404 genérico (inexistente ou fora do escopo de contas — indistinguíveis de propósito). */
export class ProblemNotFoundError extends ApiFetchError {}

export interface ProblemsPaging {
  page: number;
  pageSize: number;
  sortBy: ProblemSortField;
  sortDir: SortDirection;
}

/** Só filtros preenchidos viram parâmetro — nunca `undefined`/vazio na URL. */
export function problemsFiltersToParams(filters: ProblemsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.marketplace !== "ALL") params.set("marketplace", filters.marketplace);
  if (filters.accountId) params.set("accountId", filters.accountId);
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.reasonId) params.set("reasonId", filters.reasonId);
  if (filters.responsibility !== "ALL") params.set("responsibility", filters.responsibility);
  if (filters.reputationImpact !== "ALL") params.set("reputationImpact", filters.reputationImpact);
  if (filters.pendingAction === "true") params.set("pendingAction", "true");
  if (filters.actionDue !== "ALL") params.set("actionDue", filters.actionDue);
  if (filters.orderId.trim()) params.set("orderId", filters.orderId.trim());
  return params;
}

const query = (params: URLSearchParams): string =>
  params.toString() ? `?${params.toString()}` : "";

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 403) {
    throw new ProblemsForbiddenError("Você não tem permissão para esta ação.", "FORBIDDEN");
  }
  if (response.status === 404) {
    throw new ProblemNotFoundError(
      "Não encontramos este item. Ele pode não existir ou estar fora das suas contas.",
      "NOT_FOUND",
    );
  }
  if (response.status === 400) {
    throw new ApiFetchError("Dados inválidos. Revise os campos e tente novamente.", "INVALID");
  }
  throw new ApiFetchError(fallback);
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, fallback);
  return (await response.json()) as T;
}

export function fetchProblemsSummary(filters: ProblemsFilters): Promise<ProblemsSummaryDto> {
  return getJson(
    `/problems/summary${query(problemsFiltersToParams(filters))}`,
    "Não foi possível carregar o resumo agora.",
  );
}

/** Motivos do recorte atual — o filtro de motivo em si é omitido pelo chamador (senão o seletor esvazia). */
export function fetchProblemsReasons(filters: ProblemsFilters): Promise<ProblemReasonOptionDto[]> {
  return getJson(
    `/problems/reasons${query(problemsFiltersToParams(filters))}`,
    "Não foi possível carregar os motivos agora.",
  );
}

export function fetchProblems(
  filters: ProblemsFilters,
  paging: ProblemsPaging,
): Promise<ProblemsPageDto> {
  const params = problemsFiltersToParams(filters);
  params.set("page", String(paging.page));
  params.set("pageSize", String(paging.pageSize));
  params.set("sortBy", paging.sortBy);
  params.set("sortDir", paging.sortDir);
  return getJson(`/problems${query(params)}`, "Não foi possível carregar os problemas agora.");
}

export function fetchProblemDetail(id: string): Promise<ProblemDetailDto> {
  return getJson(
    `/problems/${encodeURIComponent(id)}`,
    "Não foi possível carregar o detalhe agora.",
  );
}

export async function updateProblemResponsibility(
  id: string,
  input: { responsibility: ManualProblemResponsibility; reason: string },
): Promise<ProblemDetailDto> {
  const response = await apiFetch(`/problems/${encodeURIComponent(id)}/responsibility`, {
    method: "PATCH",
    body: JSON.stringify(input),
    // Mutação: nunca reenviada automaticamente após refresh de sessão.
    retryOnUnauthorized: false,
  });
  await ensureOk(response, "Não foi possível salvar a responsabilidade agora.");
  return (await response.json()) as ProblemDetailDto;
}

export function fetchProblemsSyncStatus(): Promise<ProblemsSyncStatusDto[]> {
  return getJson("/problems/sync/status", "Não foi possível carregar a sincronização agora.");
}

export type ProblemsSyncAction = "start" | "pause" | "resume";

export async function changeProblemsSync(
  accountId: string,
  action: ProblemsSyncAction,
): Promise<ProblemsSyncStatusDto> {
  const response = await apiFetch(
    `/problems/sync/accounts/${encodeURIComponent(accountId)}/${action}`,
    { method: "POST", retryOnUnauthorized: false },
  );
  await ensureOk(response, "Não foi possível alterar a sincronização agora.");
  return (await response.json()) as ProblemsSyncStatusDto;
}
