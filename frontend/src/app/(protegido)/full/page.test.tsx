import { render, screen, waitFor } from "@testing-library/react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import FullPage from "./page";
import type {
  AccountBreakdownEntry,
  MarketplaceAnalyticsFull,
  MarketplaceAnalyticsKpisDto,
  MarketplaceBreakdownEntry,
} from "@/types/marketplace-analytics";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Mesmo motivo do dashboard/page.test.tsx: `jest.mock` resolve o próprio
// argumento fora do pipeline de transform do Next, então precisa de caminho
// relativo real (não do alias `@/*`).
jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return {
    ...actual,
    fetchMarketplaceAnalyticsKpis: jest.fn(),
  };
});

const api = jest.requireMock("../../../lib/api") as {
  fetchMarketplaceAnalyticsKpis: jest.Mock;
};

function account(overrides: Partial<AccountBreakdownEntry> = {}): AccountBreakdownEntry {
  return {
    accountId: "acc-1",
    marketplace: "MERCADO_LIVRE",
    nickname: "Loja Principal",
    externalSellerId: "123",
    status: "CONNECTED",
    availability: "AVAILABLE",
    summary: null,
    lastSync: null,
    ...overrides,
  };
}

function marketplaceEntry(
  overrides: Partial<MarketplaceBreakdownEntry> = {},
): MarketplaceBreakdownEntry {
  return {
    marketplace: "MERCADO_LIVRE",
    availability: "AVAILABLE",
    accountsIncluded: 1,
    accountsTotal: 1,
    summary: null,
    lastSync: null,
    ...overrides,
  };
}

function kpisDto(
  overrides: Partial<MarketplaceAnalyticsKpisDto> = {},
): MarketplaceAnalyticsKpisDto {
  return {
    scope: { marketplace: "ALL", accountId: null, allTime: false, logisticsScope: "ALL" },
    availability: "AVAILABLE",
    period: { days: 30, timeZone: "America/Sao_Paulo", from: "2026-08-01", to: "2026-08-30" },
    comparisonPeriod: { days: 30, from: "2026-07-01", to: "2026-07-31" },
    summary: null,
    comparison: null,
    bestDay: null,
    dailySeries: [],
    topProductsBySku: [],
    topListings: [],
    breakdownByMarketplace: [marketplaceEntry()],
    breakdownByAccount: [account()],
    breakdownByAccountUnscoped: [account()],
    sources: [],
    dataCoverage: {
      status: "complete",
      synchronizedIntervals: [],
      selectedPeriodComplete: true,
      comparisonPeriodComplete: true,
    },
    lastSync: null,
    full: null,
    shopeeFull: null,
    ...overrides,
  };
}

function fullAggregate(
  overrides: Partial<MarketplaceAnalyticsFull> = {},
): MarketplaceAnalyticsFull {
  const group = {
    grossSalesRevenue: "300.00",
    grossSalesOrders: 3,
    grossSalesUnits: 3,
    paidRevenue: "300.00",
    paidOrders: 3,
    paidUnits: 3,
    averageTicket: "100.00",
    cancelledOrders: 0,
    cancelledUnits: 0,
    cancelledRevenue: "0.00",
  };
  return {
    coverage: "complete",
    classifiedOrders: 3,
    unclassifiedOrders: 0,
    summary: { ...group, shareOfPaidRevenuePct: 100, shareOfPaidUnitsPct: 100 },
    comparison: null,
    dailySeries: [],
    ranking: [],
    nonFullSummary: null,
    unknownSummary: null,
    totalSummary: group,
    ...overrides,
  };
}

function mockSearchParams(params: Record<string, string> = {}) {
  const search = new URLSearchParams(params);
  (useSearchParams as jest.Mock).mockReturnValue(search);
}

const routerReplace = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ replace: routerReplace });
  (usePathname as jest.Mock).mockReturnValue("/full");
  mockSearchParams();
});

async function renderFullWithScope(dto: MarketplaceAnalyticsKpisDto) {
  api.fetchMarketplaceAnalyticsKpis.mockResolvedValueOnce(dto);
  render(<FullPage />);
  await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1));
}

