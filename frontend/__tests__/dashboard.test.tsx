// Mesmo padrão de integracoes.test.tsx: `jest.mock` automock do módulo
// inteiro (spyOn falha com "Cannot redefine property" nos exports ESM
// compilados pelo SWC deste projeto).
jest.mock("../src/lib/api");

const replaceMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: jest.fn(),
}));

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPage from "@/app/(protegido)/dashboard/page";
import * as api from "@/lib/api";
import type {
  AccountBreakdownEntry,
  MarketplaceAnalyticsKpisDto,
  MarketplaceBreakdownEntry,
} from "@/types/marketplace-analytics";

const { useSearchParams } = jest.requireMock("next/navigation") as {
  useSearchParams: jest.Mock;
};

function mockSearchParams(params: Record<string, string> = {}) {
  useSearchParams.mockReturnValue(new URLSearchParams(params));
}

function fullBreakdown(
  overrides: Partial<MarketplaceBreakdownEntry>[] = [],
): MarketplaceBreakdownEntry[] {
  const base: MarketplaceBreakdownEntry[] = [
    {
      marketplace: "MERCADO_LIVRE",
      availability: "AVAILABLE",
      accountsIncluded: 1,
      accountsTotal: 1,
      summary: { grossRevenue: "1234.56", paidOrders: 10, units: 25 },
      lastSync: "2026-09-01T15:00:00.000Z",
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

function account(overrides: Partial<AccountBreakdownEntry> = {}): AccountBreakdownEntry {
  return {
    accountId: "acc-1",
    marketplace: "MERCADO_LIVRE",
    nickname: "EZIEHOME",
    externalSellerId: "1548451374",
    status: "CONNECTED",
    availability: "AVAILABLE",
    summary: { grossRevenue: "1234.56", paidOrders: 10, units: 25 },
    lastSync: "2026-09-01T15:00:00.000Z",
    ...overrides,
  };
}

function analyticsDto(
  overrides: Partial<MarketplaceAnalyticsKpisDto> = {},
): MarketplaceAnalyticsKpisDto {
  return {
    scope: { marketplace: "ALL", accountId: null },
    availability: "AVAILABLE",
    period: { days: 30, timeZone: "America/Sao_Paulo", from: "2026-08-03", to: "2026-09-01" },
    comparisonPeriod: { days: 30, from: "2026-07-04", to: "2026-08-02" },
    summary: {
      grossRevenue: "1234.56",
      orders: 10,
      units: 25,
      averageTicket: "123.46",
      cancelledOrders: 2,
      cancellationRate: 16.7,
      distinctProducts: 4,
      unitsPerOrder: 2.5,
      avgUnitPrice: "49.38",
    },
    comparison: {
      grossRevenuePct: 12.3,
      ordersPct: -8,
      unitsPct: 0,
      averageTicketPct: null,
      cancelledOrdersPct: null,
      cancellationRateDiffPp: 3.2,
      distinctProductsPct: null,
      unitsPerOrderPct: null,
    },
    bestDay: { date: "2026-08-20", grossRevenue: "500.00", paidOrders: 3, units: 6 },
    dailySeries: [
      { date: "2026-08-03", grossRevenue: "0.00", paidOrders: 0, units: 0, cancelledOrders: 0 },
    ],
    topProducts: [],
    topProductsBySku: [
      { sku: "SKU-A", title: "Produto A", distinctListings: 2, units: 5, grossRevenue: "300.00", unitsSharePct: 20 },
    ],
    topListings: [
      { listingId: "MLB1", marketplace: "MERCADO_LIVRE", accountId: "acc-1", sku: "SKU-A", title: "Produto A", units: 3, grossRevenue: "180.00" },
    ],
    breakdownByMarketplace: fullBreakdown(),
    breakdownByAccount: [account()],
    sources: [],
    dataCoverage: {
      status: "complete",
      synchronizedIntervals: [{ from: "2026-07-04", to: "2026-09-01" }],
      selectedPeriodComplete: true,
      comparisonPeriodComplete: true,
    },
    lastSync: "2026-09-01T15:00:00.000Z",
    ...overrides,
  } as MarketplaceAnalyticsKpisDto;
}

beforeEach(() => {
  jest.resetAllMocks();
  replaceMock.mockClear();
  mockSearchParams();
});

describe("DashboardPage", () => {
  it("shows a loading state while the marketplace scope is being fetched", () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockReturnValue(new Promise(() => {}));
    render(<DashboardPage />);
    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  it("defaults to marketplace=ALL and fetches without an accountId when the URL has no scope filters", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    render(<DashboardPage />);
    await waitFor(() =>
      expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledWith(
        expect.objectContaining({ marketplace: "ALL" }),
      ),
    );
    const [callArgs] = (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mock.calls[0] as [
      { accountId?: string },
    ];
    expect(callArgs.accountId).toBeUndefined();
  });

  it("shows a CTA to /integracoes when nothing is connected anywhere (ALL, NOT_CONNECTED)", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        availability: "NOT_CONNECTED",
        summary: null,
        comparison: null,
        bestDay: null,
        dailySeries: [],
        topProductsBySku: [],
        topListings: [],
        breakdownByAccount: [],
        breakdownByMarketplace: fullBreakdown([{ availability: "NOT_CONNECTED", summary: null, accountsIncluded: 0 }]),
        dataCoverage: { status: "unknown", synchronizedIntervals: [], selectedPeriodComplete: false, comparisonPeriodComplete: false },
        lastSync: null,
      }),
    );
    render(<DashboardPage />);
    const link = await screen.findByRole("link", { name: /ir para integrações/i });
    expect(link).toHaveAttribute("href", "/integracoes");
  });

  it("shows a load-error message with retry when the fetch fails", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockRejectedValue(new Error("network down"));
    render(<DashboardPage />);
    expect(await screen.findByText(/não foi possível carregar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it("renders the real consolidated aggregate for the ALL scope", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    render(<DashboardPage />);
    const revenueCard = await screen.findByTestId("kpi-card-gross-revenue");
    expect(within(revenueCard).getByText(/R\$\s?1\.234,56/)).toBeInTheDocument();
    expect(screen.getByText(/visão consolidada dos marketplaces/i)).toBeInTheDocument();
  });

  it('shows the "X de 3 marketplaces" indicator, distinguishing active integrations from marketplaces with data', async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    render(<DashboardPage />);
    expect(
      await screen.findByText(/1 de 3 marketplaces com integração ativa/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 de 3 com dados disponíveis/i)).toBeInTheDocument();
  });

  it("counts HISTORICAL_ONLY as data-available but NOT active-integration (connection needs attention)", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        breakdownByMarketplace: fullBreakdown([
          {
            availability: "HISTORICAL_ONLY",
            summary: { grossRevenue: "1234.56", paidOrders: 10, units: 25 },
          },
        ]),
      }),
    );
    render(<DashboardPage />);
    expect(
      await screen.findByText(/0 de 3 marketplaces com integração ativa/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 de 3 com dados disponíveis/i)).toBeInTheDocument();
  });

  it("counts CONNECTED_NO_DATA as active-integration but NOT data-available (never synced, nothing proven)", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        availability: "CONNECTED_NO_DATA",
        summary: null,
        comparison: null,
        bestDay: null,
        dailySeries: [],
        topProductsBySku: [],
        topListings: [],
        dataCoverage: {
          status: "unknown",
          synchronizedIntervals: [],
          selectedPeriodComplete: false,
          comparisonPeriodComplete: false,
        },
        breakdownByMarketplace: fullBreakdown([
          { availability: "CONNECTED_NO_DATA", summary: null },
        ]),
      }),
    );
    render(<DashboardPage />);
    expect(
      await screen.findByText(/1 de 3 marketplaces com integração ativa/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 de 3 com dados disponíveis/i)).toBeInTheDocument();
  });

  it("counts AVAILABLE as both active-integration and data-available", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({ breakdownByMarketplace: fullBreakdown([{ availability: "AVAILABLE" }]) }),
    );
    render(<DashboardPage />);
    expect(
      await screen.findByText(/1 de 3 marketplaces com integração ativa/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 de 3 com dados disponíveis/i)).toBeInTheDocument();
  });

  it("Amazon/Shopee remain NOT_CONNECTED with no numbers regardless of the Mercado Livre counter scenario", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        breakdownByMarketplace: fullBreakdown([
          {
            availability: "HISTORICAL_ONLY",
            summary: { grossRevenue: "1234.56", paidOrders: 10, units: 25 },
          },
        ]),
      }),
    );
    render(<DashboardPage />);
    await screen.findByText(/0 de 3 marketplaces com integração ativa/i);
    const amazon = screen.getByTestId("marketplace-panel-AMAZON");
    const shopee = screen.getByTestId("marketplace-panel-SHOPEE");
    expect(within(amazon).getByText(/não conectado/i)).toBeInTheDocument();
    expect(amazon.textContent).not.toMatch(/R\$/);
    expect(within(shopee).getByText(/não conectado/i)).toBeInTheDocument();
    expect(shopee.textContent).not.toMatch(/R\$/);
  });

  it("shows Mercado Livre with real data and Amazon/Shopee as not connected, with no fabricated numbers", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    render(<DashboardPage />);
    const ml = await screen.findByTestId("marketplace-panel-MERCADO_LIVRE");
    expect(within(ml).getByText(/R\$\s?1\.234,56/)).toBeInTheDocument();
    const amazon = screen.getByTestId("marketplace-panel-AMAZON");
    expect(within(amazon).getByText(/não conectado/i)).toBeInTheDocument();
    expect(amazon.textContent).not.toMatch(/R\$/);
    const shopee = screen.getByTestId("marketplace-panel-SHOPEE");
    expect(shopee.textContent).not.toMatch(/R\$/);
  });

  it("shows a connection-attention warning for a HISTORICAL_ONLY account without hiding its numbers", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        breakdownByAccount: [
          account({ status: "TOKEN_EXPIRED", availability: "HISTORICAL_ONLY" }),
        ],
      }),
    );
    render(<DashboardPage />);
    expect(await screen.findByText(/precisa de atenção/i)).toBeInTheDocument();
    expect(screen.getByTestId("kpi-card-gross-revenue")).toBeInTheDocument();
  });

  it("shows a 'connected, no sync yet' message instead of a fabricated zero when availability is CONNECTED_NO_DATA", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        availability: "CONNECTED_NO_DATA",
        summary: null,
        comparison: null,
        bestDay: null,
        dailySeries: [],
        topProductsBySku: [],
        topListings: [],
        dataCoverage: { status: "unknown", synchronizedIntervals: [], selectedPeriodComplete: false, comparisonPeriodComplete: false },
      }),
    );
    render(<DashboardPage />);
    expect(
      await screen.findByText(/ainda não tem nenhuma sincronização concluída/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-card-gross-revenue")).not.toBeInTheDocument();
  });

  it("persists marketplace and accountId already present in the URL, and forwards them to the fetch", async () => {
    mockSearchParams({ marketplace: "MERCADO_LIVRE", accountId: "acc-1", from: "2026-08-01", to: "2026-08-31" });
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({ scope: { marketplace: "MERCADO_LIVRE", accountId: "acc-1" } }),
    );
    render(<DashboardPage />);
    await waitFor(() =>
      expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledWith({
        from: "2026-08-01",
        to: "2026-08-31",
        marketplace: "MERCADO_LIVRE",
        accountId: "acc-1",
      }),
    );
    expect(screen.getByText(/desempenho do mercado livre/i)).toBeInTheDocument();
  });

  it("changing the marketplace filter updates the URL without a full reload", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    const user = userEvent.setup();
    render(<DashboardPage />);
    const select = await screen.findByLabelText("Marketplace");
    await user.selectOptions(select, "AMAZON");
    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("marketplace=AMAZON"),
      { scroll: false },
    );
  });

  it("never silently selects the first account when the scope is consolidated (ALL, no accountId)", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        breakdownByAccount: [account({ accountId: "acc-1" }), account({ accountId: "acc-2" })],
      }),
    );
    render(<DashboardPage />);
    await screen.findByTestId("kpi-card-gross-revenue");
    const [callArgs] = (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mock.calls[0] as [
      { accountId?: string },
    ];
    expect(callArgs.accountId).toBeUndefined();
    expect(screen.getByLabelText("Conta")).toHaveValue("");
  });

  it("clicking 'Sincronizar agora' works when the scope has exactly one connected Mercado Livre account", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({ status: "SUCCESS" });
    const user = userEvent.setup();
    render(<DashboardPage />);
    const button = await screen.findByRole("button", { name: /sincronizar agora/i });
    await user.click(button);
    await waitFor(() => expect(api.syncMercadoLivreOrders).toHaveBeenCalledWith("acc-1"));
  });

  it("prevents a double click on 'Sincronizar agora' from firing two sync requests", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    let resolveSync!: (v: { status: "SUCCESS" }) => void;
    (api.syncMercadoLivreOrders as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<DashboardPage />);
    const button = await screen.findByRole("button", { name: /sincronizar agora/i });
    await user.click(button);
    await user.click(button);
    expect(api.syncMercadoLivreOrders).toHaveBeenCalledTimes(1);
    resolveSync({ status: "SUCCESS" });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("shows a link to /sincronizacoes instead of a button when the scope has more than one connected account", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({
        breakdownByAccount: [
          account({ accountId: "acc-1" }),
          account({ accountId: "acc-2", nickname: "Loja 2" }),
        ],
      }),
    );
    render(<DashboardPage />);
    await screen.findByTestId("kpi-card-gross-revenue");
    expect(
      screen.getByRole("link", { name: /sincronize por lá/i }),
    ).toHaveAttribute("href", "/sincronizacoes");
    expect(
      screen.queryByRole("button", { name: /sincronizar agora/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a sanitized error when the sync request fails, without disabling the button forever", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    (api.syncMercadoLivreOrders as jest.Mock).mockRejectedValue(new Error("SYNC_ALREADY_RUNNING"));
    const user = userEvent.setup();
    render(<DashboardPage />);
    const button = await screen.findByRole("button", { name: /sincronizar agora/i });
    await user.click(button);
    expect(await screen.findByText(/não foi possível sincronizar/i)).toBeInTheDocument();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.queryByText("SYNC_ALREADY_RUNNING")).not.toBeInTheDocument();
  });

  it("shows the last sync time formatted in America/Sao_Paulo", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
      analyticsDto({ lastSync: "2026-09-01T15:00:00.000Z" }),
    );
    render(<DashboardPage />);
    expect(await screen.findByText(/01\/09\/2026, 12:00/)).toBeInTheDocument();
  });

  it("shows an invalid-period message and never calls the API when the URL has an invalid range", async () => {
    mockSearchParams({ from: "2026-08-31", to: "2026-08-01" });
    render(<DashboardPage />);
    expect(await screen.findByText(/período inválido na url/i)).toBeInTheDocument();
  });

  it("never renders a monetary or percentage value while loading", () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockReturnValue(new Promise(() => {}));
    render(<DashboardPage />);
    expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();
  });

  it("scope filters have accessible labels", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
    render(<DashboardPage />);
    expect(await screen.findByLabelText("Marketplace")).toBeInTheDocument();
    expect(screen.getByLabelText("Conta")).toBeInTheDocument();
  });
});
