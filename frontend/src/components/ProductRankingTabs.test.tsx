import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductRankingTabs } from "./ProductRankingTabs";
import type { AnalyticsTopListing, AnalyticsTopProductBySku } from "@/types/marketplace-analytics";

const bySku: AnalyticsTopProductBySku[] = [
  {
    sku: "OPA300005PMA1",
    title: "Produto consolidado",
    distinctListings: 2,
    units: 10,
    grossRevenue: "500.00",
    unitsSharePct: 40,
  },
  {
    sku: null,
    title: "Produto sem SKU",
    distinctListings: 1,
    units: 3,
    grossRevenue: "90.00",
    unitsSharePct: 12,
  },
];

const byListing: AnalyticsTopListing[] = [
  {
    listingId: "MLB1:V1",
    marketplace: "MERCADO_LIVRE",
    accountId: "acc-1",
    sku: "OPA300005PMA1",
    title: "Anúncio 1",
    units: 6,
    grossRevenue: "300.00",
  },
  {
    listingId: "MLB2",
    marketplace: "MERCADO_LIVRE",
    accountId: "acc-1",
    sku: "OPA300005PMA1",
    title: "Anúncio 2",
    units: 4,
    grossRevenue: "200.00",
  },
];

describe("ProductRankingTabs", () => {
  it("shows the 'Por SKU' tab by default, with the same SKU appearing only once", () => {
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);
    const skuCells = screen.getAllByText("OPA300005PMA1");
    expect(skuCells).toHaveLength(1);
    expect(screen.getByText("Produto consolidado")).toBeInTheDocument();
  });

  it("shows 'Sem SKU' for products without a SKU, never merging different no-SKU products", () => {
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);
    expect(screen.getByText("Sem SKU")).toBeInTheDocument();
    expect(screen.getByText("Produto sem SKU")).toBeInTheDocument();
  });

  it("switches to the 'Por anúncio' tab, showing each listing separately even for the same SKU", async () => {
    const user = userEvent.setup();
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);

    await user.click(screen.getByRole("tab", { name: "Por anúncio" }));

    expect(screen.getByText("MLB1:V1")).toBeInTheDocument();
    expect(screen.getByText("MLB2")).toBeInTheDocument();
    expect(screen.getAllByText("OPA300005PMA1")).toHaveLength(2);
  });

  it("filters by local search across SKU and title", async () => {
    const user = userEvent.setup();
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);

    await user.type(
      screen.getByPlaceholderText(/buscar por sku ou nome/i),
      "sem sku",
    );

    expect(screen.getByText("Produto sem SKU")).toBeInTheDocument();
    expect(screen.queryByText("Produto consolidado")).not.toBeInTheDocument();
  });

  it("limits the visible rows to the selected Top N", async () => {
    const manyRows: AnalyticsTopProductBySku[] = Array.from(
      { length: 15 },
      (_, i) => ({
        sku: `SKU-${i}`,
        title: `Produto ${i}`,
        distinctListings: 1,
        units: 1,
        grossRevenue: "10.00",
        unitsSharePct: 1,
      }),
    );
    const user = userEvent.setup();
    render(<ProductRankingTabs bySku={manyRows} byListing={[]} />);

    const rowsTop10 = screen.getAllByRole("row");
    // header + 10 linhas
    expect(rowsTop10).toHaveLength(11);

    await user.selectOptions(
      screen.getByLabelText(/quantidade de itens/i),
      "20",
    );
    expect(screen.getAllByRole("row")).toHaveLength(16);
  });

  it("shows the empty state when there is nothing to show for the current tab/search", () => {
    render(<ProductRankingTabs bySku={[]} byListing={[]} />);
    expect(
      screen.getByText(/nenhum produto vendido no período/i),
    ).toBeInTheDocument();
  });

  it("never exposes buyer data or order ids in the listing table", () => {
    render(<ProductRankingTabs bySku={bySku} byListing={byListing} />);
    const table = screen.getAllByRole("table")[0];
    expect(within(table).queryByText(/comprador|buyer|orderId/i)).not.toBeInTheDocument();
  });
});
