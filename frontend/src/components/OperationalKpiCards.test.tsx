import { render, screen, within } from "@testing-library/react";
import { OperationalKpiCards } from "./OperationalKpiCards";

const BASE_PROPS = {
  summary: {
    grossRevenue: "6632.79",
    orders: 25,
    units: 28,
  },
  comparison: {
    grossRevenuePct: 5.2,
    ordersPct: null,
    unitsPct: -2,
  },
};

describe("OperationalKpiCards", () => {
  it("renders the three paid-orders cards, never labeled as gross sales or net", () => {
    render(<OperationalKpiCards {...BASE_PROPS} />);

    expect(
      screen.getByText(
        "Operacional — valor bruto dos produtos, antes de cupons, reembolsos, comissões, taxas, impostos, frete e Ads.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/líquido/i)).not.toBeInTheDocument();

    const revenue = screen.getByTestId("kpi-card-paid-revenue");
    expect(
      within(revenue).getByText("Faturamento bruto de pedidos pagos"),
    ).toBeInTheDocument();
    expect(within(revenue).getByText(/R\$\s?6\.632,79/)).toBeInTheDocument();

    const orders = screen.getByTestId("kpi-card-paid-orders");
    expect(within(orders).getByText("Pedidos pagos")).toBeInTheDocument();
    expect(within(orders).getByText("25")).toBeInTheDocument();

    const units = screen.getByTestId("kpi-card-paid-units");
    expect(
      within(units).getByText("Unidades de pedidos pagos"),
    ).toBeInTheDocument();
    expect(within(units).getByText("28")).toBeInTheDocument();
  });

  it("shows a neutral placeholder (never a fictitious 0%) when the comparison base is null", () => {
    render(<OperationalKpiCards {...BASE_PROPS} />);
    expect(
      within(screen.getByTestId("kpi-card-paid-orders")).getByText("—"),
    ).toBeInTheDocument();
  });
});
