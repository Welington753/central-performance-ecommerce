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
};

describe("AdditionalKpiCards", () => {
  it("renders cancelled orders and cancellation rate", () => {
    render(
      <AdditionalKpiCards summary={baseSummary} comparison={baseComparison} bestDay={null} />,
    );
    expect(screen.getByTestId("kpi-card-cancelled-orders")).toHaveTextContent("2");
    expect(screen.getByTestId("kpi-card-cancellation-rate")).toHaveTextContent("20,0%");
  });

  it("shows the cancellation rate comparison in percentage points (p.p.), never as a plain percentage", () => {
    render(
      <AdditionalKpiCards summary={baseSummary} comparison={baseComparison} bestDay={null} />,
    );
    expect(screen.getByTestId("kpi-card-cancellation-rate")).toHaveTextContent("p.p.");
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
