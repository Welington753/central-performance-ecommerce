// `DashboardPage` busca contas reais no mount desde a Fase 3 — precisa do
// mesmo automock de `lib/api` usado em dashboard.test.tsx (spyOn falha com
// "Cannot redefine property" nos exports ESM compilados pelo SWC).
jest.mock("../src/lib/api");

import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "@/app/(protegido)/dashboard/page";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";
import * as api from "@/lib/api";

/**
 * Regra crítica do produto: nenhuma tela pode exibir números, gráficos, KPIs
 * ou resultados fictícios/simulados como se fossem reais — nem como
 * placeholder de carregamento, nem quando o backend está indisponível. Desde
 * a Fase 3, /dashboard exibe KPIs REAIS vindos da API quando a busca tem
 * sucesso (coberto em dashboard.test.tsx); este teste garante que nenhum
 * valor aparece antes disso ou quando a busca falha.
 */
describe("Ausência de KPIs fictícios", () => {
  it("/dashboard não renderiza nenhum valor monetário ou percentual enquanto carrega ou se o backend estiver indisponível", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockRejectedValue(
      new Error("backend indisponível"),
    );

    render(<DashboardPage />);

    expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByText(/não foi possível carregar suas contas/i),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText(/R\$\s?\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+([.,]\d+)?\s?%/)).not.toBeInTheDocument();
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
