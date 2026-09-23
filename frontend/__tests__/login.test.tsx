import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "@/app/login/page";

const pushMock = jest.fn();
const routerMock = {
  push: pushMock,
  replace: jest.fn(),
};

jest.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

function healthOk(): Promise<Partial<Response>> {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
}

async function renderWithBackendReady() {
  (global.fetch as jest.Mock).mockResolvedValueOnce(await healthOk());
  await act(async () => {
    render(<LoginPage />);
  });
  await waitFor(() =>
    expect(screen.getByLabelText(/e-mail/i)).not.toBeDisabled(),
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    routerMock.replace.mockClear();
    (global.fetch as jest.Mock | undefined) = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renderiza os campos de e-mail e senha", async () => {
    await renderWithBackendReady();

    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /entrar/i }),
    ).toBeInTheDocument();
  });

  it("permite digitar nos campos", async () => {
    await renderWithBackendReady();
    const user = userEvent.setup();

    const emailInput = screen.getByLabelText(/e-mail/i);
    const passwordInput = screen.getByLabelText(/senha/i);

    await user.type(emailInput, "usuario@empresa.com");
    await user.type(passwordInput, "minhasenha123");

    expect(emailInput).toHaveValue("usuario@empresa.com");
    expect(passwordInput).toHaveValue("minhasenha123");
  });

  it("mostra indisponibilidade temporária (nunca 'senha inválida') quando o login falha por rede", async () => {
    await renderWithBackendReady();
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("network down: connection refused at 10.0.0.1:5432"),
    );
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-qualquer");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Serviço temporariamente indisponível. Tente novamente em instantes.",
    );
    expect(screen.queryByText(/e-mail ou senha inválidos/i)).not.toBeInTheDocument();

    // Nunca deve vazar detalhes técnicos do erro real para a tela.
    expect(screen.queryByText(/network down/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.1/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("mostra indisponibilidade temporária quando o login responde 503 (nunca 'senha inválida')", async () => {
    await renderWithBackendReady();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ message: "Service Unavailable" }),
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-qualquer");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Serviço temporariamente indisponível. Tente novamente em instantes.",
    );
  });

  it("exibe 'E-mail ou senha inválidos' somente quando o login responde 401 de verdade", async () => {
    await renderWithBackendReady();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: "Invalid credentials for user xyz" }),
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-errada");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("E-mail ou senha inválidos.");
    expect(screen.queryByText(/Invalid credentials/i)).not.toBeInTheDocument();
  });

  it("redireciona para /dashboard em caso de sucesso", async () => {
    await renderWithBackendReady();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-correta");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("nunca reenvia e-mail/senha automaticamente após uma falha — só quando o usuário clica de novo", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
    (global.fetch as jest.Mock).mockResolvedValueOnce(await healthOk());
    render(<LoginPage />);
    await waitFor(() =>
      expect(screen.getByLabelText(/e-mail/i)).not.toBeDisabled(),
    );

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-qualquer");
    await user.click(screen.getByRole("button", { name: /entrar/i }));
    await screen.findByRole("alert");

    const callsAfterFailure = (global.fetch as jest.Mock).mock.calls.length;
    jest.advanceTimersByTime(60000);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(callsAfterFailure);
  });

  describe("cold start do Render — health check automático", () => {
    it("chama GET /health automaticamente ao abrir a tela, sem URL hardcoded", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(await healthOk());
      render(<LoginPage />);

      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining("/health"),
          expect.objectContaining({ method: "GET" }),
        ),
      );
    });

    it('mostra "Iniciando servidor..." e desabilita o formulário enquanto o backend ainda não respondeu', async () => {
      let resolveHealth!: (value: Partial<Response>) => void;
      (global.fetch as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveHealth = resolve;
        }),
      );
      render(<LoginPage />);

      expect(
        screen.getByText(/iniciando servidor/i),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/e-mail/i)).toBeDisabled();
      expect(screen.getByRole("button", { name: /entrar/i })).toBeDisabled();

      await act(async () => {
        resolveHealth({ ok: true, status: 200, json: async () => ({}) });
      });

      await waitFor(() =>
        expect(screen.getByLabelText(/e-mail/i)).not.toBeDisabled(),
      );
      expect(screen.queryByText(/iniciando servidor/i)).not.toBeInTheDocument();
    });

    it("acorda o backend: tenta de novo automaticamente após 502/503/504 e libera o formulário quando o health responde", async () => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

      render(<LoginPage />);
      expect(screen.getByLabelText(/e-mail/i)).toBeDisabled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });

      await waitFor(() =>
        expect(screen.getByLabelText(/e-mail/i)).not.toBeDisabled(),
      );
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("acorda o backend: tenta de novo automaticamente após falha de rede", async () => {
      jest.useFakeTimers({ doNotFake: ["queueMicrotask"] });
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error("connection refused"))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

      render(<LoginPage />);
      expect(screen.getByLabelText(/e-mail/i)).toBeDisabled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });

      await waitFor(() =>
        expect(screen.getByLabelText(/e-mail/i)).not.toBeDisabled(),
      );
    });
  });
});
