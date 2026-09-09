import { formatBRL } from "@/lib/kpi-format";
import type { MonthlyRevenueGoalProgressRefunds } from "@/types/monthly-revenue-goal";

interface RefundsCoverageBannerProps {
  refunds: MonthlyRevenueGoalProgressRefunds;
}

/**
 * Aviso de cobertura de estornos (design §7) — só aparece quando existe ao
 * menos um pedido `partially_refunded` no mês (`coverage === "PARTIAL"`).
 * Nunca chama o valor bruto exibido de "líquido" — o valor efetivamente
 * estornado não está disponível hoje (auditoria "contrato de dados").
 */
export function RefundsCoverageBanner({ refunds }: RefundsCoverageBannerProps) {
  if (refunds.coverage !== "PARTIAL") return null;

  return (
    <div
      role="status"
      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800"
    >
      Existem {refunds.partiallyRefundedOrders} pedido(s) parcialmente
      reembolsado(s), totalizando {formatBRL(refunds.partiallyRefundedGrossAmount)}{" "}
      em valor bruto. O valor líquido após estornos ainda não está
      disponível; esses pedidos não entram no faturamento realizado.
    </div>
  );
}