describe("FullPage — escopo por marketplace", () => {
  it("ALL: mostra as seções Mercado Livre Full e Shopee Full separadamente", async () => {
    await renderFullWithScope(
      kpisDto({
        scope: { marketplace: "ALL", accountId: null, allTime: true, logisticsScope: "ALL" },
        full: fullAggregate(),
        shopeeFull: fullAggregate(),
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Mercado Livre Full" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Shopee Full" }),
    ).toBeInTheDocument();
  });

  it("MERCADO_LIVRE: mostra somente a seção Mercado Livre Full", async () => {
    mockSearchParams({ marketplace: "MERCADO_LIVRE" });
    await renderFullWithScope(
      kpisDto({
        scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: true, logisticsScope: "ALL" },
        full: fullAggregate(),
        shopeeFull: null,
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Mercado Livre Full" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Shopee Full" }),
    ).not.toBeInTheDocument();
  });

  it("SHOPEE: mostra somente a seção Shopee Full", async () => {
    mockSearchParams({ marketplace: "SHOPEE" });
    await renderFullWithScope(
      kpisDto({
        scope: { marketplace: "SHOPEE", accountId: null, allTime: true, logisticsScope: "ALL" },
        full: null,
        shopeeFull: fullAggregate(),
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Shopee Full" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pedidos processados pela logística Full da Shopee."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Mercado Livre Full" }),
    ).not.toBeInTheDocument();
  });

  it("AMAZON: não mostra nenhuma seção Full, só a mensagem de ausência de dados", async () => {
    mockSearchParams({ marketplace: "AMAZON" });
    await renderFullWithScope(
      kpisDto({
        scope: { marketplace: "AMAZON", accountId: null, allTime: true, logisticsScope: "ALL" },
        full: null,
        shopeeFull: null,
      }),
    );

    expect(
      await screen.findByText("Nenhum dado de Full disponível para este escopo."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Mercado Livre Full" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Shopee Full" }),
    ).not.toBeInTheDocument();
  });
});

describe("FullPage — cobertura UNKNOWN", () => {
  it("preserva o aviso de cobertura não classificada dentro da seção Full", async () => {
    await renderFullWithScope(
      kpisDto({
        scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: true, logisticsScope: "ALL" },
        full: fullAggregate({ coverage: "unknown", classifiedOrders: 0, unclassifiedOrders: 5 }),
        shopeeFull: null,
      }),
    );

    expect(
      await screen.findByText(
        /Ainda não foi possível identificar a modalidade logística/i,
      ),
    ).toBeInTheDocument();
  });
});

describe("FullPage — estados de carregamento, erro e ausência de dados", () => {
  it("mostra o loading inicial enquanto a primeira busca está em voo", async () => {
    api.fetchMarketplaceAnalyticsKpis.mockReturnValueOnce(new Promise(() => {}));
    render(<FullPage />);

    expect(screen.getByLabelText("Carregando...")).toBeInTheDocument();
  });

  it("mostra erro e permite tentar novamente quando a busca inicial falha", async () => {
    api.fetchMarketplaceAnalyticsKpis.mockRejectedValueOnce(new Error("boom"));
    render(<FullPage />);

    expect(
      await screen.findByText(
        "Não foi possível carregar os dados de marketplaces. Tente novamente mais tarde.",
      ),
    ).toBeInTheDocument();
  });

  it("mostra o estado vazio quando nenhum marketplace está conectado", async () => {
    await renderFullWithScope(
      kpisDto({
        scope: { marketplace: "ALL", accountId: null, allTime: true, logisticsScope: "ALL" },
        availability: "NOT_CONNECTED",
        breakdownByMarketplace: [],
        breakdownByAccount: [],
        breakdownByAccountUnscoped: [],
      }),
    );

    expect(
      await screen.findByText("Nenhum marketplace conectado"),
    ).toBeInTheDocument();
  });
});

describe("FullPage — filtros", () => {
  it("mantém o filtro de período e marketplace/conta na tela", async () => {
    await renderFullWithScope(kpisDto());

    expect(await screen.findByRole("button", { name: /todo o período/i })).toBeInTheDocument();
  });

  it("não duplica a requisição de KPIs sem conta selecionada", async () => {
    await renderFullWithScope(kpisDto());

    expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1);
  });
});
