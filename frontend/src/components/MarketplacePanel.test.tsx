import { render, screen, within } from "@testing-library/react";
import { MarketplacePanel } from "./MarketplacePanel";
import type {
  AccountBreakdownEntry,
  MarketplaceBreakdownEntry,
} from "@/types/marketplace-analytics";

function breakdown(
  overrides: Partial<MarketplaceBreakdownEntry>[] = [],
): MarketplaceBreakdownEntry[] {
  const base: MarketplaceBreakdownEntry[] = [
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

function mlAccount(
  overrides: Partial<AccountBreakdownEntry> = {},
): AccountBreakdownEntry {
  return {
    accountId: "ml-1",
    marketplace: "MERCADO_LIVRE",
    nickname: "Mercado Livre 1",
    externalSellerId: "111",
    status: "CONNECTED",
    availability: "AVAILABLE",
    summary: { grossRevenue: "1234.56", paidOrders: 10, units: 25 },
    lastSync: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("MarketplacePanel", () => {
  it("renders one card per Mercado Livre account, each with its own total — never a single consolidated ML card", () => {
    const accounts = [
      mlAccount({
        accountId: "ml-1",
        nickname: "Mercado Livre 1",
        summary: { grossRevenue: "300.00", paidOrders: 3, units: 3 },
      }),
      mlAccount({
        accountId: "ml-2",
        nickname: "Mercado Livre 2",
        summary: { grossRevenue: "70.00", paidOrders: 1, units: 1 },
      }),
    ];
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={accounts} />,
    );

    expect(
      screen.queryByTestId("marketplace-panel-MERCADO_LIVRE"),
    ).not.toBeInTheDocument();

    const card1 = screen.getByTestId("marketplace-account-panel-ml-1");
    expect(within(card1).getByText("Mercado Livre 1")).toBeInTheDocument();
    expect(within(card1).getByText(/R\$\s?300,00/)).toBeInTheDocument();
    expect(within(card1).getByText(/3 pedidos pagos/)).toBeInTheDocument();
    expect(within(card1).getByText(/1 conta$/)).toBeInTheDocument();

    const card2 = screen.getByTestId("marketplace-account-panel-ml-2");
    expect(within(card2).getByText("Mercado Livre 2")).toBeInTheDocument();
    expect(within(card2).getByText(/R\$\s?70,00/)).toBeInTheDocument();
    expect(within(card2).getByText(/1 pedido pago\b/)).toBeInTheDocument();
  });

  it("shows the connection status per Mercado Livre account card", () => {
    const accounts = [
      mlAccount({ accountId: "ml-1", availability: "AVAILABLE" }),
      mlAccount({
        accountId: "ml-2",
        availability: "HISTORICAL_ONLY",
        summary: { grossRevenue: "10.00", paidOrders: 1, units: 1 },
      }),
    ];
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={accounts} />,
    );

    expect(
      within(screen.getByTestId("marketplace-account-panel-ml-1")).getByText(
        "Conectado",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("marketplace-account-panel-ml-2")).getByText(
        /precisa de atenção/i,
      ),
    ).toBeInTheDocument();
  });

  it("a connected account with no orders in the period shows R$ 0,00 and 0 pedidos pagos — never the empty-state link", () => {
    const accounts = [
      mlAccount({
        accountId: "ml-1",
        summary: { grossRevenue: "0.00", paidOrders: 0, units: 0 },
      }),
    ];
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={accounts} />,
    );

    const card = screen.getByTestId("marketplace-account-panel-ml-1");
    expect(within(card).getByText(/R\$\s?0,00/)).toBeInTheDocument();
    expect(within(card).getByText(/0 pedidos pagos/)).toBeInTheDocument();
    expect(within(card).queryByText(/sem dados disponíveis/i)).not.toBeInTheDocument();
  });

  it("an account never synced (summary null) shows the empty state with a link to /integracoes, never invented zeros", () => {
    const accounts = [
      mlAccount({
        accountId: "ml-1",
        availability: "CONNECTED_NO_DATA",
        summary: null,
      }),
    ];
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={accounts} />,
    );

    const card = screen.getByTestId("marketplace-account-panel-ml-1");
    expect(within(card).getByText(/sem dados disponíveis/i)).toBeInTheDocument();
    const link = within(card).getByRole("link", { name: /integrações/i });
    expect(link).toHaveAttribute("href", "/integracoes");
    expect(card.textContent).not.toMatch(/R\$/);
  });

  it("orders Mercado Livre cards deterministically by nickname, regardless of input order or account id", () => {
    const accounts = [
      mlAccount({ accountId: "zzz-later-id", nickname: "Mercado Livre 2" }),
      mlAccount({ accountId: "aaa-earlier-id", nickname: "Mercado Livre 1" }),
    ];
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={accounts} />,
    );

    const region = screen.getByRole("region", { name: /resumo por marketplace/i });
    const titles = within(region)
      .getAllByText(/^Mercado Livre \d$/)
      .map((el) => el.textContent);
    expect(titles).toEqual(["Mercado Livre 1", "Mercado Livre 2"]);
  });

  it("never hardcodes a specific account id or nickname — renders whatever accounts are passed in", () => {
    const accounts = [
      mlAccount({
        accountId: "some-other-uuid-9f3e",
        nickname: "Loja Nova Qualquer",
        summary: { grossRevenue: "42.00", paidOrders: 2, units: 2 },
      }),
    ];
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={accounts} />,
    );

    expect(
      screen.getByTestId("marketplace-account-panel-some-other-uuid-9f3e"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loja Nova Qualquer")).toBeInTheDocument();
  });

  it("shows Amazon as not connected, with a link to /integracoes and no numbers", () => {
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={[]} />,
    );
    const amazon = screen.getByTestId("marketplace-panel-AMAZON");
    expect(within(amazon).getByText(/não conectado/i)).toBeInTheDocument();
    const link = within(amazon).getByRole("link", { name: /integrações/i });
    expect(link).toHaveAttribute("href", "/integracoes");
    expect(amazon.textContent).not.toMatch(/R\$/);
    expect(amazon.textContent).not.toMatch(/\b0 pedidos?\b/);
  });

  it("shows Shopee as not connected, with a link to /integracoes and no numbers", () => {
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={[]} />,
    );
    const shopee = screen.getByTestId("marketplace-panel-SHOPEE");
    expect(within(shopee).getByText(/não conectado/i)).toBeInTheDocument();
    expect(shopee.textContent).not.toMatch(/R\$/);
  });

  it("shows Amazon's real aggregate and how many accounts are included, unaffected by the Mercado Livre split", () => {
    render(
      <MarketplacePanel
        breakdown={breakdown([
          {
            marketplace: "AMAZON",
            availability: "AVAILABLE",
            accountsIncluded: 1,
            accountsTotal: 1,
            summary: { grossRevenue: "999.99", paidOrders: 4, units: 4 },
          },
        ])}
        mercadoLivreAccounts={[mlAccount()]}
      />,
    );
    const amazon = screen.getByTestId("marketplace-panel-AMAZON");
    expect(within(amazon).getByText(/R\$\s?999,99/)).toBeInTheDocument();
    expect(within(amazon).getByText(/1 conta incluída/)).toBeInTheDocument();
  });

  it("never renders a functional sync button for an unconnected marketplace", () => {
    render(
      <MarketplacePanel breakdown={breakdown()} mercadoLivreAccounts={[]} />,
    );
    const amazon = screen.getByTestId("marketplace-panel-AMAZON");
    expect(within(amazon).queryByRole("button")).not.toBeInTheDocument();
  });
});
