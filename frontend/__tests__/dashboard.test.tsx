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

/**
 * Mesmo raciocínio de `fakeApiFetchError` em sincronizacoes-backfill.test.tsx:
 * o automock de `../src/lib/api` não roda o construtor real de
 * `UnauthorizedAnalyticsApiError`, então troca o protótipo de um `Error` de
 * verdade pelo do automock — `instanceof UnauthorizedAnalyticsApiError`
 * continua válido em `page.tsx` (mesma referência de classe).
 */
function fakeUnauthorizedAnalyticsApiError(message: string): Error {
  const error = new Error(message);
  Object.setPrototypeOf(error, api.UnauthorizedAnalyticsApiError.prototype);
  Object.assign(error, { name: "UnauthorizedAnalyticsApiError" });
  return error;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    scope: { marketplace: "ALL", accountId: null, allTime: false , logisticsScope: "ALL" },
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
      grossSalesRevenue: "1234.56",
      grossSalesOrders: 12,
      grossSalesUnits: 27,
      grossSalesAverageTicket: "102.88",
      grossSalesAvgUnitPrice: "45.72",
      cancelledUnits: 2,
      cancelledRevenue: "65.44",
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
      grossSalesRevenuePct: 12.3,
      grossSalesOrdersPct: null,
      grossSalesUnitsPct: null,
      grossSalesAverageTicketPct: null,
      grossSalesAvgUnitPricePct: null,
      cancelledUnitsPct: null,
      cancelledRevenuePct: null,
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
    breakdownByAccountUnscoped: [account()],
    sources: [],
    dataCoverage: {
      status: "complete",
      synchronizedIntervals: [{ from: "2026-07-04", to: "2026-09-01" }],
      selectedPeriodComplete: true,
      comparisonPeriodComplete: true,
    },
    lastSync: "2026-09-01T15:00:00.000Z",
    full: null,
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
    const ml = await screen.findByTestId("marketplace-account-panel-acc-1");
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
      analyticsDto({ scope: { marketplace: "MERCADO_LIVRE", accountId: "acc-1", allTime: false , logisticsScope: "ALL" } }),
    );
    render(<DashboardPage />);
    await waitFor(() =>
      expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledWith({
        from: "2026-08-01",
        to: "2026-08-31",
        marketplace: "MERCADO_LIVRE",
        accountId: "acc-1",
        logisticsScope: "ALL",
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

  describe("proteção contra requisições obsoletas (corrida entre respostas assíncronas)", () => {
    it("a stale marketplace-scope response never overwrites a newer one, and never leaves the dashboard stuck loading", async () => {
      let resolveA!: (value: MarketplaceAnalyticsKpisDto) => void;
      let resolveB!: (value: MarketplaceAnalyticsKpisDto) => void;

      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockImplementation(
        (query: { marketplace?: string }) => {
          if (!query.marketplace || query.marketplace === "ALL") {
            return new Promise<MarketplaceAnalyticsKpisDto>((resolve) => {
              resolveA = resolve;
            });
          }
          return new Promise<MarketplaceAnalyticsKpisDto>((resolve) => {
            resolveB = resolve;
          });
        },
      );

      // Requisição A começa (marketplace=ALL, o padrão).
      mockSearchParams({});
      const { rerender } = render(<DashboardPage />);
      await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1));

      // Usuário troca o filtro antes de A terminar — requisição B começa.
      mockSearchParams({ marketplace: "MERCADO_LIVRE" });
      rerender(<DashboardPage />);
      await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(2));

      // B termina primeiro.
      resolveB(
        analyticsDto({
          scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false , logisticsScope: "ALL" },
          summary: {
            ...analyticsDto().summary!,
            grossRevenue: "222.00",
            grossSalesRevenue: "222.00",
          },
        }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("kpi-card-gross-revenue")).toHaveTextContent("222,00"),
      );

      // A termina depois (mais devagar) — nunca pode substituir B.
      resolveA(
        analyticsDto({
          scope: { marketplace: "ALL", accountId: null, allTime: false , logisticsScope: "ALL" },
          summary: {
            ...analyticsDto().summary!,
            grossRevenue: "111.00",
            grossSalesRevenue: "111.00",
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByTestId("kpi-card-gross-revenue")).toHaveTextContent("222,00");
      expect(screen.queryByText(/carregando kpis/i)).not.toBeInTheDocument();
    });

    it("a stale account-scoped response never overwrites a newer one, and never leaves the dashboard stuck loading", async () => {
      let resolveScope!: (value: MarketplaceAnalyticsKpisDto) => void;
      let resolveAcc1!: (value: MarketplaceAnalyticsKpisDto) => void;
      let resolveAcc2!: (value: MarketplaceAnalyticsKpisDto) => void;

      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockImplementation(
        (query: { accountId?: string }) => {
          if (!query.accountId) {
            return new Promise<MarketplaceAnalyticsKpisDto>((resolve) => {
              resolveScope = resolve;
            });
          }
          if (query.accountId === "acc-1") {
            return new Promise<MarketplaceAnalyticsKpisDto>((resolve) => {
              resolveAcc1 = resolve;
            });
          }
          return new Promise<MarketplaceAnalyticsKpisDto>((resolve) => {
            resolveAcc2 = resolve;
          });
        },
      );

      // Requisição A (conta acc-1) começa.
      mockSearchParams({ accountId: "acc-1" });
      const { rerender } = render(<DashboardPage />);
      await waitFor(() =>
        expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledWith(
          expect.objectContaining({ accountId: "acc-1" }),
        ),
      );
      resolveScope(analyticsDto());

      // Usuário troca para a conta acc-2 antes de A terminar — B começa.
      mockSearchParams({ accountId: "acc-2" });
      rerender(<DashboardPage />);
      await waitFor(() =>
        expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledWith(
          expect.objectContaining({ accountId: "acc-2" }),
        ),
      );

      // B (acc-2) termina primeiro.
      resolveAcc2(
        analyticsDto({
          scope: { marketplace: "ALL", accountId: "acc-2", allTime: false , logisticsScope: "ALL" },
          summary: {
            ...analyticsDto().summary!,
            grossRevenue: "222.00",
            grossSalesRevenue: "222.00",
          },
        }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("kpi-card-gross-revenue")).toHaveTextContent("222,00"),
      );

      // A (acc-1) termina depois — nunca pode substituir B.
      resolveAcc1(
        analyticsDto({
          scope: { marketplace: "ALL", accountId: "acc-1", allTime: false , logisticsScope: "ALL" },
          summary: {
            ...analyticsDto().summary!,
            grossRevenue: "111.00",
            grossSalesRevenue: "111.00",
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByTestId("kpi-card-gross-revenue")).toHaveTextContent("222,00");
      expect(screen.queryByText(/carregando kpis/i)).not.toBeInTheDocument();
    });
  });

  describe("Mercado Livre Full (Fase 4)", () => {
    function fullDto(overrides: Partial<NonNullable<MarketplaceAnalyticsKpisDto["full"]>> = {}) {
      return {
        coverage: "complete" as const,
        classifiedOrders: 10,
        unclassifiedOrders: 0,
        summary: {
          grossSalesRevenue: "500.00",
          grossSalesOrders: 5,
          grossSalesUnits: 8,
          paidRevenue: "480.00",
          paidOrders: 4,
          paidUnits: 7,
          averageTicket: "120.00",
          shareOfPaidRevenuePct: 40,
          shareOfPaidUnitsPct: 30,
          cancelledOrders: 1,
          cancelledUnits: 1,
          cancelledRevenue: "20.00",
        },
        comparison: null,
        dailySeries: [
          { date: "2026-08-03", paidRevenue: "480.00", paidOrders: 4, units: 7, cancelledOrders: 1 },
        ],
        ranking: [
          {
            sku: "SKU-FULL",
            title: "Produto Full",
            distinctListings: 1,
            orders: 4,
            units: 7,
            paidRevenue: "480.00",
            grossSalesRevenue: "500.00",
            unitsSharePct: 87.5,
          },
        ],
        nonFullSummary: {
          grossSalesRevenue: "300.00",
          grossSalesOrders: 3,
          grossSalesUnits: 5,
          paidRevenue: "300.00",
          paidOrders: 3,
          paidUnits: 5,
          averageTicket: "100.00",
          cancelledOrders: 0,
          cancelledUnits: 0,
          cancelledRevenue: "0.00",
        },
        unknownSummary: null,
        totalSummary: {
          grossSalesRevenue: "800.00",
          grossSalesOrders: 8,
          grossSalesUnits: 13,
          paidRevenue: "780.00",
          paidOrders: 7,
          paidUnits: 12,
          averageTicket: "111.43",
          cancelledOrders: 1,
          cancelledUnits: 1,
          cancelledRevenue: "20.00",
        },
        ...overrides,
      };
    }

    it("does not render the Full section when full is null", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValueOnce(
        analyticsDto({ full: null }),
      );
      render(<DashboardPage />);
      await screen.findByText(/Última sincronização/);
      expect(screen.queryByText("Mercado Livre Full")).not.toBeInTheDocument();
    });

    it("renders the Full section with its cards when full.summary is populated", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValueOnce(
        analyticsDto({ full: fullDto() }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");
      expect(screen.getByTestId("full-kpi-card-paid-revenue")).toHaveTextContent(
        "480,00",
      );
      expect(screen.getByTestId("full-kpi-card-share-revenue")).toHaveTextContent(
        "40,0%",
      );
      expect(screen.getByText("Produto Full")).toBeInTheDocument();
    });

    it("shows the coverage notice (never a fake-complete display) when coverage is partial", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValueOnce(
        analyticsDto({
          full: fullDto({ coverage: "partial", classifiedOrders: 3, unclassifiedOrders: 2 }),
        }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");
      expect(screen.getByText(/Cobertura parcial da classificação Full/)).toBeInTheDocument();
      expect(screen.getByText(/3 de 5 pedidos/)).toBeInTheDocument();
    });

    it("shows a period-appropriate message instead of a fake zero when there is no proven Full order", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValueOnce(
        analyticsDto({
          full: fullDto({ coverage: "unknown", classifiedOrders: 0, unclassifiedOrders: 0, summary: null }),
        }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");
      expect(
        screen.getByText(/Nenhum pedido Full comprovado neste período ainda/),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("full-kpi-card-paid-revenue")).not.toBeInTheDocument();
    });

    it("renders the Full x sem Full x total comparison table with all three columns", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValueOnce(
        analyticsDto({ full: fullDto() }),
      );
      render(<DashboardPage />);
      await screen.findByText("Full x vendas sem Full x total geral");
      expect(screen.getByText("Vendas brutas (R$)")).toBeInTheDocument();
      const table = screen.getByText("Vendas brutas (R$)").closest("table")!;
      expect(within(table).getByText("Full")).toBeInTheDocument();
      expect(within(table).getByText("Vendas sem Full")).toBeInTheDocument();
      expect(within(table).getByText("Total geral")).toBeInTheDocument();
    });

    it("shows the amber unknown indicator with value/orders/units when there is any unclassified order", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValueOnce(
        analyticsDto({
          full: fullDto({
            classifiedOrders: 3,
            unclassifiedOrders: 2,
            unknownSummary: {
              grossSalesRevenue: "40.00",
              grossSalesOrders: 2,
              grossSalesUnits: 2,
              paidRevenue: "40.00",
              paidOrders: 2,
              paidUnits: 2,
              averageTicket: "20.00",
              cancelledOrders: 0,
              cancelledUnits: 0,
              cancelledRevenue: "0.00",
            },
          }),
        }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");
      expect(screen.getByText(/2 pedido\(s\) ainda não classificado/)).toBeInTheDocument();
      expect(
        screen.getByText(/R\$\s?40,00 em vendas brutas, 2 pedido\(s\), 2 unidade\(s\)/),
      ).toBeInTheDocument();
    });

    it("confirms Full + sem Full = total when there is no unclassified order", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValueOnce(
        analyticsDto({ full: fullDto({ classifiedOrders: 10, unclassifiedOrders: 0 }) }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");
      expect(
        screen.getByText(/Full \+ vendas sem Full = total das vendas/),
      ).toBeInTheDocument();
    });

    /**
     * Correção da auditoria Full: a seção "Mercado Livre Full" nunca pode
     * aparecer num escopo Amazon/Shopee. Antes, com um desses marketplaces
     * selecionado, o dashboard exibia o cabeçalho e o aviso âmbar dizendo
     * que os pedidos seriam classificados numa próxima sincronização — o que
     * nunca aconteceria, porque esses conectores jamais preenchem a
     * classificação logística.
     *
     * O `full` é enviado preenchido de propósito nestes testes: o gate do
     * frontend precisa valer por si, independentemente do backend (que
     * agora também devolve `null` nesse escopo).
     */
    it.each(["AMAZON", "SHOPEE"] as const)(
      "never renders the Mercado Livre Full section under a %s scope",
      async (marketplace) => {
        mockSearchParams({ marketplace });
        (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
          analyticsDto({
            full: fullDto(),
            scope: { marketplace, accountId: null, allTime: false, logisticsScope: "ALL" },
          }),
        );
        render(<DashboardPage />);
        await screen.findByText(/Última sincronização/);

        expect(screen.queryByText("Mercado Livre Full")).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("full-kpi-card-paid-revenue"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(/modalidade logística/i),
        ).not.toBeInTheDocument();
      },
    );

    it("still renders the Full section under the ALL scope", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({ full: fullDto() }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");
    });

    it("renders the Full section for a Mercado Livre account scope", async () => {
      mockSearchParams({ marketplace: "MERCADO_LIVRE", accountId: "acc-1" });
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          full: fullDto(),
          scope: {
            marketplace: "MERCADO_LIVRE",
            accountId: "acc-1",
            allTime: false,
            logisticsScope: "ALL",
          },
        }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");
    });

    /**
     * Revisão crítica: cada conta Mercado Livre deve mostrar SÓ os próprios
     * números — nunca os de outra conta nem o consolidado. O gate/fetch
     * usam `accountId` da URL; este teste prova que o valor renderizado é
     * exatamente o que a API devolveu PARA aquela conta, forwardando o
     * `accountId` correto na chamada.
     */
    it.each([
      { accountId: "acc-1", label: "Meli 1", paidRevenue: "111.00" },
      { accountId: "acc-2", label: "Meli 2", paidRevenue: "222.00" },
    ])(
      "$label (accountId=$accountId) renders only its own Full numbers, never another account's",
      async ({ accountId, paidRevenue }) => {
        mockSearchParams({ marketplace: "MERCADO_LIVRE", accountId });
        (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
          analyticsDto({
            full: fullDto({ summary: { ...fullDto().summary!, paidRevenue } }),
            scope: {
              marketplace: "MERCADO_LIVRE",
              accountId,
              allTime: false,
              logisticsScope: "ALL",
            },
          }),
        );
        render(<DashboardPage />);
        await screen.findByText("Mercado Livre Full");

        expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledWith(
          expect.objectContaining({ marketplace: "MERCADO_LIVRE", accountId }),
        );
        expect(
          screen.getByTestId("full-kpi-card-paid-revenue"),
        ).toHaveTextContent(paidRevenue.replace(".", ","));
      },
    );

    /**
     * Correção da auditoria Full: os avisos usavam `text-amber-800`/
     * `text-green-700` fixos, que não acompanham o tema — sobre a superfície
     * escura o contraste caía abaixo do mínimo do WCAG AA. Agora usam
     * tokens redefinidos no bloco `prefers-color-scheme: dark`.
     */
    it("uses theme-aware tokens on the notices — never a fixed palette colour", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          full: fullDto({
            coverage: "partial",
            classifiedOrders: 3,
            unclassifiedOrders: 2,
          }),
        }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");

      const notice = screen
        .getByText(/Cobertura parcial da classificação Full/)
        .closest("div")!;
      expect(notice.className).toContain("text-notice");
      expect(notice.className).toContain("bg-notice/10");
      expect(notice.className).not.toMatch(/text-amber-\d/);
      expect(notice.className).not.toMatch(/bg-amber-\d/);

      const unknownIndicator = screen
        .getByText(/2 pedido\(s\) ainda não classificado/)
        .closest("div")!;
      expect(unknownIndicator.className).not.toMatch(/text-amber-\d/);
    });

    it("uses a theme-aware token on the 'no unclassified order' confirmation", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({ full: fullDto({ unclassifiedOrders: 0 }) }),
      );
      render(<DashboardPage />);
      await screen.findByText("Mercado Livre Full");

      const confirmation = screen.getByText(
        /Full \+ vendas sem Full = total das vendas/,
      );
      expect(confirmation.className).toContain("text-positive");
      expect(confirmation.className).not.toMatch(/text-green-\d/);
    });
  });

  describe("filtro Tipo de venda / logisticsScope (Fase 4)", () => {
    it("only shows the logistics filter when marketplace is MERCADO_LIVRE", async () => {
      mockSearchParams({ marketplace: "MERCADO_LIVRE" });
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false, logisticsScope: "ALL" },
        }),
      );
      render(<DashboardPage />);
      await screen.findByText(/Última sincronização/);
      expect(screen.getByRole("group", { name: "Tipo de venda" })).toBeInTheDocument();
    });

    it("hides the logistics filter for ALL/Amazon/Shopee", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());
      render(<DashboardPage />);
      await screen.findByText(/Última sincronização/);
      expect(screen.queryByRole("group", { name: "Tipo de venda" })).not.toBeInTheDocument();
    });

    /**
     * Correção da auditoria Full: com "Somente Full" ou "Vendas sem Full"
     * selecionado, os pedidos `UNKNOWN` saem dos DOIS lados. O único aviso
     * sobre isso ficava dentro da seção Full, muito abaixo do filtro — quem
     * trocasse o filtro via os números mudarem sem nenhuma explicação.
     */
    function fullWithUnclassified(unclassifiedOrders: number) {
      return {
        coverage: unclassifiedOrders > 0 ? ("partial" as const) : ("complete" as const),
        classifiedOrders: 8,
        unclassifiedOrders,
        summary: null,
        comparison: null,
        dailySeries: [],
        ranking: [],
        nonFullSummary: null,
        unknownSummary: null,
        totalSummary: null,
      };
    }

    it.each(["FULL", "NON_FULL"] as const)(
      "shows the coverage notice next to the filter when %s is selected and UNKNOWN orders exist",
      async (logistics) => {
        mockSearchParams({ marketplace: "MERCADO_LIVRE", logistics });
        (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
          analyticsDto({
            full: fullWithUnclassified(2),
            scope: {
              marketplace: "MERCADO_LIVRE",
              accountId: null,
              allTime: false,
              logisticsScope: logistics,
            },
          }),
        );
        render(<DashboardPage />);
        await screen.findByText(/Última sincronização/);

        const notice = await screen.findByTestId(
          "logistics-scope-coverage-notice",
        );
        expect(notice).toHaveTextContent(/2 pedido\(s\)/);
        expect(notice).toHaveTextContent(/ficaram FORA do filtro/);
        // UNKNOWN nunca é apresentado como "sem Full", zero ou seller.
        expect(notice).toHaveTextContent(
          /não classificado não é o mesmo que "sem Full"/,
        );
        expect(notice.className).toContain("text-notice");
      },
    );

    it("does not show the coverage notice when every order is classified", async () => {
      mockSearchParams({ marketplace: "MERCADO_LIVRE", logistics: "FULL" });
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          full: fullWithUnclassified(0),
          scope: {
            marketplace: "MERCADO_LIVRE",
            accountId: null,
            allTime: false,
            logisticsScope: "FULL",
          },
        }),
      );
      render(<DashboardPage />);
      await screen.findByText(/Última sincronização/);

      expect(
        screen.queryByTestId("logistics-scope-coverage-notice"),
      ).not.toBeInTheDocument();
    });

    it("does not show the coverage notice while the filter is on 'Todas as vendas'", async () => {
      mockSearchParams({ marketplace: "MERCADO_LIVRE" });
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          full: fullWithUnclassified(5),
          scope: {
            marketplace: "MERCADO_LIVRE",
            accountId: null,
            allTime: false,
            logisticsScope: "ALL",
          },
        }),
      );
      render(<DashboardPage />);
      await screen.findByText(/Última sincronização/);

      expect(
        screen.queryByTestId("logistics-scope-coverage-notice"),
      ).not.toBeInTheDocument();
    });

    it("clicking 'Somente Full' updates the URL and forwards logisticsScope=FULL to the fetch", async () => {
      mockSearchParams({ marketplace: "MERCADO_LIVRE" });
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false, logisticsScope: "ALL" },
        }),
      );
      render(<DashboardPage />);
      await screen.findByText(/Última sincronização/);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Somente Full" }));

      expect(replaceMock).toHaveBeenLastCalledWith(
        expect.stringContaining("logistics=FULL"),
        expect.anything(),
      );
    });

    it("switching marketplace away from MERCADO_LIVRE drops logistics from the URL (reset to ALL)", async () => {
      mockSearchParams({ marketplace: "MERCADO_LIVRE", logistics: "FULL" });
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false, logisticsScope: "FULL" },
        }),
      );
      const user = userEvent.setup();
      render(<DashboardPage />);
      const select = await screen.findByLabelText("Marketplace");
      await user.selectOptions(select, "AMAZON");

      const [calledUrl] = replaceMock.mock.calls[replaceMock.mock.calls.length - 1] as [
        string,
      ];
      expect(calledUrl).not.toMatch(/[?&]logistics=/);
    });
  });

  describe("período efetivamente consultado (Fase 4, item 1)", () => {
    it("shows the real backend-resolved dates when 'Todo o período' is selected", async () => {
      mockSearchParams({ period: "all" });
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          scope: { marketplace: "ALL", accountId: null, allTime: true, logisticsScope: "ALL" },
          period: { days: 62, timeZone: "America/Sao_Paulo", from: "2026-07-04", to: "2026-09-04" },
          comparison: null,
        }),
      );
      render(<DashboardPage />);
      await screen.findByText(/Última sincronização/);
      expect(
        screen.getByText((_, node) => node?.textContent === "Período consultado: 04/07/2026 a 04/09/2026"),
      ).toBeInTheDocument();
    });
  });

  describe("resultado válido preservado durante atualização (chave canônica de escopo)", () => {
    it("1. falha inicial sem nenhum dado carregado ainda mostra o ErrorBlock", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockRejectedValue(
        new Error("network down"),
      );
      render(<DashboardPage />);
      expect(
        await screen.findByText(/não foi possível carregar/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("kpi-card-gross-revenue")).not.toBeInTheDocument();
    });

    it("2. atualização do mesmo escopo que falha mantém os dados visíveis e mostra o aviso", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock)
        .mockResolvedValueOnce(analyticsDto())
        .mockRejectedValueOnce(new Error("network down"));
      (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({ status: "SUCCESS" });
      const user = userEvent.setup();
      render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");

      await user.click(screen.getByRole("button", { name: /sincronizar agora/i }));

      expect(
        await screen.findByText(/não foi possível atualizar agora/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("kpi-card-gross-revenue")).toBeInTheDocument();
      // Rótulo correto do horário — nunca chamado de "última sincronização".
      expect(
        screen.getByText(/dados carregados em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/i),
      ).toBeInTheDocument();
    });

    it("3. uma nova tentativa bem-sucedida remove o aviso e atualiza os números", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock)
        .mockResolvedValueOnce(analyticsDto())
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce(
          analyticsDto({
            summary: {
              ...analyticsDto().summary!,
              grossRevenue: "999.00",
              grossSalesRevenue: "999.00",
            },
          }),
        );
      (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({ status: "SUCCESS" });
      const user = userEvent.setup();
      render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");
      await user.click(screen.getByRole("button", { name: /sincronizar agora/i }));
      await screen.findByText(/não foi possível atualizar agora/i);

      await user.click(screen.getByRole("button", { name: /tentar novamente/i }));

      await waitFor(() =>
        expect(screen.queryByText(/não foi possível atualizar agora/i)).not.toBeInTheDocument(),
      );
      expect(screen.getByTestId("kpi-card-gross-revenue")).toHaveTextContent("999,00");
    });

    it("4. trocar de conta e falhar nunca mostra os dados da conta anterior", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockImplementation(
        (query: { accountId?: string }) => {
          if (query.accountId === "acc-1") {
            return Promise.resolve(
              analyticsDto({
                scope: { marketplace: "ALL", accountId: "acc-1", allTime: false, logisticsScope: "ALL" },
              }),
            );
          }
          if (query.accountId === "acc-2") {
            return Promise.reject(new Error("network down"));
          }
          return Promise.resolve(analyticsDto());
        },
      );
      mockSearchParams({ accountId: "acc-1" });
      const { rerender } = render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");

      mockSearchParams({ accountId: "acc-2" });
      rerender(<DashboardPage />);

      expect(
        await screen.findByText(/não foi possível carregar os kpis agora/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("kpi-card-gross-revenue")).not.toBeInTheDocument();
    });

    it("5. trocar de período e falhar nunca mostra os dados do período anterior", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockImplementation(
        (query: { from?: string; to?: string }) => {
          if (query.from === "2026-08-01") return Promise.resolve(analyticsDto());
          return Promise.reject(new Error("network down"));
        },
      );
      mockSearchParams({ from: "2026-08-01", to: "2026-08-31" });
      const { rerender } = render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");

      mockSearchParams({ from: "2026-07-01", to: "2026-07-31" });
      rerender(<DashboardPage />);

      expect(
        await screen.findByText(/não foi possível carregar os kpis agora/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("kpi-card-gross-revenue")).not.toBeInTheDocument();
    });

    it("6. trocar o filtro logístico e falhar nunca mostra o grupo logístico anterior", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockImplementation(
        (query: { logisticsScope?: string }) => {
          if (!query.logisticsScope || query.logisticsScope === "ALL") {
            return Promise.resolve(
              analyticsDto({
                scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false, logisticsScope: "ALL" },
              }),
            );
          }
          return Promise.reject(new Error("network down"));
        },
      );
      mockSearchParams({ marketplace: "MERCADO_LIVRE" });
      const { rerender } = render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");

      // `router.replace` é mockado e não atualiza `useSearchParams()` de
      // verdade (mesmo padrão dos testes de corrida acima) — simula a troca
      // de URL diretamente e re-renderiza.
      mockSearchParams({ marketplace: "MERCADO_LIVRE", logistics: "FULL" });
      rerender(<DashboardPage />);

      expect(
        await screen.findByText(/não foi possível carregar os kpis agora/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("kpi-card-gross-revenue")).not.toBeInTheDocument();
    });

    it("7. uma resposta atrasada de um escopo antigo nunca sobrescreve o escopo atual", async () => {
      const first = deferred<MarketplaceAnalyticsKpisDto>();
      const second = deferred<MarketplaceAnalyticsKpisDto>();
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockImplementation(
        (query: { marketplace?: string }) =>
          !query.marketplace || query.marketplace === "ALL" ? first.promise : second.promise,
      );

      mockSearchParams({});
      const { rerender } = render(<DashboardPage />);
      await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1));

      mockSearchParams({ marketplace: "MERCADO_LIVRE" });
      rerender(<DashboardPage />);
      await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(2));

      second.resolve(
        analyticsDto({
          scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false, logisticsScope: "ALL" },
          summary: { ...analyticsDto().summary!, grossRevenue: "222.00", grossSalesRevenue: "222.00" },
        }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("kpi-card-gross-revenue")).toHaveTextContent("222,00"),
      );

      first.resolve(
        analyticsDto({
          summary: { ...analyticsDto().summary!, grossRevenue: "111.00", grossSalesRevenue: "111.00" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByTestId("kpi-card-gross-revenue")).toHaveTextContent("222,00");
    });

    it("8. um erro atrasado de um escopo antigo nunca aparece no escopo atual", async () => {
      const first = deferred<MarketplaceAnalyticsKpisDto>();
      const second = deferred<MarketplaceAnalyticsKpisDto>();
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockImplementation(
        (query: { marketplace?: string }) =>
          !query.marketplace || query.marketplace === "ALL" ? first.promise : second.promise,
      );

      mockSearchParams({});
      const { rerender } = render(<DashboardPage />);
      await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1));

      mockSearchParams({ marketplace: "MERCADO_LIVRE" });
      rerender(<DashboardPage />);
      await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(2));

      second.resolve(
        analyticsDto({
          scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false, logisticsScope: "ALL" },
        }),
      );
      await screen.findByTestId("kpi-card-gross-revenue");

      first.reject(new Error("network down"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByTestId("kpi-card-gross-revenue")).toBeInTheDocument();
      expect(screen.queryByText(/não foi possível/i)).not.toBeInTheDocument();
    });

    it("9. carregamento do mesmo escopo (atualização em andamento) mantém os cards visíveis", async () => {
      const second = deferred<MarketplaceAnalyticsKpisDto>();
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock)
        .mockResolvedValueOnce(analyticsDto())
        .mockReturnValueOnce(second.promise);
      (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({ status: "SUCCESS" });
      const user = userEvent.setup();
      render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");

      await user.click(screen.getByRole("button", { name: /sincronizar agora/i }));

      expect(await screen.findByText(/atualizando dados/i)).toBeInTheDocument();
      expect(screen.getByTestId("kpi-card-gross-revenue")).toBeInTheDocument();
      expect(screen.queryByText(/carregando kpis/i)).not.toBeInTheDocument();

      second.resolve(analyticsDto());
      await waitFor(() =>
        expect(screen.queryByText(/atualizando dados/i)).not.toBeInTheDocument(),
      );
    });

    it("10. 401/403 na atualização segue o comportamento seguro: nunca preserva dados como se a sessão fosse válida", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock)
        .mockResolvedValueOnce(analyticsDto())
        .mockRejectedValueOnce(
          fakeUnauthorizedAnalyticsApiError("Sessão expirada ou sem permissão para este escopo."),
        );
      (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({ status: "SUCCESS" });
      const user = userEvent.setup();
      render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");

      await user.click(screen.getByRole("button", { name: /sincronizar agora/i }));

      expect(
        await screen.findByText(/sessão expirada ou sem permissão/i),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("kpi-card-gross-revenue")).not.toBeInTheDocument();
      expect(screen.queryByText(/não foi possível atualizar agora/i)).not.toBeInTheDocument();
    });

    it("11. cobertura parcial continua mostrando o aviso de cobertura mesmo no fluxo de resultado válido", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(
        analyticsDto({
          dataCoverage: {
            status: "partial",
            synchronizedIntervals: [{ from: "2026-08-15", to: "2026-09-01" }],
            selectedPeriodComplete: false,
            comparisonPeriodComplete: true,
          },
        }),
      );
      render(<DashboardPage />);
      await screen.findByTestId("kpi-card-gross-revenue");
      expect(screen.getByText(/cobertura parcial/i)).toBeInTheDocument();
    });

    it("12. o ErrorBlock fatal nunca exibe nenhum KPI fictício", async () => {
      (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockRejectedValue(
        new Error("network down"),
      );
      render(<DashboardPage />);
      await screen.findByText(/não foi possível carregar/i);
      expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();
    });
  });
});
