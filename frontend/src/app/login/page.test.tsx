import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter, useSearchParams } from "next/navigation";
import LoginPage from "./page";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Caminho relativo real (não o alias `@/*`) — mesmo padrão já usado em
// `dashboard/metas/page.test.tsx` para `jest.mock` de `lib/api`.
jest.mock("../../lib/api", () => ({
  apiFetch: jest.fn(),
}));

const api = jest.requireMock("../../lib/api") as { apiFetch: jest.Mock };
const push = jest.fn();

function response(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push });
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
});

describe("LoginPage — health check de cold start", () => {
  it("chama /health com cache desativado (cache: 'no-store')", async () => {
    api.apiFetch.mockResolvedValue(response(200));

    render(<LoginPage />);

    await waitFor(() =>
      expect(api.apiFetch).toHaveBeenCalledWith("/health", {
        method: "GET",
        cache: "no-store",
      }),
    );
  });

  it("informa que o plano gratuito pode levar mais de 1 minuto para acordar", async () => {
    api.apiFetch.mockImplementation(() => new Promise(() => {}));

    render(<LoginPage />);

    expect(
      await screen.findByText(/mais de 1 minuto/i),
    ).toBeInTheDocument();
  });

  it("nunca reenvia e-mail/senha automaticamente — /auth/login só é chamado ao submeter o formulário", async () => {
    api.apiFetch.mockImplementation(async (path: string) => {
      if (path === "/health") return response(200);
      return response(200, { user: { id: "u1" } });
    });

    render(<LoginPage />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Entrar" }),
      ).not.toBeDisabled(),
    );

    expect(api.apiFetch).not.toHaveBeenCalledWith(
      "/auth/login",
      expect.anything(),
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("E-mail"), "ana@example.com");
    await user.type(screen.getByLabelText("Senha"), "segredo123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(
        api.apiFetch.mock.calls.filter((call) => call[0] === "/auth/login"),
      ).toHaveLength(1),
    );
  });
});

describe("LoginPage — mensagem pós-troca de senha", () => {
  it("mostra o aviso quando vem de /alterar-senha (?passwordChanged=1)", async () => {
    api.apiFetch.mockResolvedValue(response(200));
    (useSearchParams as jest.Mock).mockReturnValue(
      new URLSearchParams("passwordChanged=1"),
    );

    render(<LoginPage />);

    expect(
      await screen.findByText("Senha alterada. Entre novamente com a nova senha."),
    ).toBeInTheDocument();
  });

  it("mostra o aviso de sessão expirada quando vem de /alterar-senha (?sessionExpired=1)", async () => {
    api.apiFetch.mockResolvedValue(response(200));
    (useSearchParams as jest.Mock).mockReturnValue(
      new URLSearchParams("sessionExpired=1"),
    );

    render(<LoginPage />);

    expect(
      await screen.findByText("Sua sessão expirou. Entre novamente."),
    ).toBeInTheDocument();
  });

  it("não mostra o aviso em um acesso normal", async () => {
    api.apiFetch.mockResolvedValue(response(200));

    render(<LoginPage />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Entrar" }),
      ).not.toBeDisabled(),
    );
    expect(
      screen.queryByText("Senha alterada. Entre novamente com a nova senha."),
    ).not.toBeInTheDocument();
  });
});
