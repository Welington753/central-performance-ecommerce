import { render, screen, within } from "@testing-library/react";
import { FinancialKpiCards } from "./FinancialKpiCards";
import type { AnalyticsSummary } from "@/types/marketplace-analytics";

const baseSummary: AnalyticsSummary = {
  grossRevenue: "1000.00",
  orders: 8,
  units: 20,
  averageTicket: "125.00",
  cancelledOrders: 2,
  cancellationRate: 20,
  distinctProducts: 5,
  unitsPerOrder: 2.5,
  avgUnitPrice: "50.00",
  grossSalesRevenue: "1050.00",
  grossSalesOrders: 9,
  grossSalesUnits: 21,
  grossSalesAverageTicket: "116.67",
  grossSalesAvgUnitPrice: "52.50",
  cancelledUnits: 1,
  cancelledRevenue: "50.00",
  partiallyRefundedOrders: 0,
  partiallyRefundedGrossAmount: "0.00",
  refundCoverage: "COMPLETE",
  shippingCost: "150.00",
  couponAmount: "45.90",
  refundedAmount: "80.00",
  knownAdjustmentsAmount: "45.90",
  knownAdjustmentsPctOfGrossRevenue: 4.6,
  resultAfterKnownAdjustments: "954.10",
  marginAfterKnownAdjustmentsPct: 95.4,
};

describe("FinancialKpiCards", () => {
  it("shows the three exact card titles for MERCADO_LIVRE", () => {
    render(
      <FinancialKpiCards summary={baseSummary} effectiveMarketplace="MERCADO_LIVRE" />,
    );
    expect(screen.getByText("Frete pago pelo comprador")).toBeInTheDocument();
    expect(screen.getByText("Descontos em cupons")).toBeInTheDocument();
    expect(screen.getByText("Valor reembolsado")).toBeInTheDocument();
  });

  it("formats the three values in BRL for MERCADO_LIVRE", () => {
    render(
      <FinancialKpiCards summary={baseSummary} effectiveMarketplace="MERCADO_LIVRE" />,
    );
    expect(screen.getByTestId("financial-kpi-card-shipping-cost")).toHaveTextContent(
      /R\$\s?150,00/,
    );
    expect(screen.getByTestId("financial-kpi-card-coupon-amount")).toHaveTextContent(
      /R\$\s?45,90/,
    );
    expect(screen.getByTestId("financial-kpi-card-refunded-amount")).toHaveTextContent(
      /R\$\s?80,00/,
    );
  });

  it("shows the exact explanatory texts for each card", () => {
    render(
      <FinancialKpiCards summary={baseSummary} effectiveMarketplace="MERCADO_LIVRE" />,
    );
    expect(
      within(screen.getByTestId("financial-kpi-card-shipping-cost")).getByText(
        "Valor de frete cobrado do comprador. Não é somado ao faturamento e não representa o custo de frete do vendedor.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("financial-kpi-card-coupon-amount")).getByText(
        "Descontos aplicados por cupons. O faturamento bruto exibido no painel ainda não desconta este valor.",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("financial-kpi-card-refunded-amount")).getByText(
        "Valor devolvido ao comprador em pedidos parcialmente reembolsados. Não representa cancelamentos.",
      ),
    ).toBeInTheDocument();
  });

  it("never uses forbidden wording (net revenue, commission, seller shipping cost, profit)", () => {
    render(
      <FinancialKpiCards summary={baseSummary} effectiveMarketplace="MERCADO_LIVRE" />,
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Receita líquida/i);
    expect(text).not.toMatch(/Comissão/i);
    expect(text).not.toMatch(/Lucro/i);
  });

  it("formats a real Mercado Livre zero (\"0.00\") normally, not as missing data", () => {
    render(
      <FinancialKpiCards
        summary={{ ...baseSummary, shippingCost: "0.00", couponAmount: "0.00", refundedAmount: "0.00" }}
        effectiveMarketplace="MERCADO_LIVRE"
      />,
    );
    expect(screen.getByTestId("financial-kpi-card-shipping-cost")).toHaveTextContent(
      /R\$\s?0,00/,
    );
  });

  it("shows the three cards (no warning) for MERCADO_LIVRE", () => {
    render(
      <FinancialKpiCards summary={baseSummary} effectiveMarketplace="MERCADO_LIVRE" />,
    );
    expect(
      screen.queryByText(/disponíveis somente para Mercado Livre/i),
    ).not.toBeInTheDocument();
  });

  it("shows the three cards plus the 'only Mercado Livre' notice for ALL", () => {
    render(<FinancialKpiCards summary={baseSummary} effectiveMarketplace="ALL" />);
    expect(screen.getByText("Frete pago pelo comprador")).toBeInTheDocument();
    expect(
      screen.getByText("Dados financeiros disponíveis somente para Mercado Livre."),
    ).toBeInTheDocument();
  });

  it("does not show fake R$ 0,00 financial cards for AMAZON — shows a single discreet message instead", () => {
    render(<FinancialKpiCards summary={baseSummary} effectiveMarketplace="AMAZON" />);
    expect(screen.queryByText("Frete pago pelo comprador")).not.toBeInTheDocument();
    expect(screen.queryByText("Descontos em cupons")).not.toBeInTheDocument();
    expect(screen.queryByText("Valor reembolsado")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Indicadores financeiros detalhados ainda não disponíveis para este marketplace.",
      ),
    ).toBeInTheDocument();
  });

  it("does not show fake R$ 0,00 financial cards for SHOPEE — shows a single discreet message instead", () => {
    render(<FinancialKpiCards summary={baseSummary} effectiveMarketplace="SHOPEE" />);
    expect(screen.queryByText("Frete pago pelo comprador")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Indicadores financeiros detalhados ainda não disponíveis para este marketplace.",
      ),
    ).toBeInTheDocument();
  });
});
