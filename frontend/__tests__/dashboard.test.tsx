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
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { MercadoLivreKpisDto } from "@/types/mercado-livre-kpis";

const { useSearchParams } = jest.requireMock("next/navigation") as {
  useSearchParams: jest.Mock;
};

function mockSearchParams(params: Record<string, string> = {}) {
  useSearchParams.mockReturnValue(new URLSearchParams(params));
}

function mlAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "acc-1",
    marketplace: "MERCADO_LIVRE",
    externalSellerId: "1548451374",
    nickname: "EZIEHOME",
    status: "CONNECTED",
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function kpis(overrides: Partial<MercadoLivreKpisDto> = {}): MercadoLivreKpisDto {
  return {
    account: { id: "acc-1", externalSellerId: "1548451374", nickname: "EZIEHOME" },
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
    bestDay: {
      date: "2026-08-20",
      grossRevenue: "500.00",
      paidOrders: 3,
      units: 6,
    },
    dailySeries: [
      { date: "2026-08-03", grossRevenue: "0.00", paidOrders: 0, units: 0, cancelledOrders: 0 },
      { date: "2026-08-04", grossRevenue: "100.00", paidOrders: 1, units: 2, cancelledOrders: 0 },
    ],
    topProducts: [
      { sku: "SKU-A", title: "Produto A", units: 5, grossRevenue: "300.00" },
    ],
    topProductsBySku: [
      {
        sku: "SKU-A",
        title: "Produto A",
        distinctListings: 2,
        units: 5,
        grossRevenue: "300.00",
        unitsSharePct: 20,
      },
    ],
    topListings: [
      {
        listingId: "MLB1",
        sku: "SKU-A",
        title: "Produto A",
        units: 3,
        grossRevenue: "180.00",
      },
    ],
    dataCoverage: {
      status: "complete",
      synchronizedFrom: "2026-07-04",
      synchronizedTo: "2026-09-01",
      selectedPeriodComplete: true,
      comparisonPeriodComplete: true,
    },
    lastSync: "2026-09-01T15:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  replaceMock.mockClear();
  mockSearchParams();
});

