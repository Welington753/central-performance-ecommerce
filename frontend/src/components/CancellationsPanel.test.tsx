import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CancellationsPanel } from "./CancellationsPanel";

const BASE_PROPS = {
  summary: {
    cancelledOrders: 1,
    cancelledUnits: 1,
    cancelledRevenue: "579.00",
    cancellationRate: 3.8,
  },
  comparison: {
    cancelledOrdersPct: null,
    cancelledUnitsPct: null,
    cancelledRevenuePct: null,
    cancellationRateDiffPp: 1.2,
  },
};

describe("CancellationsPanel", () => {
  it("starts collapsed — the aggregated cards are not visible by default", () => {
    render(<CancellationsPanel {...BASE_PROPS} />);

    expect(screen.getByText("Ver cancelamentos")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-card-cancelled-orders")).not.toBeVisible();
  });

  it("shows the aggregated cancellation figures once expanded, never individual orders", async () => {
    const user = userEvent.setup();
    render(<CancellationsPanel {...BASE_PROPS} />);

    await user.click(screen.getByText("Ver cancelamentos"));

    expect(screen.getByTestId("kpi-card-cancelled-orders")).toBeVisible();
    expect(screen.getByTestId("kpi-card-cancelled-orders")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-card-cancelled-units")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-card-cancelled-revenue")).toHaveTextContent(
      /R\$\s?579,00/,
    );
    expect(screen.getByTestId("kpi-card-cancellation-rate")).toHaveTextContent(
      "3,8%",
    );
    expect(screen.getByTestId("kpi-card-cancellation-rate")).toHaveTextContent(
      "p.p.",
    );
  });

  it("explains the cancellation rule and explicitly disclaims it is not the marketplace's own rule", async () => {
    const user = userEvent.setup();
    render(<CancellationsPanel {...BASE_PROPS} />);
    await user.click(screen.getByText("Ver cancelamentos"));

    const explanation = screen.getByText(/última sincronização/i);
    expect(explanation).toBeInTheDocument();
    expect(explanation.textContent).toMatch(/não corresponder exatamente/i);
  });

  it("never renders a fictitious percentage when there is no comparison base", async () => {
    const user = userEvent.setup();
    render(<CancellationsPanel {...BASE_PROPS} />);
    await user.click(screen.getByText("Ver cancelamentos"));

    expect(screen.getByTestId("kpi-card-cancelled-orders")).toHaveTextContent(
      "Sem base no período anterior",
    );
  });
});
