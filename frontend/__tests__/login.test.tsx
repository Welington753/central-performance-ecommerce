import { render, screen, waitFor } from "@testing-library/react";
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

describe("LoginPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    (global.fetch as jest.Mock | undefined) = jest.fn();
  });

  it("renderiza os campos de e-mail e senha", () => {
    render(<LoginPage />);

    expect(screen.getByLabelText(/e-mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /entrar/i }),
    ).toBeInTheDocument();
  });

  it("permite digitar nos campos", async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const emailInput = screen.getByLabelText(/e-mail/i);
    const passwordInput = screen.getByLabelText(/senha/i);

    await user.type(emailInput, "usuario@empresa.com");
    await user.type(passwordInput, "minhasenha123");

    expect(emailInput).toHaveValue("usuario@empresa.com");
    expect(passwordInput).toHaveValue("minhasenha123");
  });

  it("exibe mensagem de erro genérica quando a requisição falha por rede", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("network down: connection refused at 10.0.0.1:5432"),
    );
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-errada");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("E-mail ou senha inválidos.");

    // Nunca deve vazar detalhes técnicos do erro real para a tela.
    expect(screen.queryByText(/network down/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/10\.0\.0\.1/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("exibe mensagem de erro genérica quando o backend responde com falha (401)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: "Invalid credentials for user xyz" }),
    });
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-errada");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("E-mail ou senha inválidos.");
    expect(screen.queryByText(/Invalid credentials/i)).not.toBeInTheDocument();
  });

  it("redireciona para /dashboard em caso de sucesso", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/e-mail/i), "usuario@empresa.com");
    await user.type(screen.getByLabelText(/senha/i), "senha-correta");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });
});
