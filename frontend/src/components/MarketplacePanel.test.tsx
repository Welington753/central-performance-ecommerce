import { render, screen, within } from "@testing-library/react";
import { MarketplacePanel } from "./MarketplacePanel";
import type { MarketplaceBreakdownEntry } from "@/types/marketplace-analytics";

function breakdown(overrides: Partial<MarketplaceBreakdownEntry>[] = []): MarketplaceBreakdownEntry[] {
  const base: MarketplaceBreakdownEntry[] = [
    {
      marketplace: "MERCADO_LIVRE",
      availability: "AVAILABLE",
      accountsIncluded: 2,
      accountsTotal: 2,
      summary: { grossRevenue: "1234.56", paidOrders: 10, units: 25 },
      lastSync: "2026-09-01T12:00:00.000Z",
    },
    {
      marketplace: "AMAZON",
      availability: "NOT_CONNECTED",
      accountsIncluded: 0,
      accountsTotal: 0,
      summary: null,
      lastSync: null,
    },
    {
      marketplace: "SHOPEE",
      availability: "NOT_CONNECTED",
      accountsIncluded: 0,
      accountsTotal: 0,
      summary: null,
      lastSync: null,
    },
  ];
  return base.map((entry, i) => ({ ...entry, ...overrides[i] }));
}

describe("MarketplacePanel", () => {
  it("shows Mercado Livre's real aggregate and how many accounts are included", () => {
    render(<MarketplacePanel breakdown={breakdown()} />);
    const ml = screen.getByTestId("marketplace-panel-MERCADO_LIVRE");
    expect(within(ml).getByText(/R\$\s?1\.234,56/)).toBeInTheDocument();
    expect(within(ml).getByText(/2 contas incluídas/)).toBeInTheDocument();
  });

  it("shows Amazon as not connected, with a link to /integracoes and no numbers", () => {
    render(<MarketplacePanel breakdown={breakdown()} />);
    const amazon = screen.getByTestId("marketplace-panel-AMAZON");
    expect(within(amazon).getByText(/não conectado/i)).toBeInTheDocument();
    const link = within(amazon).getByRole("link", { name: /integrações/i });
    expect(link).toHaveAttribute("href", "/integracoes");
    expect(amazon.textContent).not.toMatch(/R\$/);
    expect(amazon.textContent).not.toMatch(/\b0 pedidos?\b/);
  });

  it("shows Shopee as not connected, with a link to /integracoes and no numbers", () => {
    render(<MarketplacePanel breakdown={breakdown()} />);
    const shopee = screen.getByTestId("marketplace-panel-SHOPEE");
    expect(within(shopee).getByText(/não conectado/i)).toBeInTheDocument();
    expect(shopee.textContent).not.toMatch(/R\$/);
  });

  it("never renders a functional sync button for an unconnected marketplace", () => {
    render(<MarketplacePanel breakdown={breakdown()} />);
    const amazon = screen.getByTestId("marketplace-panel-AMAZON");
    expect(within(amazon).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a connection-attention label for HISTORICAL_ONLY marketplaces without hiding numbers", () => {
    render(
      <MarketplacePanel
        breakdown={breakdown([
          {
            availability: "HISTORICAL_ONLY",
            summary: { grossRevenue: "500.00", paidOrders: 3, units: 5 },
          },
        ])}
      />,
    );
    const ml = screen.getByTestId("marketplace-panel-MERCADO_LIVRE");
    expect(within(ml).getByText(/precisa de atenção/i)).toBeInTheDocument();
    expect(within(ml).getByText(/R\$\s?500,00/)).toBeInTheDocument();
  });
});
