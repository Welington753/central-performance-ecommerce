import { formatBRLOrUnavailable } from "@/lib/goal-format";
import { formatCalendarDateShort } from "@/lib/kpi-format";
import type { MonthlyRevenueGoalDailyPacePoint } from "@/types/monthly-revenue-goal";

interface GoalPaceChartProps {
  dailyPace: MonthlyRevenueGoalDailyPacePoint[];
  isCurrentMonth: boolean;
}

const CHART_HEIGHT = 160;
const CHART_WIDTH = 640;

function toPoints(
  values: (number | null)[],
  maxValue: number,
): string {
  if (maxValue <= 0) return "";
  const step = values.length > 1 ? CHART_WIDTH / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      if (value === null) return null;
      const x = index * step;
      const y = CHART_HEIGHT - (value / maxValue) * (CHART_HEIGHT - 4);
      return `${x},${y}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");
}

/**
 * "Realizado acumulado × Ritmo esperado" (design §7) — SVG/CSS puro (mesmo
 * padrão de `DailyRevenueChart`, nenhuma lib de gráficos instalada).
 * `<svg>` decorativo (`aria-hidden`); a tabela abaixo é a fonte real de
 * informação para leitores de tela. A linha "realizado" só desenha pontos
 * até o dia encerrado mais recente — nunca inventa um valor para hoje/dias
 * futuros (pontos `null` simplesmente não geram ponto na linha).
 */
export function GoalPaceChart({ dailyPace, isCurrentMonth }: GoalPaceChartProps) {
  if (dailyPace.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        Nenhum dado de ritmo disponível para este mês.
      </p>
    );
  }

  const targetValues = dailyPace.map((p) =>
    p.targetCumulative === null ? null : Number(p.targetCumulative),
  );
  const realizedValues = dailyPace.map((p) =>
    p.realizedCumulative === null ? null : Number(p.realizedCumulative),
  );
  const maxValue = Math.max(
    ...targetValues.filter((v): v is number => v !== null),
    ...realizedValues.filter((v): v is number => v !== null),
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface p-4">
        <svg
          role="img"
          aria-label={`Gráfico de realizado acumulado comparado ao ritmo esperado da meta, ao longo do mês. Veja a tabela abaixo para os valores exatos.`}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="min-w-full"
          preserveAspectRatio="none"
          height={CHART_HEIGHT}
        >
          {maxValue > 0 ? (
            <>
              <polyline
                points={toPoints(targetValues, maxValue)}
                fill="none"
                className="stroke-foreground/30"
                strokeWidth={2}
                strokeDasharray="4 3"
              />
              <polyline
                points={toPoints(realizedValues, maxValue)}
                fill="none"
                className="stroke-brand"
                strokeWidth={2.5}
              />
            </>
          ) : null}
        </svg>
        <div className="mt-2 flex gap-4 text-xs text-foreground/60">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-brand" /> Realizado acumulado
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-t-2 border-dashed border-foreground/30" />
            Ritmo esperado
          </span>
        </div>
        {isCurrentMonth ? (
          <p className="mt-1 text-xs text-foreground/50">
            Dados de realizado encerrados até ontem.
          </p>
        ) : null}
      </div>

      <details className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-foreground/70">
          Ver tabela de ritmo diário
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
                <th scope="col" className="px-3 py-2 font-medium">
                  Dia
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Realizado acumulado
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Ritmo esperado
                </th>
              </tr>
            </thead>
            <tbody>
              {dailyPace.map((point) => (
                <tr
                  key={point.date}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="px-3 py-2">
                    {formatCalendarDateShort(point.date)}
                  </td>
                  <td className="px-3 py-2">
                    {formatBRLOrUnavailable(point.realizedCumulative)}
                  </td>
                  <td className="px-3 py-2">
                    {formatBRLOrUnavailable(point.targetCumulative)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
