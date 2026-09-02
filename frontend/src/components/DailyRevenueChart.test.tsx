import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyRevenueChart } from "./DailyRevenueChart";
import type { AnalyticsDailyPoint } from "@/types/marketplace-analytics";

const series: AnalyticsDailyPoint[] = [
  { date: "2026-08-01", grossRevenue: "0.00", paidOrders: 0, units: 0, cancelledOrders: 0 },
  { date: "2026-08-02", grossRevenue: "150.00", paidOrders: 2, units: 4, cancelledOrders: 1 },
];

describe("DailyRevenueChart", () => {
  it("renders an accessible chart image with a descriptive label", () => {
    render(<DailyRevenueChart dailySeries={series} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(/gráfico de faturamento/i);
  });

  it("provides a textual/table alternative with the exact values for accessibility", async () => {
    const user = userEvent.setup();
    render(<DailyRevenueChart dailySeries={series} />);

    await user.click(screen.getByText(/ver tabela de faturamento diário/i));

    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("01/08");
    expect(table).toHaveTextContent("02/08");
    expect(table).toHaveTextContent("R$");
    expect(table).toHaveTextContent("150,00");
  });

  it("shows a placeholder message when there is no daily data", () => {
    render(<DailyRevenueChart dailySeries={[]} />);
    expect(
      screen.getByText(/nenhum dado diário disponível/i),
    ).toBeInTheDocument();
  });
});
