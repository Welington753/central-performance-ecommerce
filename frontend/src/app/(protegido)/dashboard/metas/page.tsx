"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useMonthlyGoalProgress } from "@/hooks/useMonthlyGoalProgress";
import { MonthSelector } from "@/components/goals/MonthSelector";
import { GoalSummaryCards } from "@/components/goals/GoalSummaryCards";
import { GoalProgressBar } from "@/components/goals/GoalProgressBar";
import { GoalPaceChart } from "@/components/goals/GoalPaceChart";
import { GoalEditModal } from "@/components/goals/GoalEditModal";
import { RefundsCoverageBanner } from "@/components/goals/RefundsCoverageBanner";

function todaySaoPaulo(): { year: number; month: number } {
  // Só para o valor PADRÃO inicial do seletor de mês — todo cálculo real de
  // ritmo/meta é feito no backend, sempre em America/Sao_Paulo de verdade.
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function readYearMonthFromParams(
  searchParams: URLSearchParams,
): { year: number; month: number } {
  const yearRaw = searchParams.get("year");
  const monthRaw = searchParams.get("month");
  const year = yearRaw ? Number(yearRaw) : NaN;
  const month = monthRaw ? Number(monthRaw) : NaN;
  if (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  ) {
    return { year, month };
  }
  return todaySaoPaulo();
}

function MetasContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { year, month } = readYearMonthFromParams(searchParams);

  const { user } = useCurrentUser();
  const { data, isLoading, isAuthError, error, retry } = useMonthlyGoalProgress(
    year,
    month,
  );
  const [isEditOpen, setIsEditOpen] = useState(false);

  function handleMonthChange(next: { year: number; month: number }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(next.year));
    params.set("month", String(next.month));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Acompanhamento da Meta de Faturamento
          </h1>
          <p className="mt-1 text-sm text-foreground/60">
            Meta consolidada — todas as contas e marketplaces.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MonthSelector year={year} month={month} onChange={handleMonthChange} />
          {user?.isAdmin ? (
            <button
              type="button"
              onClick={() => setIsEditOpen(true)}
              className="rounded-md border border-brand bg-brand/10 px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/20"
            >
              {data?.goal.configured ? "Alterar meta" : "Cadastrar meta"}
            </button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-border-subtle bg-surface px-6 py-20 text-center">
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
            role="status"
            aria-label="Carregando progresso da meta"
          />
          <p className="text-sm text-foreground/60">Carregando...</p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-6 text-sm text-red-700"
        >
          <p>{error}</p>
          {isAuthError ? (
            <p>Faça login novamente para continuar.</p>
          ) : (
            <button
              type="button"
              onClick={retry}
              className="rounded-md border border-red-500/40 px-3 py-1.5 font-medium hover:bg-red-500/10"
            >
              Tentar novamente
            </button>
          )}
        </div>
      ) : data ? (
        <>
          {!data.goal.configured ? (
            <div className="rounded-xl border border-dashed border-border-subtle bg-surface p-6 text-sm text-foreground/70">
              Nenhuma meta cadastrada para {data.month}/{data.year}.
              {user?.isAdmin
                ? " Use o botão “Cadastrar meta” acima."
                : " Peça a um administrador para cadastrá-la."}
            </div>
          ) : null}

          <RefundsCoverageBanner refunds={data.refunds} />

          <GoalProgressBar achievementPercentage={data.live.achievementPercentage} />

          <GoalSummaryCards progress={data} />

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              Realizado acumulado × Ritmo esperado
            </h2>
            <GoalPaceChart
              dailyPace={data.dailyPace}
              isCurrentMonth={data.closedDays.daysCompleted < data.closedDays.daysInMonth}
            />
          </section>
        </>
      ) : null}

      {isEditOpen && data ? (
        <GoalEditModal
          year={year}
          month={month}
          currentTargetAmount={data.goal.targetAmount}
          onClose={() => setIsEditOpen(false)}
          onSaved={() => {
            setIsEditOpen(false);
            retry();
          }}
        />
      ) : null}
    </div>
  );
}

export default function MetasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center px-6 py-24">
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-border-subtle border-t-brand"
            role="status"
            aria-label="Carregando"
          />
        </div>
      }
    >
      <MetasContent />
    </Suspense>
  );
}
