import { render, screen } from "@testing-library/react";
import { AdditionalKpiCards } from "./AdditionalKpiCards";
import type { AnalyticsComparison, AnalyticsSummary } from "@/types/marketplace-analytics";

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
  shippingCost: "0.00",
  couponAmount: "0.00",
  refundedAmount: "0.00",
};

const baseComparison: AnalyticsComparison = {
  grossRevenuePct: 10,
  ordersPct: 5,
  unitsPct: 8,
  averageTicketPct: 2,
  cancelledOrdersPct: null,
  cancellationRateDiffPp: 5.5,
  distinctProductsPct: null,
  unitsPerOrderPct: null,
  grossSalesRevenuePct: 9,
  grossSalesOrdersPct: 4,
  grossSalesUnitsPct: 7,
  grossSalesAverageTicketPct: null,
  grossSalesAvgUnitPricePct: null,
  cancelledUnitsPct: null,
  cancelledRevenuePct: null,
};

describe("AdditionalKpiCards", () => {
  it("never renders the cancellation cards — they live in the collapsible CancellationsPanel now", () => {
    render(
      <AdditionalKpiCards summary={baseSummary} comparison={baseComparison} bestDay={null} />,
    );
    expect(screen.queryByTestId("kpi-card-cancelled-orders")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kpi-card-cancellation-rate")).not.toBeInTheDocument();
  });

  it('shows "Sem base no período anterior" instead of null/NaN/Infinity when the comparison is unavailable', () => {
    render(
      <AdditionalKpiCards summary={baseSummary} comparison={baseComparison} bestDay={null} />,
    );
    const card = screen.getByTestId("kpi-card-distinct-products");
    expect(card).toHaveTextContent("Sem base no período anterior");
    expect(card.textContent).not.toMatch(/NaN|Infinity|null/);
  });

  it("shows the units per order and avg unit price cards with a clear 'not net value' note", () => {
    render(
      <AdditionalKpiCards summary={baseSummary} comparison={baseComparison} bestDay={null} />,
    );
    expect(screen.getByTestId("kpi-card-units-per-order")).toHaveTextContent("2,5");
    expect(screen.getByTestId("kpi-card-avg-unit-price")).toHaveTextContent(/não representa o valor líquido/i);
  });

  it("shows the GROSS-sales average unit price (paid + cancelled with value), not the paid-only one", () => {
    render(
      <AdditionalKpiCards summary={baseSummary} comparison={baseComparison} bestDay={null} />,
    );
    const card = screen.getByTestId("kpi-card-avg-unit-price");
    expect(card).toHaveTextContent(/R\$\s?52,50/);
    expect(card.textContent).not.toMatch(/R\$\s?50,00/);
  });

  it("shows best day details when present", () => {
    render(
      <AdditionalKpiCards
        summary={baseSummary}
        comparison={baseComparison}
        bestDay={{ date: "2026-08-20", grossRevenue: "500.00", paidOrders: 3, units: 6 }}
      />,
    );
    const card = screen.getByTestId("kpi-card-best-day");
    expect(card).toHaveTextContent("20/08/2026");
    expect(card).toHaveTextContent("3 pedidos");
    expect(card).toHaveTextContent("6 unidades");
  });

  it("shows a placeholder (never a fake value) for best day when there were no sales", () => {
    render(
      <AdditionalKpiCards summary={baseSummary} comparison={baseComparison} bestDay={null} />,
    );
    const card = screen.getByTestId("kpi-card-best-day");
    expect(card).toHaveTextContent("—");
    expect(card).toHaveTextContent(/nenhuma venda no período/i);
  });
});
