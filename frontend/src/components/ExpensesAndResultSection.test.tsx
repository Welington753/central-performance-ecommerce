import { render, screen, within } from "@testing-library/react";
import { ExpensesAndResultSection } from "./ExpensesAndResultSection";
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
  partiallyRefundedOrders: 1,
  partiallyRefundedGrossAmount: "200.00",
  refundCoverage: "PARTIAL",
  shippingCost: "150.00",
  couponAmount: "45.90",
  refundedAmount: "80.00",
  knownAdjustmentsAmount: "45.90",
  knownAdjustmentsPctOfGrossRevenue: 4.6,
  resultAfterKnownAdjustments: "954.10",
  marginAfterKnownAdjustmentsPct: 95.4,
};

describe("ExpensesAndResultSection", () => {
  it("shows the five cards with pt-BR formatted values for MERCADO_LIVRE", () => {
    render(
      <ExpensesAndResultSection
        summary={baseSummary}
        effectiveMarketplace="MERCADO_LIVRE"
      />,
    );
    expect(screen.getByTestId("expenses-result-card-base")).toHaveTextContent(
      /R\$\s?1\.000,00/,
    );
    expect(
      screen.getByTestId("expenses-result-card-known-adjustments"),
    ).toHaveTextContent(/R\$\s?45,90/);
    expect(screen.getByTestId("expenses-result-card-pct")).toHaveTextContent(
      "4,6%",
    );
    expect(
      screen.getByTestId("expenses-result-card-result"),
    ).toHaveTextContent(/R\$\s?954,10/);
    expect(
      screen.getByTestId("expenses-result-card-margin"),
    ).toHaveTextContent("95,4%");
  });

  it("never labels the result as net or gross accounting profit", () => {
    render(
      <ExpensesAndResultSection
        summary={baseSummary}
        effectiveMarketplace="MERCADO_LIVRE"
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/lucro líquido/i);
    expect(text).not.toMatch(/lucro bruto/i);
  });

  it("shows the partial-result disclaimer", () => {
    render(
      <ExpensesAndResultSection
        summary={baseSummary}
        effectiveMarketplace="MERCADO_LIVRE"
      />,
    );
    expect(
      screen.getByText(
        "Resultado parcial com os dados financeiros disponíveis. Ainda não representa lucro, pois pode não incluir comissão, tarifas, impostos, Ads, frete do vendedor e custo dos produtos.",
      ),
    ).toBeInTheDocument();
  });

  it("explains that refunded orders are not double-discounted — refund stays informative only", () => {
    render(
      <ExpensesAndResultSection
        summary={baseSummary}
        effectiveMarketplace="MERCADO_LIVRE"
      />,
    );
    expect(
      within(
        screen.getByTestId("expenses-result-card-known-adjustments"),
      ).getByText(/fica de fora daqui para nunca descontar o mesmo valor duas vezes/i),
    ).toBeInTheDocument();
  });

  it("safely handles zero gross revenue — 0%, never NaN/Infinity", () => {
    render(
      <ExpensesAndResultSection
        summary={{
          ...baseSummary,
          grossRevenue: "0.00",
          knownAdjustmentsAmount: "0.00",
          knownAdjustmentsPctOfGrossRevenue: 0,
          resultAfterKnownAdjustments: "0.00",
          marginAfterKnownAdjustmentsPct: 0,
        }}
        effectiveMarketplace="MERCADO_LIVRE"
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/NaN/);
    expect(text).not.toMatch(/Infinity/);
    expect(screen.getByTestId("expenses-result-card-pct")).toHaveTextContent(
      "0,0%",
    );
  });

  it("shows the 'only Mercado Livre' notice for ALL", () => {
    render(
      <ExpensesAndResultSection summary={baseSummary} effectiveMarketplace="ALL" />,
    );
    expect(
      screen.getByText("Despesas e resultado calculados só com dados de Mercado Livre."),
    ).toBeInTheDocument();
  });

  it("does not show fake numbers for AMAZON — shows a single discreet message instead", () => {
    render(
      <ExpensesAndResultSection summary={baseSummary} effectiveMarketplace="AMAZON" />,
    );
    expect(
      screen.queryByTestId("expenses-result-card-result"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Despesas e resultado ainda não disponíveis para este marketplace.",
      ),
    ).toBeInTheDocument();
  });

  it("does not show fake numbers for SHOPEE — shows a single discreet message instead", () => {
    render(
      <ExpensesAndResultSection summary={baseSummary} effectiveMarketplace="SHOPEE" />,
    );
    expect(
      screen.queryByTestId("expenses-result-card-result"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Despesas e resultado ainda não disponíveis para este marketplace.",
      ),
    ).toBeInTheDocument();
  });
});
