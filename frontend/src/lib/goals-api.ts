/**
 * Cliente HTTP dedicado à meta mensal consolidada (Checkpoint BI-1,
 * "Metas e Ritmo") — deliberadamente separado de `lib/api.ts` (já grande)
 * em vez de crescer aquele arquivo.
 */
import { ApiFetchError, apiFetch } from "@/lib/api";
import type {
  MonthlyRevenueGoalDto,
  MonthlyRevenueGoalLookupDto,
  MonthlyRevenueGoalProgressDto,
} from "@/types/monthly-revenue-goal";

/** 401/403 — sessão expirada ou (no PUT) usuário sem privilégio de administrador. */
export class UnauthorizedGoalApiError extends ApiFetchError {}
export class InvalidGoalQueryApiError extends ApiFetchError {}

function yearMonthQuery(year: number, month: number): string {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
  });
  return params.toString();
}

export async function fetchMonthlyGoal(
  year: number,
  month: number,
): Promise<MonthlyRevenueGoalLookupDto> {
  const response = await apiFetch(
    `/marketplace-analytics/goals/monthly?${yearMonthQuery(year, month)}`,
  );
  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedGoalApiError("Sessão expirada. Entre novamente.");
  }
  if (response.status === 400) {
    throw new InvalidGoalQueryApiError("Período inválido.");
  }
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível carregar a meta agora.");
  }
  return (await response.json()) as MonthlyRevenueGoalLookupDto;
}

export interface UpsertMonthlyGoalInput {
  year: number;
  month: number;
  currencyId: "BRL";
  targetAmount: number;
}

export async function upsertMonthlyGoal(
  input: UpsertMonthlyGoalInput,
): Promise<MonthlyRevenueGoalDto> {
  const response = await apiFetch("/marketplace-analytics/goals/monthly", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedGoalApiError(
      "Somente administradores podem cadastrar ou alterar a meta.",
    );
  }
  if (response.status === 400) {
    throw new ApiFetchError(
      "Dados inválidos. Confira o mês, ano e o valor da meta.",
    );
  }
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível salvar a meta agora.");
  }
  return (await response.json()) as MonthlyRevenueGoalDto;
}

export async function fetchMonthlyGoalProgress(
  year: number,
  month: number,
): Promise<MonthlyRevenueGoalProgressDto> {
  const response = await apiFetch(
    `/marketplace-analytics/goals/monthly-progress?${yearMonthQuery(year, month)}`,
  );
  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedGoalApiError("Sessão expirada. Entre novamente.");
  }
  if (response.status === 400) {
    throw new InvalidGoalQueryApiError("Período inválido.");
  }
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível carregar o progresso agora.");
  }
  return (await response.json()) as MonthlyRevenueGoalProgressDto;
}
