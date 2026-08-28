import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/AppShell";

const pushMock = jest.fn();
const routerMock = { push: pushMock, replace: jest.fn() };
let currentPathname = "/dashboard";

jest.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => currentPathname,
}));

// O jsdom não implementa navegação real: um clique em <a href> emitiria
// "Not implemented: navigation". Este mock preserva o que está sob teste (o
// href repassado e o onClick que fecha a gaveta) e apenas impede a navegação.
jest.mock("next/link", () => {
  const MockLink = ({
    href,
    children,
    onClick,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </a>
  );
  MockLink.displayName = "MockLink";
  return { __esModule: true, default: MockLink };
});

function mockCurrentUser(user: { name: string; email: string } | null) {
  (global.fetch as jest.Mock | undefined) = jest.fn(
    async (url: string, options?: RequestInit) => {
      if (String(url).endsWith("/auth/me")) {
        if (user === null) {
          return { ok: false, status: 401, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => user };
      }
      if (String(url).endsWith("/auth/logout") && options?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      throw new Error(`chamada inesperada: ${String(url)}`);
    },
  );
}

/**
 * Renderiza o shell e aguarda o carregamento do usuário terminar, para que
 * nenhuma atualização de estado ocorra fora de `act()` depois do teste.
 */
async function renderShell(children: React.ReactNode = "conteúdo") {
  const result = render(<AppShell>{children}</AppShell>);
  await waitFor(() =>
    expect(screen.queryByText("Carregando usuário...")).not.toBeInTheDocument(),
  );
  return result;
}

describe("AppShell — barra lateral", () => {
  beforeEach(() => {
    pushMock.mockClear();
    currentPathname = "/dashboard";
    document.body.style.overflow = "";
    mockCurrentUser({ name: "Ana Souza", email: "ana@exemplo.com" });
  });

  it("exibe a marca 'Central de Performance' e o ícone CP no topo", async () => {
    await renderShell();

    const nav = screen.getByRole("navigation", { name: "Navegação principal" });
    expect(within(nav).getByText("Central de Performance")).toBeInTheDocument();
    expect(within(nav).getByText("CP")).toBeInTheDocument();
  });

  it("renderiza exatamente os três links das rotas existentes, agrupados", async () => {
    await renderShell();

    const nav = screen.getByRole("navigation", { name: "Navegação principal" });

    expect(within(nav).getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(
      within(nav).getByRole("link", { name: "Integrações" }),
    ).toHaveAttribute("href", "/integracoes");
    expect(
      within(nav).getByRole("link", { name: "Sincronizações" }),
    ).toHaveAttribute("href", "/sincronizacoes");

    expect(within(nav).getAllByRole("link")).toHaveLength(3);

    expect(within(nav).getByText("VISÃO GERAL")).toBeInTheDocument();
    expect(within(nav).getByText("MARKETPLACES")).toBeInTheDocument();
    expect(within(nav).getByText("OPERAÇÃO")).toBeInTheDocument();
  });

  it("marca apenas a rota ativa com aria-current='page'", async () => {
    currentPathname = "/integracoes";
    await renderShell();

    expect(screen.getByRole("link", { name: "Integrações" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(
      screen.getByRole("link", { name: "Sincronizações" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("não exibe nenhum nome ou e-mail enquanto os dados do usuário carregam", () => {
    (global.fetch as jest.Mock | undefined) = jest.fn(
      () => new Promise(() => {}),
    );

    render(<AppShell>conteúdo</AppShell>);

    expect(screen.queryByText("Ana Souza")).not.toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.getByText("Carregando usuário...")).toBeInTheDocument();
  });

  it("exibe nome e e-mail reais do usuário autenticado quando disponíveis", async () => {
    await renderShell();

    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(screen.getByText("ana@exemplo.com")).toBeInTheDocument();
  });

  it("não inventa nome nem e-mail quando /auth/me falha", async () => {
    mockCurrentUser(null);

    await renderShell();

    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.getByText("Usuário não identificado")).toBeInTheDocument();
  });

  it("faz logout pelo fluxo existente e redireciona para /login", async () => {
    const user = userEvent.setup();
    await renderShell();

    await user.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renderiza o conteúdo da página dentro do main", async () => {
    await renderShell(<h1>Conteúdo do Dashboard</h1>);

    expect(
      within(screen.getByRole("main")).getByText("Conteúdo do Dashboard"),
    ).toBeInTheDocument();
  });

  describe("gaveta lateral no mobile", () => {
    it("começa fechada, com o botão de menu recolhido", async () => {
      await renderShell();

      expect(screen.getByRole("button", { name: "Abrir menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(document.body.style.overflow).not.toBe("hidden");
    });

    it("abre ao clicar no botão de menu e bloqueia a rolagem do conteúdo", async () => {
      const user = userEvent.setup();
      await renderShell();

      await user.click(screen.getByRole("button", { name: "Abrir menu" }));

      expect(screen.getByRole("button", { name: "Fechar menu" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(document.body.style.overflow).toBe("hidden");
    });

    it("fecha ao pressionar Escape e libera a rolagem", async () => {
      const user = userEvent.setup();
      await renderShell();

      await user.click(screen.getByRole("button", { name: "Abrir menu" }));
      await user.keyboard("{Escape}");

      expect(screen.getByRole("button", { name: "Abrir menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(document.body.style.overflow).not.toBe("hidden");
    });

    it("fecha ao clicar fora, na sobreposição", async () => {
      const user = userEvent.setup();
      await renderShell();

      await user.click(screen.getByRole("button", { name: "Abrir menu" }));
      await user.click(screen.getByTestId("sidebar-overlay"));

      expect(screen.getByRole("button", { name: "Abrir menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });

    it("fecha ao escolher uma página", async () => {
      const user = userEvent.setup();
      await renderShell();

      await user.click(screen.getByRole("button", { name: "Abrir menu" }));
      await user.click(screen.getByRole("link", { name: "Integrações" }));

      expect(screen.getByRole("button", { name: "Abrir menu" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });
});
