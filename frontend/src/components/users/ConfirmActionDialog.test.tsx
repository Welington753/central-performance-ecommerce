import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

describe("ConfirmActionDialog", () => {
  it("mostra título, descrição e chama onConfirm/onCancel", async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const user = userEvent.setup();

    render(
      <ConfirmActionDialog
        title="Desativar usuário"
        description="Isso impede o login imediatamente."
        confirmLabel="Desativar"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Desativar usuário")).toBeInTheDocument();
    expect(
      screen.getByText("Isso impede o login imediatamente."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Desativar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("desabilita os botões e nunca permite dupla submissão enquanto isSubmitting", () => {
    render(
      <ConfirmActionDialog
        title="t"
        description="d"
        confirmLabel="Confirmar"
        isSubmitting
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Aguarde..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  });

  it("mostra mensagem de erro específica quando informada", () => {
    render(
      <ConfirmActionDialog
        title="t"
        description="d"
        confirmLabel="Confirmar"
        errorMessage="Não é possível remover o último administrador ativo."
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Não é possível remover o último administrador ativo."),
    ).toBeInTheDocument();
  });
});
