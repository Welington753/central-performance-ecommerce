import { render, screen, within } from "@testing-library/react";
import { TopProductsRanking } from "./TopProductsRanking";

describe("TopProductsRanking", () => {
  it("renders an empty state when there are no top products", () => {
    render(<TopProductsRanking products={[]} />);

    expect(
      screen.getByText("Nenhum produto vendido no período."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("row")).not.toBeInTheDocument();
  });

  it("renders position, SKU, product, units and gross value for each product, in order", () => {
    render(
      <TopProductsRanking
        products={[
          { sku: "SKU-A", title: "Produto A", units: 5, grossRevenue: "300.00" },
          { sku: "SKU-B", title: "Produto B", units: 7, grossRevenue: "20.00" },
        ]}
      />,
    );

    const rows = screen.getAllByRole("row").slice(1); // exclui o cabeçalho
    expect(rows).toHaveLength(2);

    expect(within(rows[0]).getByText("1")).toBeInTheDocument();
    expect(within(rows[0]).getByText("SKU-A")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Produto A")).toBeInTheDocument();
    expect(within(rows[0]).getByText("5")).toBeInTheDocument();
    expect(within(rows[0]).getByText(/R\$\s?300,00/)).toBeInTheDocument();

    expect(within(rows[1]).getByText("2")).toBeInTheDocument();
    expect(within(rows[1]).getByText("SKU-B")).toBeInTheDocument();
  });

  it("shows a dash placeholder when a product has no seller SKU", () => {
    render(
      <TopProductsRanking
        products={[
          { sku: null, title: "Produto sem SKU", units: 1, grossRevenue: "9.90" },
        ]}
      />,
    );

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("—")).toBeInTheDocument();
  });
});
