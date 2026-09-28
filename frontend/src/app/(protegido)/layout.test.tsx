import { render, screen } from "@testing-library/react";
import ProtectedLayout from "./layout";

jest.mock("../../hooks/useAuthGuard", () => ({
  useAuthGuard: jest.fn(),
}));

// `CurrentUserProvider` vira um passthrough — o gate real (`useCurrentUser`)
// é controlado diretamente pelo mock abaixo, sem tocar rede.
jest.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: jest.fn(),
  hasPermission: jest.requireActual("../../hooks/useCurrentUser").hasPermission,
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

const { useAuthGuard } = jest.requireMock("../../hooks/useAuthGuard") as {
  useAuthGuard: jest.Mock;
};
const { useCurrentUser } = jest.requireMock("../../hooks/useCurrentUser") as {
  useCurrentUser: jest.Mock;
};
const { useRouter, usePathname } = jest.requireMock("next/navigation") as {
  useRouter: jest.Mock;
  usePathname: jest.Mock;
};

const replace = jest.fn();

function mockCurrentUser(value: {
  user: { mustChangePassword: boolean } | null;
  status:
    | "checking"
    | "ready"
    | "reconnecting"
    | "unauthenticated"
    | "forbidden"
    | "fatal_error";
  refresh?: jest.Mock;
}) {
  useCurrentUser.mockReturnValue({
    ...value,
    user: value.user ? { permissions: [], ...value.user } : null,
    refresh: value.refresh ?? jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useRouter.mockReturnValue({ replace, push: jest.fn() });
  usePathname.mockReturnValue("/dashboard");
  // Padrão seguro para os testes que só exercitam o status de useAuthGuard.
  mockCurrentUser({ user: null, status: "checking" });
});

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

  describe("autenticado — gate de troca obrigatória de senha (fail-closed)", () => {
    beforeEach(() => {
      useAuthGuard.mockReturnValue("authenticated");
    });

    it("mustChangePassword=true redireciona para /alterar-senha sem mostrar o conteúdo protegido", () => {
      mockCurrentUser({
        user: { mustChangePassword: true },
        status: "ready",
      });

      render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
      expect(replace).toHaveBeenCalledWith("/alterar-senha");
    });

    it("mustChangePassword=false com usuário válido renderiza o conteúdo protegido", () => {
      mockCurrentUser({
        user: { mustChangePassword: false },
        status: "ready",
      });

      render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.getByText("conteúdo protegido")).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it("enquanto o usuário ainda carrega, nunca mostra o conteúdo protegido", () => {
      mockCurrentUser({ user: null, status: "checking" });

      render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
      expect(screen.getByText("Verificando sessão...")).toBeInTheDocument();
    });

    it("falha de /auth/me (reconectando) nunca renderiza o conteúdo protegido — mostra reconectando", () => {
      mockCurrentUser({ user: null, status: "reconnecting" });

      render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
      expect(
        screen.getByText("Reconectando ao servidor..."),
      ).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it("401 na leitura do usuário nunca renderiza o conteúdo protegido — redireciona ao login", () => {
      mockCurrentUser({ user: null, status: "unauthenticated" });

      const { container } = render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
      expect(container.querySelector("p")).toBeNull();
      expect(replace).toHaveBeenCalledWith("/login");
    });

    it("403 na leitura do usuário nunca renderiza o conteúdo protegido nem faz logout", () => {
      mockCurrentUser({ user: null, status: "forbidden" });

      render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
      expect(screen.getByText(/não tem permissão/i)).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    });

    it("resposta inválida (fatal_error) mostra erro seguro com botão 'Tentar novamente', sem redirecionar", () => {
      const refresh = jest.fn();
      mockCurrentUser({ user: null, status: "fatal_error", refresh });

      render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
      const button = screen.getByRole("button", { name: "Tentar novamente" });
      button.click();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("estado desconhecido/malformado nunca renderiza o conteúdo protegido (fail-closed)", () => {
      // Simula um valor de status que não existe hoje — o gate só libera no
      // caminho explícito "ready + user + mustChangePassword===false".
      mockCurrentUser({
        user: null,
        // @ts-expect-error -- valor deliberadamente fora do enum conhecido
        status: "algo-desconhecido",
      });

      render(
        <ProtectedLayout>
          <p>conteúdo protegido</p>
        </ProtectedLayout>,
      );

      expect(screen.queryByText("conteúdo protegido")).not.toBeInTheDocument();
    });
  });
});
