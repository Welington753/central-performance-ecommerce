import { formatBRL, formatCalendarDateShort } from "@/lib/kpi-format";
import type { MercadoLivreKpisDto } from "@/types/mercado-livre-kpis";

interface DailyRevenueChartProps {
  dailySeries: MercadoLivreKpisDto["dailySeries"];
}

const CHART_HEIGHT = 160;
const BAR_WIDTH = 10;
const BAR_GAP = 4;

/**
 * Gráfico de faturamento diário (Checkpoint 2, "Evolução diária") —
 * implementado em SVG/CSS puro (nenhuma lib de gráficos instalada no
 * projeto). Sempre acompanhado de uma tabela equivalente para acessibilidade
 * — o `<svg>` é puramente decorativo (`aria-hidden`), a tabela é a fonte
 * real de informação para leitores de tela.
 */
export function DailyRevenueChart({ dailySeries }: DailyRevenueChartProps) {
  if (dailySeries.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        Nenhum dado diário disponível para o período.
      </p>
    );
  }

  const values = dailySeries.map((point) => Number(point.grossRevenue));
  const maxValue = Math.max(...values, 0);
  const svgWidth = dailySeries.length * (BAR_WIDTH + BAR_GAP);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface p-4">
        <svg
          role="img"
          aria-label={`Gráfico de faturamento bruto diário, de ${dailySeries[0].date} a ${
            dailySeries[dailySeries.length - 1].date
          }. Veja a tabela abaixo para os valores exatos.`}
          width={svgWidth}
          height={CHART_HEIGHT}
          className="min-w-full"
        >
          {dailySeries.map((point, index) => {
            const value = values[index];
            const barHeight =
              maxValue > 0 ? Math.max((value / maxValue) * (CHART_HEIGHT - 4), value > 0 ? 2 : 0) : 0;
            return (
              <rect
                key={point.date}
                x={index * (BAR_WIDTH + BAR_GAP)}
                y={CHART_HEIGHT - barHeight}
                width={BAR_WIDTH}
                height={barHeight}
                className={value > 0 ? "fill-brand" : "fill-foreground/10"}
              >
                <title>
                  {point.date}: {formatBRL(point.grossRevenue)}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>

      <details className="rounded-xl border border-border-subtle bg-surface px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-foreground/70">
          Ver tabela de faturamento diário
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-foreground/50">
                <th scope="col" className="px-3 py-2 font-medium">
                  Dia
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Faturamento bruto
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Pedidos pagos
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Unidades
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Cancelados
                </th>
              </tr>
            </thead>
            <tbody>
              {dailySeries.map((point) => (
                <tr
                  key={point.date}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="px-3 py-2">
                    {formatCalendarDateShort(point.date)}
                  </td>
                  <td className="px-3 py-2">{formatBRL(point.grossRevenue)}</td>
                  <td className="px-3 py-2">{point.paidOrders}</td>
                  <td className="px-3 py-2">{point.units}</td>
                  <td className="px-3 py-2">{point.cancelledOrders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
