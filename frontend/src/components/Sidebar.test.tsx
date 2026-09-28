import { render, screen, within } from "@testing-library/react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { PERMISSION_KEYS, type PermissionKey } from "@/types/users";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}));

// `jest.mock` resolve o próprio argumento fora do pipeline de transform do
// Next (que é o que entende o alias `@/*`) — precisa de caminho relativo
// real, ao contrário do `import` acima.
jest.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: jest.fn(),
  hasPermission: jest.requireActual("../hooks/useCurrentUser").hasPermission,
}));

function mockUser(permissions: PermissionKey[]) {
  (useCurrentUser as jest.Mock).mockReturnValue({
    user: {
      id: "u1",
      name: "Fulana",
      email: "fulana@example.com",
      isAdmin: permissions.length === PERMISSION_KEYS.length,
      role: "ADMIN",
      permissions,
      accountScope: { mode: "ALL" },
      mustChangePassword: false,
    },
    isLoading: false,
    status: "ready",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push: jest.fn() });
  // Padrão: usuário com TODAS as permissões (equivalente a ADMIN) — preserva
  // as asserções de itens sempre visíveis já existentes antes do filtro por
  // permissão.
  mockUser([...PERMISSION_KEYS]);
});

function mockPathname(pathname: string) {
  (usePathname as jest.Mock).mockReturnValue(pathname);
}

function mockLoadingUser() {
  (useCurrentUser as jest.Mock).mockReturnValue({
    user: null,
    isLoading: true,
    status: "checking",
  });
}

function mockNoUser() {
  (useCurrentUser as jest.Mock).mockReturnValue({
    user: null,
    isLoading: false,
    status: "reconnecting",
  });
}

describe("Sidebar — navegação lateral", () => {
  it("mostra os grupos na ordem: VISÃO GERAL, ANÁLISES, MARKETPLACES, OPERAÇÃO, ADMINISTRAÇÃO", () => {
    mockPathname("/dashboard");
    render(<Sidebar />);

    const groupTitles = screen.getAllByText(
      /^(VISÃO GERAL|ANÁLISES|MARKETPLACES|OPERAÇÃO|ADMINISTRAÇÃO)$/,
    );
    expect(groupTitles.map((el) => el.textContent)).toEqual([
      "VISÃO GERAL",
      "ANÁLISES",
      "MARKETPLACES",
      "OPERAÇÃO",
      "ADMINISTRAÇÃO",
    ]);
  });

  it("Full aparece em ANÁLISES e aponta para /full", () => {
    mockPathname("/dashboard");
    render(<Sidebar />);

    const link = screen.getByRole("link", { name: "Full" });
    expect(link).toHaveAttribute("href", "/full");
  });

  it("Clientes aparece em ANÁLISES, logo após Full, e fica ativo em /clientes", () => {
    mockPathname("/clientes");
    render(<Sidebar />);

    const link = screen.getByRole("link", { name: "Clientes" });
    expect(link).toHaveAttribute("href", "/clientes");
    expect(link).toHaveAttribute("aria-current", "page");
    const links = screen.getAllByRole("link").map((item) => item.textContent);
    expect(links.indexOf("Clientes")).toBe(links.indexOf("Full") + 1);
  });

  it("marca Full como ativo em /full", () => {
    mockPathname("/full");
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Full" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marca Dashboard como ativo também em subrotas (ex.: /dashboard/metas)", () => {
    mockPathname("/dashboard/metas");
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("mantém os itens existentes de Integrações e Sincronizações", () => {
    mockPathname("/integracoes");
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Integrações" })).toHaveAttribute(
      "href",
      "/integracoes",
    );
    expect(screen.getByRole("link", { name: "Sincronizações" })).toHaveAttribute(
      "href",
      "/sincronizacoes",
    );
  });

  it("continua mostrando o usuário autenticado e o botão de sair", () => {
    mockPathname("/dashboard");
    render(<Sidebar />);

    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    expect(within(nav).getByText("Fulana")).toBeInTheDocument();
    expect(within(nav).getByText("fulana@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("4. ADMIN (todas as permissões) vê todos os itens, incluindo Usuários", () => {
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Usuários" })).toHaveAttribute(
      "href",
      "/usuarios",
    );
    for (const label of [
      "Dashboard",
      "Full",
      "Clientes",
      "Integrações",
      "Sincronizações",
      "Usuários",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("5. VIEWER (permissões restritas) só vê os itens permitidos", () => {
    mockUser(["dashboard.view", "full.view", "integrations.view", "sync.view"]);
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Integrações" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sincronizações" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Clientes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument();
    expect(screen.queryByText("ADMINISTRAÇÃO")).not.toBeInTheDocument();
  });

  it("6. sem users.view, o item Usuários (e o grupo ADMINISTRAÇÃO) não aparece", () => {
    mockUser(["dashboard.view"]);
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument();
    expect(screen.queryByText("ADMINISTRAÇÃO")).not.toBeInTheDocument();
  });

  it("7. sem customers.view, o item Clientes não aparece", () => {
    mockUser(["dashboard.view", "full.view"]);
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Clientes" })).not.toBeInTheDocument();
  });

  it("8. nenhum link protegido aparece durante o carregamento de /auth/me", () => {
    mockLoadingUser();
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Usuários" })).not.toBeInTheDocument();
  });

  it("8b. nenhum link protegido aparece se /auth/me falhar (usuário nulo)", () => {
    mockNoUser();
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("9. active state de /usuarios funciona", () => {
    mockPathname("/usuarios");
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Usuários" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("mostra 'Alterar minha senha' apontando para /alterar-senha quando o usuário está pronto", () => {
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(
      screen.getByRole("link", { name: "Alterar minha senha" }),
    ).toHaveAttribute("href", "/alterar-senha");
  });

  it("não mostra 'Alterar minha senha' durante o carregamento ou sem usuário válido", () => {
    mockLoadingUser();
    mockPathname("/dashboard");
    render(<Sidebar />);

    expect(
      screen.queryByRole("link", { name: "Alterar minha senha" }),
    ).not.toBeInTheDocument();
  });
});
