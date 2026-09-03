import { render, screen, within } from "@testing-library/react";
import { KpiSummaryCards } from "./KpiSummaryCards";

const BASE_PROPS = {
  summary: {
    grossSalesRevenue: "1234.56",
    grossSalesOrders: 10,
    grossSalesUnits: 25,
    grossSalesAverageTicket: "123.46",
  },
  comparison: {
    grossSalesRevenuePct: 12.3,
    grossSalesOrdersPct: -8,
    grossSalesUnitsPct: 0,
    grossSalesAverageTicketPct: null,
  },
};

describe("KpiSummaryCards", () => {
  it("renders the four required cards with their formatted real values", () => {
    render(<KpiSummaryCards {...BASE_PROPS} />);

    const revenue = screen.getByTestId("kpi-card-gross-revenue");
    expect(within(revenue).getByText("Vendas brutas")).toBeInTheDocument();
    expect(within(revenue).getByText(/R\$\s?1\.234,56/)).toBeInTheDocument();

    const orders = screen.getByTestId("kpi-card-orders");
    expect(within(orders).getByText("Vendas")).toBeInTheDocument();
    expect(within(orders).getByText("10")).toBeInTheDocument();

    const units = screen.getByTestId("kpi-card-units");
    expect(within(units).getByText("Unidades vendidas")).toBeInTheDocument();
    expect(within(units).getByText("25")).toBeInTheDocument();

    const ticket = screen.getByTestId("kpi-card-average-ticket");
    expect(within(ticket).getByText("Ticket médio")).toBeInTheDocument();
    expect(within(ticket).getByText(/R\$\s?123,46/)).toBeInTheDocument();
  });

  it("shows the comparison percentage against the previous period on each card", () => {
    render(<KpiSummaryCards {...BASE_PROPS} />);

    expect(
      within(screen.getByTestId("kpi-card-gross-revenue")).getByText(
        "+12,3%",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kpi-card-orders")).getByText("-8,0%"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kpi-card-units")).getByText("0,0%"),
    ).toBeInTheDocument();
  });

  it("shows a neutral placeholder (never a fictitious 0%) when the comparison base is null", () => {
    render(<KpiSummaryCards {...BASE_PROPS} />);

    expect(
      within(screen.getByTestId("kpi-card-average-ticket")).getByText("—"),
    ).toBeInTheDocument();
  });

  it("never renders a hardcoded/example number that was not passed in via props", () => {
    render(
      <KpiSummaryCards
        summary={{
          grossSalesRevenue: "0.00",
          grossSalesOrders: 0,
          grossSalesUnits: 0,
          grossSalesAverageTicket: "0.00",
        }}
        comparison={{
          grossSalesRevenuePct: null,
          grossSalesOrdersPct: null,
          grossSalesUnitsPct: null,
          grossSalesAverageTicketPct: null,
        }}
      />,
    );

    expect(screen.getAllByText(/R\$\s?0,00/)).toHaveLength(2);
    expect(screen.getAllByText("0")).toHaveLength(2);
  });
});
