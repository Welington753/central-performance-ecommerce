// Mesmo padrão de integracoes.test.tsx: `jest.mock` automock do módulo
// inteiro (spyOn falha com "Cannot redefine property" nos exports ESM
// compilados pelo SWC deste projeto).
jest.mock("../src/lib/api");

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPage from "@/app/(protegido)/dashboard/page";
import * as api from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { MercadoLivreKpisDto } from "@/types/mercado-livre-kpis";

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
    period: {
      days: 30,
      timeZone: "America/Sao_Paulo",
      from: "2026-08-02T12:00:00.000Z",
      to: "2026-09-01T12:00:00.000Z",
    },
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
    topProducts: [
      { sku: "SKU-A", title: "Produto A", units: 5, grossRevenue: "300.00" },
    ],
    lastSync: "2026-09-01T15:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
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

  it("automatically selects the CONNECTED account and fetches its KPIs", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "CONNECTED" }),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    render(<DashboardPage />);

    await waitFor(() =>
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledWith("acc-1"),
    );
  });

  it("renders the four KPI cards with real values from the API response", async () => {
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

  it("renders the top products ranking from the API response", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount(),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(kpis());

    render(<DashboardPage />);

    expect(await screen.findByText("Produto A")).toBeInTheDocument();
    expect(screen.getByText("SKU-A")).toBeInTheDocument();
  });

  it("shows the empty ranking state when there are no top products", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount(),
    ]);
    (api.fetchMercadoLivreKpis as jest.Mock).mockResolvedValue(
      kpis({ topProducts: [] }),
    );

    render(<DashboardPage />);

    expect(
      await screen.findByText("Nenhum produto vendido no período."),
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
      .mockResolvedValueOnce(kpis({ summary: { grossRevenue: "0.00", orders: 0, units: 0, averageTicket: "0.00" } }))
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
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledWith("acc-1"),
    );

    await user.selectOptions(select, "acc-2");

    await waitFor(() =>
      expect(api.fetchMercadoLivreKpis).toHaveBeenCalledWith("acc-2"),
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
});