describe("DashboardPage", () => {
  it("shows a loading state while accounts are being fetched", () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockReturnValue(
      new Promise(() => {}), // nunca resolve neste teste
    );

    render(<DashboardPage />);

    expect(screen.getByText(/carregando/i)).toBeInTheDocument();
  });

  it("shows a CTA to /integracoes when there is no CONNECTED Mercado Livre account", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ status: "DISCONNECTED" }),
    ]);

    render(<DashboardPage />);

    const link = await screen.findByRole("link", {
      name: /conectar mercado livre|ir para integrações/i,
    });
    expect(link).toHaveAttribute("href", "/integracoes");
  });

  it("shows a load-error message with retry when fetching accounts fails", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockRejectedValue(
      new Error("network down"),
    );

    render(<DashboardPage />);

    expect(
      await screen.findByText(/não foi possível carregar/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /tentar novamente/i }),
    ).toBeInTheDocument();
  });

  it("automatically selects the CONNECTED account and fetches its KPIs with a default 30-day period", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "CONNECTED" }),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    render(<DashboardPage />);

    await waitFor(() =>
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledWith(
        "acc-1",
        expect.objectContaining({
          from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ),
    );
  });

  it("uses from/to already present in the URL instead of the default period", async () => {
    mockSearchParams({ from: "2026-08-01", to: "2026-08-31" });
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([mlAccount()]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    render(<DashboardPage />);

    await waitFor(() =>
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledWith("acc-1", {
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    );
  });

  it("shows an invalid-period message and never calls the KPI API when the URL has an invalid range", async () => {
    mockSearchParams({ from: "2026-08-31", to: "2026-08-01" });
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([mlAccount()]);

    render(<DashboardPage />);

    expect(
      await screen.findByText(/período inválido na url/i),
    ).toBeInTheDocument();
    expect(api.fetchMercadoLivreKpis).not.toHaveBeenCalled();
  });

  it('offers a way back to the default 30-day period from an invalid URL', async () => {
    mockSearchParams({ from: "2026-08-31", to: "2026-08-01" });
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([mlAccount()]);

    const user = userEvent.setup();
    render(<DashboardPage />);

    const resetButton = await screen.findByRole("button", {
      name: /voltar aos últimos 30 dias/i,
    });
    await user.click(resetButton);
    expect(replaceMock).toHaveBeenCalled();
  });

  it("renders the four main KPI cards with real values from the API response", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount(),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    render(<DashboardPage />);

    const revenueCard = await screen.findByTestId("kpi-card-gross-revenue");
    expect(within(revenueCard).getByText(/R\$\s?1\.234,56/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kpi-card-orders")).getByText("10"),
    ).toBeInTheDocument();
  });

  it("renders the additional KPI cards (cancelled orders, cancellation rate, distinct products, units per order, avg unit price, best day)", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([mlAccount()]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    render(<DashboardPage />);

    expect(await screen.findByTestId("kpi-card-cancelled-orders")).toHaveTextContent("2");
    expect(screen.getByTestId("kpi-card-cancellation-rate")).toHaveTextContent("16,7%");
    expect(screen.getByTestId("kpi-card-distinct-products")).toHaveTextContent("4");
    expect(screen.getByTestId("kpi-card-units-per-order")).toHaveTextContent("2,5");
    expect(screen.getByTestId("kpi-card-best-day")).toHaveTextContent("20/08/2026");
  });

  it("shows the data coverage banner", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([mlAccount()]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(
      kpis({
        dataCoverage: {
          status: "partial",
          synchronizedFrom: "2026-08-20",
          synchronizedTo: "2026-09-01",
          selectedPeriodComplete: false,
          comparisonPeriodComplete: false,
        },
      }),
    );

    render(<DashboardPage />);

    expect(await screen.findByText(/cobertura parcial/i)).toBeInTheDocument();
  });

  it("renders the SKU ranking (consolidated) by default", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([mlAccount()]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    render(<DashboardPage />);

    expect(await screen.findByText("Produto A")).toBeInTheDocument();
    expect(screen.getByText("SKU-A")).toBeInTheDocument();
  });

  it("shows the empty ranking state when there are no ranked products", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount(),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(
      kpis({ topProductsBySku: [], topListings: [] }),
    );

    render(<DashboardPage />);

    expect(
      await screen.findByText(/nenhum produto vendido no período/i),
    ).toBeInTheDocument();
  });

  it("shows the last sync time formatted in America/Sao_Paulo", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount(),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(
      kpis({ lastSync: "2026-09-01T15:00:00.000Z" }),
    );

    render(<DashboardPage />);

    expect(await screen.findByText(/01\/09\/2026, 12:00/)).toBeInTheDocument();
  });

  it("shows a 'never synced' message when lastSync is null", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount(),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(
      kpis({ lastSync: null }),
    );

    render(<DashboardPage />);

    expect(
      await screen.findByText(/nunca sincronizado/i),
    ).toBeInTheDocument();
  });

  it("shows a sanitized error with retry when fetching KPIs fails", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount(),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockRejectedValue(
      new Error("boom"),
    );

    render(<DashboardPage />);

    expect(
      await screen.findByText(/não foi possível carregar os kpis/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /tentar novamente/i }),
    ).toBeInTheDocument();
  });

  it("clicking 'Sincronizar agora' calls syncMercadoLivreOrders for the selected account and refreshes KPIs", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1" }),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock)
      .mockResolvedValueOnce(
        kpis({
          summary: {
            grossRevenue: "0.00",
            orders: 0,
            units: 0,
            averageTicket: "0.00",
            cancelledOrders: 0,
            cancellationRate: 0,
            distinctProducts: 0,
            unitsPerOrder: 0,
            avgUnitPrice: "0.00",
          },
        }),
      )
      .mockResolvedValueOnce(kpis());
    (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({
      status: "SUCCESS",
    });

    const user = userEvent.setup();
    render(<DashboardPage />);

    const button = await screen.findByRole("button", {
      name: /sincronizar agora/i,
    });
    await user.click(button);

    await waitFor(() =>
      expect(api.syncMercadoLivreOrders).toHaveBeenCalledWith("acc-1"),
    );
    await waitFor(() =>
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledTimes(2),
    );
  });

  it("prevents a double click on 'Sincronizar agora' from firing two sync requests", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1" }),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());
    let resolveSync!: (v: { status: "SUCCESS" }) => void;
    (api.syncMercadoLivreOrders as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveSync = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<DashboardPage />);

    const button = await screen.findByRole("button", {
      name: /sincronizar agora/i,
    });
    await user.click(button);
    await user.click(button);

    expect(api.syncMercadoLivreOrders).toHaveBeenCalledTimes(1);

    resolveSync({ status: "SUCCESS" });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("shows a sanitized error when the sync request fails, without disabling the button forever", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1" }),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());
    (api.syncMercadoLivreOrders as jest.Mock).mockRejectedValue(
      new Error("SYNC_ALREADY_RUNNING"),
    );

    const user = userEvent.setup();
    render(<DashboardPage />);

    const button = await screen.findByRole("button", {
      name: /sincronizar agora/i,
    });
    await user.click(button);

    expect(
      await screen.findByText(/não foi possível sincronizar/i),
    ).toBeInTheDocument();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.queryByText("SYNC_ALREADY_RUNNING")).not.toBeInTheDocument();
  });

  it("shows an account selector when more than one CONNECTED account exists, and switching refetches KPIs", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", nickname: "Loja Principal" }),
      mlAccount({ id: "acc-2", nickname: "Loja Secundária" }),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    const user = userEvent.setup();
    render(<DashboardPage />);

    const select = await screen.findByRole("combobox", {
      name: /conta do mercado livre/i,
    });
    await waitFor(() =>
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledWith(
        "acc-1",
        expect.anything(),
      ),
    );

    await user.selectOptions(select, "acc-2");

    await waitFor(() =>
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledWith(
        "acc-2",
        expect.anything(),
      ),
    );
  });

  it("never renders a monetary or percentage value while accounts are still loading", () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockReturnValue(
      new Promise(() => {}),
    );

    render(<DashboardPage />);

    expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();
  });

  it("updates the URL (without a full reload) when a period shortcut is applied", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([mlAccount()]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    const user = userEvent.setup();
    render(<DashboardPage />);

    const todayButton = await screen.findByRole("button", { name: "Hoje" });
    await user.click(todayButton);

    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/dashboard\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/),
      { scroll: false },
    );
  });
});
