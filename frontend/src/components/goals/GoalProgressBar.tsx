import { formatAchievementPercentage } from "@/lib/goal-format";

interface GoalProgressBarProps {
  achievementPercentage: number | null;
}

/**
 * Indicador visual de progresso (design §7) — barra limitada visualmente a
 * 100% de largura mesmo quando o percentual real ultrapassa isso (o número
 * exibido ao lado nunca é limitado). Sem meta configurada/UNAVAILABLE, some
 * a barra e mostra só o texto — nunca uma barra vazia fingindo "0%".
 */
export function GoalProgressBar({ achievementPercentage }: GoalProgressBarProps) {
  if (achievementPercentage === null) {
    return (
      <p className="text-sm text-foreground/60">
        Progresso indisponível — cadastre uma meta para acompanhar.
      </p>
    );
  }

  const clampedWidth = Math.min(Math.max(achievementPercentage, 0), 100);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-valuenow={Math.round(achievementPercentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Percentual da meta de faturamento atingido"
        className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className={
            achievementPercentage >= 100 ? "h-full bg-green-600" : "h-full bg-brand"
          }
          style={{ width: `${clampedWidth}%` }}
        />
      </div>
      <span className="text-sm font-medium tabular-nums">
        {formatAchievementPercentage(achievementPercentage)} da meta
      </span>
    </div>
  );
}
