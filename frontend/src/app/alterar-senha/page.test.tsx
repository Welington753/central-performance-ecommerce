import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import AlterarSenhaPage from "./page";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { changeOwnPassword } from "@/lib/users-api";
import { ApiFetchError } from "@/lib/api";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("../../hooks/useAuthGuard", () => ({
  useAuthGuard: jest.fn(),
}));

jest.mock("../../lib/users-api", () => ({
  changeOwnPassword: jest.fn(),
}));

const mockUseAuthGuard = useAuthGuard as jest.Mock;
const mockChangeOwnPassword = changeOwnPassword as jest.Mock;
const push = jest.fn();

const VALID_NEW_PASSWORD = "novaSenhaForte123";

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  { current = "atualSenha123", next = VALID_NEW_PASSWORD, confirm = VALID_NEW_PASSWORD } = {},
) {
  await user.type(screen.getByLabelText("Senha atual"), current);
  await user.type(screen.getByLabelText("Nova senha"), next);
  await user.type(screen.getByLabelText("Confirmar nova senha"), confirm);
  await user.click(screen.getByRole("button", { name: "Alterar senha" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push });
  mockUseAuthGuard.mockReturnValue("authenticated");
});

describe("AlterarSenhaPage — estados de sessão", () => {
  it("checking mostra 'Verificando sessão...' sem mostrar o formulário", () => {
    mockUseAuthGuard.mockReturnValue("checking");
    render(<AlterarSenhaPage />);
    expect(screen.getByText("Verificando sessão...")).toBeInTheDocument();
    expect(screen.queryByLabelText("Senha atual")).not.toBeInTheDocument();
  });

  it("36. cold start (reconnecting) nunca é tratado como logout — mostra 'Reconectando ao servidor...'", () => {
    mockUseAuthGuard.mockReturnValue("reconnecting");
    render(<AlterarSenhaPage />);
    expect(screen.getByText("Reconectando ao servidor...")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("unauthenticated não mostra o formulário (redirect já disparado pelo hook)", () => {
    mockUseAuthGuard.mockReturnValue("unauthenticated");
    const { container } = render(<AlterarSenhaPage />);
    expect(container.querySelector("form")).toBeNull();
  });
});

describe("AlterarSenhaPage — validação e envio", () => {
  it("usa autocomplete correto para senha atual e nova senha", () => {
    render(<AlterarSenhaPage />);
    expect(screen.getByLabelText("Senha atual")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("Nova senha")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("30. senha atual incorreta mostra a mensagem do backend", async () => {
    mockChangeOwnPassword.mockRejectedValue(
      new ApiFetchError("Senha atual incorreta.", "CURRENT_PASSWORD_INVALID"),
    );
    const user = userEvent.setup();
    render(<AlterarSenhaPage />);

    await fillAndSubmit(user);

    expect(await screen.findByText("Senha atual incorreta.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("31. nova senha igual à atual é bloqueada sem chamar a API", async () => {
    const user = userEvent.setup();
    render(<AlterarSenhaPage />);

    await fillAndSubmit(user, {
      current: VALID_NEW_PASSWORD,
      next: VALID_NEW_PASSWORD,
      confirm: VALID_NEW_PASSWORD,
    });

    expect(
      await screen.findByText("A nova senha deve ser diferente da atual."),
    ).toBeInTheDocument();
    expect(mockChangeOwnPassword).not.toHaveBeenCalled();
  });

  it("32. confirmação diferente da nova senha é bloqueada sem chamar a API", async () => {
    const user = userEvent.setup();
    render(<AlterarSenhaPage />);

    await fillAndSubmit(user, { confirm: "outraSenhaqualquer123" });

    expect(
      await screen.findByText("A confirmação não confere com a nova senha."),
    ).toBeInTheDocument();
    expect(mockChangeOwnPassword).not.toHaveBeenCalled();
  });

  it("nova senha fora da política é bloqueada sem chamar a API", async () => {
    const user = userEvent.setup();
    render(<AlterarSenhaPage />);

    await fillAndSubmit(user, { next: "curta1", confirm: "curta1" });

    expect(
      await screen.findByText(/pelo menos 12 caracteres/i),
    ).toBeInTheDocument();
    expect(mockChangeOwnPassword).not.toHaveBeenCalled();
  });

  it("33/34. sucesso limpa os campos e redireciona para /login com a mensagem", async () => {
    mockChangeOwnPassword.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<AlterarSenhaPage />);

    await fillAndSubmit(user);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?passwordChanged=1"));
    expect(mockChangeOwnPassword).toHaveBeenCalledWith(
      "atualSenha123",
      VALID_NEW_PASSWORD,
    );
    expect(screen.getByLabelText("Senha atual")).toHaveValue("");
    expect(screen.getByLabelText("Nova senha")).toHaveValue("");
    expect(screen.getByLabelText("Confirmar nova senha")).toHaveValue("");
  });

  it("21/16/17. sessão expirada (SESSION_EXPIRED) limpa os campos e redireciona para /login com aviso, sem retry", async () => {
    mockChangeOwnPassword.mockRejectedValue(
      new ApiFetchError("Sua sessão expirou. Entre novamente.", "SESSION_EXPIRED"),
    );
    const user = userEvent.setup();
    render(<AlterarSenhaPage />);

    await fillAndSubmit(user);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/login?sessionExpired=1"),
    );
    expect(mockChangeOwnPassword).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Senha atual")).toHaveValue("");
    expect(screen.getByLabelText("Nova senha")).toHaveValue("");
    expect(screen.getByLabelText("Confirmar nova senha")).toHaveValue("");
  });

  it("desabilita o botão durante o envio — nunca permite submissão dupla", async () => {
    let resolveChange: (value: unknown) => void = () => {};
    mockChangeOwnPassword.mockReturnValue(
      new Promise((resolve) => {
        resolveChange = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<AlterarSenhaPage />);

    await fillAndSubmit(user);

    expect(screen.getByRole("button", { name: "Alterando..." })).toBeDisabled();

    resolveChange({ success: true });
    await waitFor(() => expect(mockChangeOwnPassword).toHaveBeenCalledTimes(1));
  });
});
