import { render, screen, waitFor } from "@testing-library/react";
import DashboardPage from "@/app/(protegido)/dashboard/page";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";

/**
 * Regra crítica do produto: nesta fase (Fase 1 — Fundação), nenhuma tela pode
 * exibir números, gráficos, KPIs ou resultados fictícios/simulados como se
 * fossem reais. Estes testes garantem que /dashboard e /sincronizacoes nunca
 * renderizam valores monetários ou percentuais de exemplo.
 */
describe("Ausência de KPIs fictícios", () => {
  it("/dashboard não renderiza nenhum valor monetário ou percentual", () => {
    render(<DashboardPage />);

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
