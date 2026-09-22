import { formatBRL, formatDecimal } from "@/lib/kpi-format";
import type { AnalyticsSummary, MarketplaceFilter } from "@/types/marketplace-analytics";

interface ExpensesAndResultSectionProps {
  summary: AnalyticsSummary;
  /**
   * Marketplace efetivo do escopo exibido — mesma prop/regra de
   * `FinancialKpiCards` (CP2K-8D, item 6): para "ALL" com uma conta
   * selecionada, é o marketplace DESSA conta, não "ALL".
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
 * "Despesas e resultado" — só tem dado real para Mercado Livre hoje (mesma
 * limitação de `FinancialKpiCards`, reaproveitando a mesma prop
 * `effectiveMarketplace`: nunca mostra "R$ 0,00" inventado para
 * Amazon/Shopee).
 *
 * "Despesas e ajustes conhecidos" soma SÓ `couponAmount` — `refundedAmount`
 * (pedidos `partially_refunded`, população disjunta de `grossRevenue`) fica
 * de fora porque não há prova de que `total_amount` desses pedidos já
 * reflita o reembolso; somar arriscaria descontar o mesmo dinheiro duas
 * vezes. Ele continua visível, à parte, no card "Valor reembolsado"
 * (`FinancialKpiCards`) como indicador puramente informativo.
 */
export function ExpensesAndResultSection({
  summary,
  effectiveMarketplace,
}: ExpensesAndResultSectionProps) {
  if (effectiveMarketplace === "AMAZON" || effectiveMarketplace === "SHOPEE") {
    return (
      <p className="text-xs text-foreground/50">
        Despesas e resultado ainda não disponíveis para este marketplace.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground/80">
        Despesas e resultado
      </h3>
      {effectiveMarketplace === "ALL" ? (
        <p className="text-xs text-foreground/50">
          Despesas e resultado calculados só com dados de Mercado Livre.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          testId="expenses-result-card-base"
          label="Base bruta considerada"
          value={formatBRL(summary.grossRevenue)}
          explanation="Faturamento de pedidos pagos (mesmo valor do cartão 'Faturamento bruto de pedidos pagos'). Pedidos parcialmente reembolsados não entram nesta base."
        />
        <Card
          testId="expenses-result-card-known-adjustments"
          label="Despesas e ajustes conhecidos"
          value={formatBRL(summary.knownAdjustmentsAmount)}
          explanation="Inclui: descontos em cupons. Reembolsos (pedidos parcialmente reembolsados) aparecem só no cartão 'Valor reembolsado', como indicador informativo — a base de dados disponível hoje não confirma se o valor do pedido já reflete o reembolso, então ele fica de fora daqui para nunca descontar o mesmo valor duas vezes."
        />
        <Card
          testId="expenses-result-card-pct"
          label="% sobre o faturamento pago"
          value={`${formatDecimal(summary.knownAdjustmentsPctOfGrossRevenue)}%`}
          explanation="Despesas e ajustes conhecidos dividido pela base bruta considerada."
        />
        <Card
          testId="expenses-result-card-result"
          label="Resultado após ajustes conhecidos"
          value={formatBRL(summary.resultAfterKnownAdjustments)}
          explanation="Base bruta considerada menos as despesas e ajustes conhecidos."
        />
      </div>
      <Card
        testId="expenses-result-card-margin"
        label="% do resultado sobre o faturamento pago"
        value={`${formatDecimal(summary.marginAfterKnownAdjustmentsPct)}%`}
        explanation="Resultado após ajustes conhecidos dividido pela base bruta considerada."
      />
      <p className="text-xs text-foreground/50">
        Resultado parcial com os dados financeiros disponíveis. Ainda não
        representa lucro, pois pode não incluir comissão, tarifas, impostos,
        Ads, frete do vendedor e custo dos produtos.
      </p>
    </div>
  );
}
