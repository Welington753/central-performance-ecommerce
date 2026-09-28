import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemporaryPasswordModal } from "./TemporaryPasswordModal";

/** Reproduz o uso real: o pai guarda a senha no estado e a limpa ao fechar. */
function Wrapper() {
  const [reveal, setReveal] = useState<{ userName: string; password: string } | null>({
    userName: "Ana",
    password: "senha-temp-123",
  });

  return (
    <div>
      {reveal ? (
        <TemporaryPasswordModal
          userName={reveal.userName}
          password={reveal.password}
          onClose={() => setReveal(null)}
        />
      ) : (
        <p>modal fechado</p>
      )}
    </div>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("TemporaryPasswordModal", () => {
  it("mostra a senha e o aviso de exibição única", () => {
    render(
      <TemporaryPasswordModal
        userName="Ana"
        password="senha-temp-123"
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByDisplayValue("senha-temp-123")).toBeInTheDocument();
    expect(screen.getByText(/somente uma vez/i)).toBeInTheDocument();
  });

  it("copia a senha via Clipboard API quando disponível", async () => {
    // `userEvent.setup()` instala seu próprio stub em `navigator.clipboard`
    // — por isso o mock precisa ser definido DEPOIS do setup, senão é
    // sobrescrito.
    const userEventInstance = userEvent.setup();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(
      <TemporaryPasswordModal
        userName="Ana"
        password="senha-temp-123"
        onClose={jest.fn()}
      />,
    );

    await userEventInstance.click(screen.getByRole("button", { name: "Copiar" }));

    expect(writeText).toHaveBeenCalledWith("senha-temp-123");
    expect(await screen.findByText("Copiado!")).toBeInTheDocument();
  });

  it("mostra fallback selecionável quando a Clipboard API falha", async () => {
    const userEventInstance = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockRejectedValue(new Error("negado")) },
      configurable: true,
    });

    render(
      <TemporaryPasswordModal
        userName="Ana"
        password="senha-temp-123"
        onClose={jest.fn()}
      />,
    );

    await userEventInstance.click(screen.getByRole("button", { name: "Copiar" }));

    expect(
      await screen.findByText(/Não foi possível copiar automaticamente/i),
    ).toBeInTheDocument();
  });

  it("remove a senha do DOM e do estado observável ao fechar", async () => {
    const user = userEvent.setup();
    render(<Wrapper />);

    expect(screen.getByDisplayValue("senha-temp-123")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fechar" }));

    expect(screen.queryByDisplayValue("senha-temp-123")).not.toBeInTheDocument();
    expect(screen.queryByText("senha-temp-123")).not.toBeInTheDocument();
    expect(screen.getByText("modal fechado")).toBeInTheDocument();
  });
});
