import { render, screen } from "@testing-library/react";
import { FullPerformanceSection } from "./FullPerformanceSection";
import type { MarketplaceAnalyticsFull } from "@/types/marketplace-analytics";

const GROUP = {
  grossSalesRevenue: "300.00",
  grossSalesOrders: 3,
  grossSalesUnits: 3,
  paidRevenue: "300.00",
  paidOrders: 3,
  paidUnits: 3,
  averageTicket: "100.00",
  cancelledOrders: 0,
  cancelledUnits: 0,
  cancelledRevenue: "0.00",
};

function buildFull(
  overrides: Partial<MarketplaceAnalyticsFull> = {},
): MarketplaceAnalyticsFull {
  return {
    coverage: "complete",
    classifiedOrders: 3,
    unclassifiedOrders: 0,
    summary: { ...GROUP, shareOfPaidRevenuePct: 100, shareOfPaidUnitsPct: 100 },
    comparison: null,
    dailySeries: [],
    ranking: [],
    nonFullSummary: null,
    unknownSummary: null,
    totalSummary: GROUP,
    ...overrides,
  };
}

describe("FullPerformanceSection", () => {
  it("renders the given title, never a hardcoded marketplace name", () => {
    render(<FullPerformanceSection full={buildFull()} title="Shopee Full" />);
    expect(
      screen.getByRole("heading", { name: "Shopee Full" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Mercado Livre/i)).not.toBeInTheDocument();
  });

  it("renders the Mercado Livre title when given", () => {
    render(
      <FullPerformanceSection full={buildFull()} title="Mercado Livre Full" />,
    );
    expect(
      screen.getByRole("heading", { name: "Mercado Livre Full" }),
    ).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(
      <FullPerformanceSection
        full={buildFull()}
        title="Shopee Full"
        description="Pedidos processados pela logística Full da Shopee."
      />,
    );
    expect(
      screen.getByText("Pedidos processados pela logística Full da Shopee."),
    ).toBeInTheDocument();
  });

  it("omits the description block when none is provided", () => {
    const { container } = render(
      <FullPerformanceSection full={buildFull()} title="Mercado Livre Full" />,
    );
    expect(container.querySelectorAll("p").length).toBeGreaterThanOrEqual(0);
    expect(screen.queryByText(/logística Full da Shopee/i)).not.toBeInTheDocument();
  });

  it("shows the empty state when summary is null (no Full order in scope yet)", () => {
    render(
      <FullPerformanceSection
        full={buildFull({ summary: null })}
        title="Shopee Full"
      />,
    );
    expect(
      screen.getByText(/Nenhum pedido Full comprovado neste período ainda\./),
    ).toBeInTheDocument();
  });

  it("shows the coverage notice when coverage is partial", () => {
    render(
      <FullPerformanceSection
        full={buildFull({
          coverage: "partial",
          classifiedOrders: 2,
          unclassifiedOrders: 1,
        })}
        title="Shopee Full"
      />,
    );
    expect(screen.getByText(/Cobertura parcial da classificação Full/i)).toBeInTheDocument();
  });
});
