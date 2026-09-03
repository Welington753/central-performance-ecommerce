import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import DashboardPage from "./page";
import { ApiFetchError } from "@/lib/api";
import type {
  AccountBreakdownEntry,
  MarketplaceAnalyticsKpisDto,
  MarketplaceBreakdownEntry,
} from "@/types/marketplace-analytics";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

// `jest.mock`/`jest.requireActual` resolvem o próprio argumento fora do
// pipeline de transform do Next (que é o que entende o alias `@/*`) — por
// isso, ao contrário dos `import`s normais deste arquivo, aqui é preciso um
// caminho relativo real para `src/lib/api.ts`.
jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return {
    ...actual,
    fetchMarketplaceAnalyticsKpis: jest.fn(),
    syncMercadoLivreOrders: jest.fn(),
  };
});

const api = jest.requireMock("../../../lib/api") as {
  fetchMarketplaceAnalyticsKpis: jest.Mock;
  syncMercadoLivreOrders: jest.Mock;
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
    scope: { marketplace: "ALL", accountId: null, allTime: false },
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
    sources: [],
    dataCoverage: {
      status: "complete",
      synchronizedIntervals: [],
      selectedPeriodComplete: true,
      comparisonPeriodComplete: true,
    },
    lastSync: null,
    ...overrides,
  };
}

function mockSearchParams(params: Record<string, string> = {}) {
  const search = new URLSearchParams(params);
  (useSearchParams as jest.Mock).mockReturnValue(search);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const routerReplace = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ replace: routerReplace });
  (usePathname as jest.Mock).mockReturnValue("/dashboard");
  mockSearchParams();
});

async function renderDashboardWithScope(dto: MarketplaceAnalyticsKpisDto) {
  api.fetchMarketplaceAnalyticsKpis.mockResolvedValueOnce(dto);
  render(<DashboardPage />);
  await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1));
  await screen.findByText(/Última sincronização/);
}

describe("DashboardPage — elegibilidade do botão de sincronização", () => {
  it("não mostra nenhuma opção de sincronizar quando não há conta Mercado Livre conectada no escopo", async () => {
    await renderDashboardWithScope(
      kpisDto({ breakdownByAccount: [account({ status: "TOKEN_EXPIRED", availability: "HISTORICAL_ONLY" })] }),
    );
    expect(screen.queryByText("Sincronizar agora")).not.toBeInTheDocument();
    expect(screen.queryByText(/Várias contas/)).not.toBeInTheDocument();
  });

  it("mostra o botão 'Sincronizar agora' quando exatamente uma conta Mercado Livre está conectada no escopo", async () => {
    await renderDashboardWithScope(kpisDto());
    expect(screen.getByRole("button", { name: "Sincronizar agora" })).toBeInTheDocument();
  });

  it("mostra o link para /sincronizacoes (não o botão) quando há mais de uma conta conectada no escopo", async () => {
    await renderDashboardWithScope(
      kpisDto({
        breakdownByAccount: [
          account({ accountId: "acc-1" }),
          account({ accountId: "acc-2" }),
        ],
      }),
    );
    expect(screen.queryByRole("button", { name: "Sincronizar agora" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Várias contas/ })).toHaveAttribute(
      "href",
      "/sincronizacoes",
    );
  });
});

