import { render, screen, waitFor } from "@testing-library/react";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";

describe("SincronizacoesPage", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock | undefined) = jest.fn();
  });

  it("mostra estado vazio quando o backend está indisponível (falha de rede)", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("fetch failed: ECONNREFUSED"),
    );

    render(<SincronizacoesPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma sincronização registrada ainda."),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("mostra estado vazio quando o backend responde com erro HTTP", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: "Internal error" }),
    });

    render(<SincronizacoesPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma sincronização registrada ainda."),
      ).toBeInTheDocument(),
    );
  });

  it("mostra estado vazio quando o backend responde uma lista vazia", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    render(<SincronizacoesPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma sincronização registrada ainda."),
      ).toBeInTheDocument(),
    );
  });

  it("não quebra a página e não inventa linhas de exemplo quando o fetch falha", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    render(<SincronizacoesPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma sincronização registrada ainda."),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByRole("row")).not.toBeInTheDocument();
  });
});
