import { formatBRL } from "@/lib/kpi-format";
import type { AnalyticsSummary, MarketplaceFilter } from "@/types/marketplace-analytics";

interface FinancialKpiCardsProps {
  summary: AnalyticsSummary;
  /**
   * Marketplace efetivo do escopo exibido — para "ALL" com uma conta
   * selecionada, é o marketplace DESSA conta, não "ALL" (CP2K-8D, item 6).
   */
  effectiveMarketplace: MarketplaceFilter;
}

function Card({
  testId,
  label,
  value,
  explanation,
}: {
  testId: string;
  label: string;
  value: string;
  explanation: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-surface px-5 py-4"
    >
      <p className="text-sm text-foreground/60">{label}</p>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
      <p className="text-xs text-foreground/40">{explanation}</p>
    </div>
  );
}

/**
 * Três agregados financeiros confirmados (CP2K-8B) exibidos no dashboard
 * (CP2K-8D) — só têm dado real para Mercado Livre hoje. Nunca mostra
 * "R$ 0,00" como se fosse dado real de Amazon/Shopee (regra C).
 */
export function FinancialKpiCards({
  summary,
  effectiveMarketplace,
}: FinancialKpiCardsProps) {
  if (effectiveMarketplace === "AMAZON" || effectiveMarketplace === "SHOPEE") {
    return (
      <p className="text-xs text-foreground/50">
        Indicadores financeiros detalhados ainda não disponíveis para este
        marketplace.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {effectiveMarketplace === "ALL" ? (
        <p className="text-xs text-foreground/50">
          Dados financeiros disponíveis somente para Mercado Livre.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card
          testId="financial-kpi-card-shipping-cost"
          label="Frete pago pelo comprador"
          value={formatBRL(summary.shippingCost)}
          explanation="Valor de frete cobrado do comprador. Não é somado ao faturamento e não representa o custo de frete do vendedor."
        />
        <Card
          testId="financial-kpi-card-coupon-amount"
          label="Descontos em cupons"
          value={formatBRL(summary.couponAmount)}
          explanation="Descontos aplicados por cupons. O faturamento bruto exibido no painel ainda não desconta este valor."
        />
        <Card
          testId="financial-kpi-card-refunded-amount"
          label="Valor reembolsado"
          value={formatBRL(summary.refundedAmount)}
          explanation="Valor devolvido ao comprador em pedidos parcialmente reembolsados. Não representa cancelamentos."
        />
      </div>
    </div>
  );
}
