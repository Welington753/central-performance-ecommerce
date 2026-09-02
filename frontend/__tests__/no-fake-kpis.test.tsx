// `DashboardPage` busca o agregado multi-marketplace real no mount desde o
// Checkpoint 3 — precisa do mesmo automock de `lib/api` usado em
// dashboard.test.tsx (spyOn falha com "Cannot redefine property" nos
// exports ESM compilados pelo SWC).
jest.mock("../src/lib/api");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

import { render, screen, waitFor, within } from "@testing-library/react";
import DashboardPage from "@/app/(protegido)/dashboard/page";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";
import * as api from "@/lib/api";
import type { MarketplaceAnalyticsKpisDto } from "@/types/marketplace-analytics";

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
    topProductsBySku: [],
    topListings: [],
    breakdownByMarketplace: [
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
    ],
    breakdownByAccount: [
      {
        accountId: "acc-1",
        marketplace: "MERCADO_LIVRE",
        nickname: "EZIEHOME",
        externalSellerId: "1548451374",
        status: "CONNECTED",
        availability: "AVAILABLE",
        summary: { grossRevenue: "1234.56", paidOrders: 10, units: 25 },
        lastSync: "2026-09-01T15:00:00.000Z",
      },
    ],
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

/**
 * Regra crítica do produto: nenhuma tela pode exibir números, gráficos, KPIs
 * ou resultados fictícios/simulados como se fossem reais — nem como
 * placeholder de carregamento, nem quando o backend está indisponível, nem
 * para um marketplace não conectado, nem antes da primeira sincronização.
 * Desde o Checkpoint 3, /dashboard exibe o agregado multi-marketplace REAL
 * vindo de `fetchMarketplaceAnalyticsKpis` quando a busca tem sucesso
 * (coberto em dashboard.test.tsx); este teste garante que nenhum valor
 * inventado aparece nos demais casos.
 */
describe("Ausência de KPIs fictícios", () => {
  it("/dashboard não renderiza nenhum valor monetário ou percentual enquanto carrega ou se o backend estiver indisponível", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockRejectedValue(
      new Error("backend indisponível"),
    );

    render(<DashboardPage />);

    expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByText(/não foi possível carregar os dados de marketplaces/i),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();
  });

  it("/dashboard nunca mostra R$ 0,00, '0 pedidos' ou qualquer número para um marketplace não conectado", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());

    render(<DashboardPage />);

    const amazon = await screen.findByTestId("marketplace-panel-AMAZON");
    expect(within(amazon).getByText(/não conectado/i)).toBeInTheDocument();
    expect(amazon.textContent).not.toMatch(/R\$/);
    expect(amazon.textContent).not.toMatch(/\d/);

    const shopee = screen.getByTestId("marketplace-panel-SHOPEE");
    expect(shopee.textContent).not.toMatch(/R\$/);
    expect(shopee.textContent).not.toMatch(/\d/);
  });

  it("/dashboard nunca inventa uma série diária ou um resumo antes da primeira sincronização (CONNECTED_NO_DATA)", async () => {
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
      }),
    );

    render(<DashboardPage />);

    await screen.findByText(/ainda não tem nenhuma sincronização concluída/i);
    expect(screen.queryByTestId("kpi-card-gross-revenue")).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
  });

  it("/dashboard nunca calcula ou exibe margem, lucro ou resultado líquido em lugar nenhum", async () => {
    (api.fetchMarketplaceAnalyticsKpis as jest.Mock).mockResolvedValue(analyticsDto());

    render(<DashboardPage />);
    await screen.findByTestId("kpi-card-gross-revenue");

    for (const forbidden of [/margem/i, /lucro/i, /resultado líquido/i]) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument();
    }
  });

  it("/sincronizacoes não renderiza nenhum valor monetário, percentual ou linha de exemplo quando não há dados", async () => {
    (global.fetch as jest.Mock | undefined) = jest.fn().mockRejectedValueOnce(
      new Error("backend indisponível"),
    );

    render(<SincronizacoesPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma sincronização registrada ainda."),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();
    expect(screen.queryByRole("row")).not.toBeInTheDocument();
  });
});
