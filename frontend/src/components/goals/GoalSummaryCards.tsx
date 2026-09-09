import {
  formatAchievementPercentage,
  formatBRLOrUnavailable,
} from "@/lib/goal-format";
import type { MonthlyRevenueGoalProgressDto } from "@/types/monthly-revenue-goal";

interface GoalCardProps {
  title: string;
  value: string;
  subtitle?: string;
}

function GoalCard({ title, value, subtitle }: GoalCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-surface p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
        {title}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {subtitle ? (
        <span className="text-xs text-foreground/50">{subtitle}</span>
      ) : null}
    </div>
  );
}

interface GoalSummaryCardsProps {
  progress: MonthlyRevenueGoalProgressDto;
}

/**
 * Os oito cards de "Metas e Ritmo" (Checkpoint BI-1, design §7). Nenhum
 * valor UNAVAILABLE aparece como "R$ 0,00" — `formatBRLOrUnavailable`/
 * `formatAchievementPercentage` sempre mostram "Indisponível" explícito
 * nesse caso.
 */
export function GoalSummaryCards({ progress }: GoalSummaryCardsProps) {
  const { live, closedDays, goal } = progress;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <GoalCard
        title="Faturamento realizado"
        value={formatBRLOrUnavailable(live.eligibleRevenue)}
        subtitle="Pedidos pagos, inclui hoje — bruto, nunca lucro"
      />
      <GoalCard
        title="Meta de faturamento"
        value={goal.configured ? formatBRLOrUnavailable(goal.targetAmount) : "Sem meta cadastrada"}
      />
      <GoalCard
        title="Meta atingida"
        value={formatAchievementPercentage(live.achievementPercentage)}
      />
      <GoalCard
        title="Falta para meta"
        value={formatBRLOrUnavailable(live.remainingAmount)}
      />
      <GoalCard
        title="Média diária até ontem"
        value={formatBRLOrUnavailable(closedDays.currentDailyAverage)}
        subtitle={`${closedDays.daysCompleted} dia(s) encerrado(s)`}
      />
      <GoalCard
        title="Esperado até ontem"
        value={formatBRLOrUnavailable(closedDays.expectedRevenue)}
      />
      <GoalCard
        title="Projeção do mês"
        value={formatBRLOrUnavailable(closedDays.projectedRevenue)}
        subtitle={
          closedDays.projectedRevenue === null
            ? "Precisa de ao menos 1 dia encerrado"
            : undefined
        }
      />
      <GoalCard
        title="Necessário por dia a partir de hoje"
        value={formatBRLOrUnavailable(closedDays.requiredDailyRevenue)}
        subtitle="Baseado nos dias encerrados até ontem"
      />
    </div>
  );
}
