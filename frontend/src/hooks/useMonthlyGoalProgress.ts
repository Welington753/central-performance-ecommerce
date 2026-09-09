"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFetchError } from "@/lib/api";
import {
  UnauthorizedGoalApiError,
  fetchMonthlyGoalProgress,
} from "@/lib/goals-api";
import type { MonthlyRevenueGoalProgressDto } from "@/types/monthly-revenue-goal";

export interface MonthlyGoalProgressState {
  data: MonthlyRevenueGoalProgressDto | null;
  /** Ano/mês do `data` atual — só reaproveitado quando bate EXATAMENTE com o mês pedido; nunca dado de outro mês. */
  dataYear: number | null;
  dataMonth: number | null;
  isLoading: boolean;
  isAuthError: boolean;
  error: string | null;
}

/**
 * Carrega o progresso de meta/ritmo do mês selecionado (Checkpoint BI-1) —
 * mesma proteção de corrida do dashboard principal: sequência monotônica
 * por requisição, então trocar de mês rapidamente nunca deixa uma resposta
 * antiga (mais lenta) sobrescrever uma mais nova que já chegou. Dado de um
 * mês anterior nunca é reaproveitado ao trocar de mês — some imediatamente
 * (loading) até a resposta do novo mês chegar.
 */
export function useMonthlyGoalProgress(
  year: number,
  month: number,
): MonthlyGoalProgressState & { retry: () => void } {
  const [state, setState] = useState<MonthlyGoalProgressState>({
    data: null,
    dataYear: null,
    dataMonth: null,
    isLoading: true,
    isAuthError: false,
    error: null,
  });
  const requestSeqRef = useRef(0);

  const load = useCallback(async (targetYear: number, targetMonth: number) => {
    const seq = ++requestSeqRef.current;
    setState((prev) => ({
      ...prev,
      isLoading: true,
      error: null,
      isAuthError: false,
      // Nunca mistura dado de outro mês enquanto carrega o novo.
      data: prev.dataYear === targetYear && prev.dataMonth === targetMonth ? prev.data : null,
      dataYear: prev.dataYear === targetYear && prev.dataMonth === targetMonth ? prev.dataYear : null,
      dataMonth: prev.dataYear === targetYear && prev.dataMonth === targetMonth ? prev.dataMonth : null,
    }));

    try {
      const data = await fetchMonthlyGoalProgress(targetYear, targetMonth);
      // Uma requisição mais nova já começou — esta resposta chegou tarde
      // demais e nunca pode sobrescrever o estado atual.
      if (requestSeqRef.current !== seq) return;
      setState({
        data,
        dataYear: targetYear,
        dataMonth: targetMonth,
        isLoading: false,
        isAuthError: false,
        error: null,
      });
    } catch (error) {
      if (requestSeqRef.current !== seq) return;
      const message =
        error instanceof ApiFetchError
          ? error.message
          : "Não foi possível carregar o progresso agora.";
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isAuthError: error instanceof UnauthorizedGoalApiError,
        error: message,
      }));
    }
  }, []);

  useEffect(() => {
    void load(year, month);
  }, [year, month, load]);

  const retry = useCallback(() => {
    void load(year, month);
  }, [year, month, load]);

  return { ...state, retry };
}