describe("DashboardPage — contas HISTORICAL_ONLY", () => {
  it("mostra o aviso de reconexão para contas com availability HISTORICAL_ONLY, mantendo o histórico visível", async () => {
    await renderDashboardWithScope(
      kpisDto({
        breakdownByAccount: [
          account({ accountId: "acc-1", availability: "HISTORICAL_ONLY", nickname: "Loja Antiga" }),
        ],
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /Loja Antiga.*precisa de atenção/,
    );
    expect(screen.getByRole("link", { name: "Reconectar" })).toHaveAttribute(
      "href",
      "/integracoes",
    );
  });
});

describe("DashboardPage — resultado da sincronização", () => {
  it("caminho de sucesso: sincroniza, recarrega os KPIs do escopo atual e não mostra erro", async () => {
    await renderDashboardWithScope(kpisDto());
    api.syncMercadoLivreOrders.mockResolvedValueOnce({ status: "SUCCESS" });
    api.fetchMarketplaceAnalyticsKpis.mockResolvedValueOnce(kpisDto());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sincronizar agora" })).not.toBeDisabled();
  });

  it("sucesso parcial: sincronização é concluída mas a recarga de KPIs falha — mostra erro de KPI, não erro de sincronização", async () => {
    await renderDashboardWithScope(kpisDto());
    api.syncMercadoLivreOrders.mockResolvedValueOnce({ status: "SUCCESS" });
    api.fetchMarketplaceAnalyticsKpis.mockRejectedValueOnce(new Error("boom"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    await screen.findByText("Não foi possível carregar os KPIs agora.");
    expect(
      screen.queryByText("Não foi possível sincronizar agora. Tente novamente."),
    ).not.toBeInTheDocument();
  });

  it("TOKEN_EXPIRED: mostra mensagem específica pedindo reconexão", async () => {
    await renderDashboardWithScope(kpisDto());
    api.syncMercadoLivreOrders.mockRejectedValueOnce(
      new ApiFetchError("Não foi possível sincronizar agora. Tente novamente.", "TOKEN_EXPIRED"),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    await screen.findByText(
      "O Mercado Livre encerrou o acesso desta conta. Reconecte-a em Integrações.",
    );
  });

  it("SYNC_ALREADY_RUNNING: mostra mensagem específica de sincronização já em andamento", async () => {
    await renderDashboardWithScope(kpisDto());
    api.syncMercadoLivreOrders.mockRejectedValueOnce(
      new ApiFetchError(
        "Não foi possível sincronizar agora. Tente novamente.",
        "SYNC_ALREADY_RUNNING",
      ),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    await screen.findByText(
      "Já existe uma sincronização em andamento para esta conta. Aguarde a conclusão.",
    );
  });

  it("backend indisponível (falha de rede): mostra a mensagem de comunicação com o servidor, não a genérica de sincronização", async () => {
    await renderDashboardWithScope(kpisDto());
    api.syncMercadoLivreOrders.mockRejectedValueOnce(
      new ApiFetchError("Não foi possível se comunicar com o servidor. Tente novamente mais tarde."),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    await screen.findByText(
      "Não foi possível se comunicar com o servidor. Tente novamente mais tarde.",
    );
  });

  it("código não mapeado (SYNC_FAILED): cai na mensagem genérica de sincronização", async () => {
    await renderDashboardWithScope(kpisDto());
    api.syncMercadoLivreOrders.mockRejectedValueOnce(
      new ApiFetchError("Não foi possível sincronizar agora. Tente novamente.", "SYNC_FAILED"),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    await screen.findByText("Não foi possível sincronizar agora. Tente novamente.");
  });

  it("duplo clique: a segunda tentativa é ignorada enquanto a primeira sincronização está em voo", async () => {
    await renderDashboardWithScope(kpisDto());
    const sync = deferred<{ status: "SUCCESS" }>();
    api.syncMercadoLivreOrders.mockReturnValueOnce(sync.promise);

    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Sincronizar agora" });
    await user.click(button);
    expect(screen.getByRole("button", { name: "Sincronizando..." })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Sincronizando..." }));

    expect(api.syncMercadoLivreOrders).toHaveBeenCalledTimes(1);

    api.fetchMarketplaceAnalyticsKpis.mockResolvedValueOnce(kpisDto());
    sync.resolve({ status: "SUCCESS" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sincronizar agora" })).not.toBeDisabled(),
    );
  });

  it("preserva o período/marketplace do filtro atual ao recarregar os KPIs após sincronizar", async () => {
    mockSearchParams({ from: "2026-06-01", to: "2026-06-30", marketplace: "MERCADO_LIVRE" });
    await renderDashboardWithScope(
      kpisDto({ scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false } }),
    );
    api.syncMercadoLivreOrders.mockResolvedValueOnce({ status: "SUCCESS" });
    api.fetchMarketplaceAnalyticsKpis.mockResolvedValueOnce(kpisDto());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sincronizar agora" }));

    await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(2));
    expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenLastCalledWith({
      from: "2026-06-01",
      to: "2026-06-30",
      marketplace: "MERCADO_LIVRE",
    });
  });
});

describe("DashboardPage — troca de filtro durante uma sincronização em andamento", () => {
  it("uma resposta de KPI mais antiga nunca sobrescreve uma resposta mais nova de um filtro trocado durante o carregamento", async () => {
    const first = deferred<MarketplaceAnalyticsKpisDto>();
    const second = deferred<MarketplaceAnalyticsKpisDto>();
    api.fetchMarketplaceAnalyticsKpis
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    mockSearchParams();
    const { rerender } = render(<DashboardPage />);
    await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1));

    mockSearchParams({ marketplace: "MERCADO_LIVRE" });
    rerender(<DashboardPage />);
    await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(2));

    // A resposta mais antiga (escopo ALL) chega DEPOIS da mais nova — nunca pode vencer.
    first.resolve(kpisDto({ scope: { marketplace: "ALL", accountId: null, allTime: false } }));
    second.resolve(
      kpisDto({
        scope: { marketplace: "MERCADO_LIVRE", accountId: null, allTime: false },
        breakdownByAccount: [account()],
      }),
    );

    await screen.findByRole("heading", { name: "Desempenho do Mercado Livre" });
    expect(screen.queryByRole("heading", { name: "Visão consolidada dos marketplaces" })).not.toBeInTheDocument();
  });
});

describe("DashboardPage — Todo o período (Fase 4)", () => {
  it("clicking 'Todo o período' puts period=all in the URL and drops from/to", async () => {
    api.fetchMarketplaceAnalyticsKpis.mockResolvedValue(kpisDto());
    const user = userEvent.setup();
    render(<DashboardPage />);
    await waitFor(() => expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: /todo o período/i }));

    expect(routerReplace).toHaveBeenCalledWith(
      expect.stringContaining("period=all"),
      expect.anything(),
    );
    const [calledUrl] = routerReplace.mock.calls[
      routerReplace.mock.calls.length - 1
    ] as [string];
    expect(calledUrl).not.toMatch(/[?&]from=/);
    expect(calledUrl).not.toMatch(/[?&]to=/);
  });

  it("with ?period=all in the URL, fetches with allTime=true and no from/to", async () => {
    api.fetchMarketplaceAnalyticsKpis.mockResolvedValue(kpisDto());
    mockSearchParams({ period: "all" });

    render(<DashboardPage />);

    await waitFor(() =>
      expect(api.fetchMarketplaceAnalyticsKpis).toHaveBeenCalledWith({
        marketplace: "ALL",
        allTime: true,
      }),
    );
  });

  it("shows KPIs (not the empty-sync fallback) when allTime is true and comparison is null", async () => {
    api.fetchMarketplaceAnalyticsKpis.mockResolvedValue(
      kpisDto({
        scope: { marketplace: "ALL", accountId: null, allTime: true },
        summary: {
          grossRevenue: "100.00",
          orders: 1,
          units: 1,
          averageTicket: "100.00",
          cancelledOrders: 0,
          cancellationRate: 0,
          distinctProducts: 1,
          unitsPerOrder: 1,
          avgUnitPrice: "100.00",
          grossSalesRevenue: "100.00",
          grossSalesOrders: 1,
          grossSalesUnits: 1,
          grossSalesAverageTicket: "100.00",
          grossSalesAvgUnitPrice: "100.00",
          cancelledUnits: 0,
          cancelledRevenue: "0.00",
        },
        comparison: null,
      }),
    );
    mockSearchParams({ period: "all" });

    render(<DashboardPage />);

    expect(
      await screen.findByTestId("kpi-card-gross-revenue"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/nenhuma sincronização concluída/i),
    ).not.toBeInTheDocument();
  });

  it("selecting a preset while allTime is active clears period=all", async () => {
    api.fetchMarketplaceAnalyticsKpis.mockResolvedValue(kpisDto());
    mockSearchParams({ period: "all" });
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(
      await screen.findByRole("button", { name: "Últimos 7 dias" }),
    );

    const [calledUrl] = routerReplace.mock.calls[
      routerReplace.mock.calls.length - 1
    ] as [string];
    expect(calledUrl).not.toMatch(/period=all/);
  });
});
