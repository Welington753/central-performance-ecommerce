import { render, screen } from "@testing-library/react";
import ProtectedLayout from "./layout";

jest.mock("../../hooks/useAuthGuard", () => ({
  useAuthGuard: jest.fn(),
}));

const { useAuthGuard } = jest.requireMock("../../hooks/useAuthGuard") as {
  useAuthGuard: jest.Mock;
};

describe("ProtectedLayout", () => {
  it("mostra 'Verificando sessão...' enquanto checking, sem renderizar filhos", () => {
    useAuthGuard.mockReturnValue("checking");

    render(
      <ProtectedLayout>
        <p>conteúdo protegido</p>
      </ProtectedLayout>,
    );

    expect(screen.getByText("Verificando sessão...")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("403 mostra estado de acesso negado, nunca o conteúdo protegido nem a tela de login", () => {
    useAuthGuard.mockReturnValue("forbidden");

    render(
      <ProtectedLayout>
        <p>conteúdo protegido</p>
      </ProtectedLayout>,
    );

    expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("falha temporária (cold start/rede) mostra 'Reconectando ao servidor...', preserva a sessão", () => {
    useAuthGuard.mockReturnValue("reconnecting");

    render(
      <ProtectedLayout>
        <p>conteúdo protegido</p>
      </ProtectedLayout>,
    );

    expect(
      screen.getByText("Reconectando ao servidor..."),
    ).toBeInTheDocument();
    expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
  });

  it("unauthenticated não renderiza nada (redirect já disparado pelo hook)", () => {
    useAuthGuard.mockReturnValue("unauthenticated");

    const { container } = render(
      <ProtectedLayout>
        <p>conteúdo protegido</p>
      </ProtectedLayout>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
