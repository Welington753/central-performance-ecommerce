import { render, screen, within } from "@testing-library/react";
import { KpiSummaryCards } from "./KpiSummaryCards";

const BASE_PROPS = {
  summary: {
    grossRevenue: "1234.56",
    orders: 10,
    units: 25,
    averageTicket: "123.46",
  },
  comparison: {
    grossRevenuePct: 12.3,
    ordersPct: -8,
    unitsPct: 0,
    averageTicketPct: null,
  },
};

describe("KpiSummaryCards", () => {
  it("renders the four required cards with their formatted real values", () => {
    render(<KpiSummaryCards {...BASE_PROPS} />);

    const revenue = screen.getByTestId("kpi-card-gross-revenue");
    expect(within(revenue).getByText("Faturamento bruto")).toBeInTheDocument();
    expect(within(revenue).getByText(/R\$\s?1\.234,56/)).toBeInTheDocument();

    const orders = screen.getByTestId("kpi-card-orders");
    expect(within(orders).getByText("Pedidos pagos")).toBeInTheDocument();
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
          grossRevenue: "0.00",
          orders: 0,
          units: 0,
          averageTicket: "0.00",
        }}
        comparison={{
          grossRevenuePct: null,
          ordersPct: null,
          unitsPct: null,
          averageTicketPct: null,
        }}
      />,
    );

    expect(screen.getAllByText(/R\$\s?0,00/)).toHaveLength(2);
    expect(screen.getAllByText("0")).toHaveLength(2);
  });
});
