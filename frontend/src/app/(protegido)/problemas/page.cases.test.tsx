import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProblemasPage from "./page";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { LIST, callsTo, installApi, paramsOf, uuidPattern, type SetupOptions } from "./problems-test-utils";

jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return { ...actual, apiFetch: jest.fn(), fetchMarketplaceAccounts: jest.fn() };
});
jest.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: jest.fn(),
  hasPermission: jest.requireActual("../../../hooks/useCurrentUser").hasPermission,
}));

const api = jest.requireMock("../../../lib/api") as { apiFetch: jest.Mock; fetchMarketplaceAccounts: jest.Mock };

const setup = (options: SetupOptions = {}) =>
  installApi({ ...api, useCurrentUser: useCurrentUser as jest.Mock }, options);

function mockViewport(narrow: boolean) {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: narrow,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

async function openCases() {
  const user = userEvent.setup();
  render(<ProblemasPage />);
  await user.click(await screen.findByRole("tab", { name: "Casos" }));
  return user;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockViewport(false);
});
afterEach(() => {
  // @ts-expect-error — restaura o ambiente sem matchMedia (jsdom).
  delete window.matchMedia;
});

describe("/problemas — Casos", () => {
  it("tabela com as 8 colunas, motivos em PT-BR, chips e data em America/Sao_Paulo; sem códigos técnicos", async () => {
    setup();
    await openCases();
    const table = await screen.findByRole("table");
    for (const header of ["Data", "Conta", "Pedido", "Motivo", "Status", "Impacto", "Responsabilidade"]) {
      expect(within(table).getByRole("columnheader", { name: new RegExp(`^${header}`) })).toBeInTheDocument();
    }
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("Arrependimento do comprador")).toBeInTheDocument();
    expect(within(rows[1]).getByText("ORD-A1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Aberto")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Afeta a reputação")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Não classificada")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Motivo não informado")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Vendedor")).toBeInTheDocument();
    // 01/06/2026 02:30 UTC = 31/05/2026 23:30 em São Paulo.
    expect(within(rows[2]).getByText("31/05/2026")).toBeInTheDocument();
    expect(table.textContent).not.toContain("repentant_buyer");
    expect(table.textContent).not.toMatch(uuidPattern);
    // Informações secundárias saem da tabela (vão para o painel de detalhes).
    expect(within(table).queryByText("Enviar comprovante")).not.toBeInTheDocument();
    expect(within(table).queryByText("5001234567")).not.toBeInTheDocument();
  });

  it("o rótulo PT-BR vem do próprio caso: não depende da análise mensal", async () => {
    setup({ monthly: new Error("fora do ar") });
    await openCases();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Arrependimento do comprador")).toBeInTheDocument();
    expect(table.textContent).not.toContain("repentant_buyer");
  });

  it("layout responsivo: telas estreitas viram cards (sem tabela)", async () => {
    mockViewport(true);
    setup();
    await openCases();
    await screen.findByRole("region", { name: "Lista de problemas" });
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Arrependimento do comprador");
    expect(items[0]).toHaveTextContent("Pedido ORD-A1");
    expect(items[0]).toHaveTextContent("Afeta a reputação");
  });

  it("detalhes preservam a paginação: abrir e fechar mantém a página 2", async () => {
    const calls = setup();
    const user = await openCases();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(paramsOf(callsTo(calls, "/problems").at(-1)!).get("page")).toBe("2"));

    await user.click(screen.getAllByRole("button", { name: /Ver detalhes/ })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Detalhes do problema" });
    expect(await within(dialog).findByText("5001234567")).toBeInTheDocument();
    // Detalhe mostra o motivo em PT-BR e o código só como apoio; tipo e ação ficam aqui.
    expect(within(dialog).getByText("Arrependimento do comprador")).toBeInTheDocument();
    expect(within(dialog).getByText(/Enviar comprovante \(obrigatória\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Mediação/)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(uuidPattern);
    await user.click(within(dialog).getByRole("button", { name: "Fechar" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(paramsOf(callsTo(calls, "/problems").at(-1)!).get("page")).toBe("2");
  });

  it("clicar na linha abre o detalhe; o botão não dispara duas aberturas", async () => {
    setup();
    const user = await openCases();
    const table = await screen.findByRole("table");
    await user.click(within(table).getByText("ORD-A1"));
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("ordenação, busca por pedido e filtros avançados recolhíveis", async () => {
    const calls = setup();
    const user = await openCases();
    await screen.findByRole("table");
    expect(screen.queryByLabelText("Impacto na reputação")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Data/ }));
    await waitFor(() => expect(paramsOf(callsTo(calls, "/problems").at(-1)!).get("sortDir")).toBe("asc"));

    await user.type(screen.getByLabelText("Pedido"), " ORD-A1 ");
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(paramsOf(callsTo(calls, "/problems").at(-1)!).get("orderId")).toBe("ORD-A1"));

    await user.click(screen.getByRole("button", { name: "Filtros avançados" }));
    await user.selectOptions(screen.getByLabelText("Impacto na reputação"), "affected");
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));
    await waitFor(() => {
      const params = paramsOf(callsTo(calls, "/problems").at(-1)!);
      expect(params.get("reputationImpact")).toBe("affected");
      expect(params.get("page")).toBe("1");
    });
  });

  it("estado vazio", async () => {
    setup({ list: { ...LIST, items: [], total: 0, totalPages: 0 } });
    await openCases();
    expect(await screen.findByText("Nenhum problema encontrado para os filtros selecionados.")).toBeInTheDocument();
  });

  it("falha de API mantém estado seguro e oferece tentar novamente", async () => {
    const calls = setup({ list: new Error("falha") });
    const user = await openCases();
    expect(await screen.findByText("Não foi possível carregar os problemas agora.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const before = callsTo(calls, "/problems").length;
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(callsTo(calls, "/problems").length).toBeGreaterThan(before));
  });

  describe("correção manual", () => {
    it("sem problems.manage a correção NÃO existe (nem desabilitada)", async () => {
      setup();
      const user = await openCases();
      await screen.findByRole("table");
      await user.click(screen.getAllByRole("button", { name: /Ver detalhes/ })[0]);
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("5001234567");
      expect(within(dialog).queryByRole("form", { name: "Corrigir responsabilidade" })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: "Salvar correção" })).not.toBeInTheDocument();
    });

    it("com problems.manage: exige motivo e envia PATCH", async () => {
      const calls = setup({ permissions: ["problems.view", "problems.manage"] });
      const user = await openCases();
      await screen.findByRole("table");
      await user.click(screen.getAllByRole("button", { name: /Ver detalhes/ })[0]);
      const form = await screen.findByRole("form", { name: "Corrigir responsabilidade" });
      await user.click(within(form).getByRole("button", { name: "Salvar correção" }));
      expect(await within(form).findByText(/Informe o motivo da alteração/)).toBeInTheDocument();

      await user.selectOptions(within(form).getByLabelText("Responsável"), "SELLER");
      await user.type(within(form).getByLabelText("Motivo da alteração"), "Cliente devolveu errado");
      await user.click(within(form).getByRole("button", { name: "Salvar correção" }));
      await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
      const patch = calls.find((c) => c.method === "PATCH")!;
      expect(JSON.parse(patch.body!)).toEqual({ responsibility: "SELLER", reason: "Cliente devolveu errado" });
    });
  });
});
