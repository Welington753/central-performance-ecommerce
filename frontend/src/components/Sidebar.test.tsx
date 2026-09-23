import { render, screen, within } from "@testing-library/react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { useCurrentUser } from "@/hooks/useCurrentUser";

jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
  useRouter: jest.fn(),
}));

// `jest.mock` resolve o próprio argumento fora do pipeline de transform do
// Next (que é o que entende o alias `@/*`) — precisa de caminho relativo
// real, ao contrário do `import` acima.
jest.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push: jest.fn() });
  (useCurrentUser as jest.Mock).mockReturnValue({ user: null, isLoading: false });
});

function mockPathname(pathname: string) {
  (usePathname as jest.Mock).mockReturnValue(pathname);
}

describe("Sidebar — navegação lateral", () => {
  it("mostra os grupos na ordem: VISÃO GERAL, ANÁLISES, MARKETPLACES, OPERAÇÃO", () => {
    mockPathname("/dashboard");
    render(<Sidebar />);

    const groupTitles = screen.getAllByText(
      /^(VISÃO GERAL|ANÁLISES|MARKETPLACES|OPERAÇÃO)$/,
    );
    expect(groupTitles.map((el) => el.textContent)).toEqual([
      "VISÃO GERAL",
      "ANÁLISES",
      "MARKETPLACES",
      "OPERAÇÃO",
    ]);
  });

  it("Full aparece em ANÁLISES e aponta para /full", () => {
    mockPathname("/dashboard");
    render(<Sidebar />);

    const link = screen.getByRole("link", { name: "Full" });
    expect(link).toHaveAttribute("href", "/full");
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
    (useCurrentUser as jest.Mock).mockReturnValue({
      user: { name: "Fulana", email: "fulana@example.com" },
      isLoading: false,
    });
    mockPathname("/dashboard");
    render(<Sidebar />);

    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    expect(within(nav).getByText("Fulana")).toBeInTheDocument();
    expect(within(nav).getByText("fulana@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
