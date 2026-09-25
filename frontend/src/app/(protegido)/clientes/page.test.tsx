import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClientesPage from "./page";
import type { CustomersSummaryDto } from "@/types/customers";

// Caminho relativo real (não o alias `@/*`) — mesma ressalva dos demais testes de página.
jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return { ...actual, apiFetch: jest.fn(), fetchMarketplaceAccounts: jest.fn() };
});

const api = jest.requireMock("../../../lib/api") as {
  apiFetch: jest.Mock;
  fetchMarketplaceAccounts: jest.Mock;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => null },
  } as unknown as Response;
}

function summary(overrides: Partial<CustomersSummaryDto> = {}): CustomersSummaryDto {
  return {
    period: { allTime: true, from: null, to: null },
    cards: {
      identifiedCustomers: 30,
      customersWithValidPurchase: 30,
      recurringCustomers: 10,
      recurrenceRate: 0.3333,
      paidRevenue: "1500.00",
      paidOrders: 40,
      averageTicket: null,
      units: 55,
      buyerNameCoverage: 0.5,
      recipientNameCoverage: 0.2,
      emailCoverage: null,
      recipientPhoneCoverage: 0.1,
    },
    page: 1,
    pageSize: 25,
    totalCustomers: 30,
    totalPages: 2,
    customers: [
      {
        buyerId: "b1",
        marketplace: "MERCADO_LIVRE",
        accountId: "acc-ml1",
        accountNickname: "ML1",
        externalBuyerId: "999",
        username: "NICK",
        buyerName: "Maria Silva",
        recipientName: "Destinatário X",
        emailMasked: "ma***@x.com",
        recipientPhoneMasked: "*******4321",
        city: null,
        state: null,
        firstPurchaseAt: "2026-08-01T12:00:00.000Z",
        lastPurchaseAt: "2026-08-10T12:00:00.000Z",
        validOrders: 2,
        totalOrders: 3,
        units: 4,
        paidRevenue: "150.00",
        refundedAmount: null,
        averageTicket: "75.00",
        customerType: "RECURRING",
        topProduct: { title: "Produto SKU-1", sellerSku: "SKU-1", externalItemId: "MLB1", units: 2 },
      },
    ],
    ...overrides,
  };
}

function setup(options: { isAdmin?: boolean } = {}) {
  const calls: string[] = [];
  api.fetchMarketplaceAccounts.mockResolvedValue([
    { id: "acc-ml1", marketplace: "MERCADO_LIVRE", nickname: "ML1" },
    { id: "acc-shopee", marketplace: "SHOPEE", nickname: "Loja Shopee" },
    { id: "acc-amz", marketplace: "AMAZON", nickname: "Amazon" },
  ]);
  api.apiFetch.mockImplementation(async (path: string) => {
    calls.push(path);
    if (path === "/auth/me") {
      return jsonResponse({ name: "Ana", email: "ana@example.com", isAdmin: options.isAdmin ?? true });
    }
    if (path.startsWith("/customers/summary")) return jsonResponse(summary());
    if (path.startsWith("/customers/export.xlsx")) {
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob(["xlsx"]),
        headers: { get: () => 'attachment; filename="clientes_todo-o-periodo_gerado-2026-09-25_1200.xlsx"' },
      } as unknown as Response;
    }
    if (path.startsWith("/customers/enrichment")) {
      return jsonResponse({
        workerEnabled: true,
        accounts: [
          { accountId: "acc-ml1", marketplace: "MERCADO_LIVRE", nickname: "ML1", connected: true,
            jobStatus: null, cursorBefore: null, chunksProcessed: 0, lastErrorCode: null,
            requestedAt: null, completedAt: null, pauseRequested: false },
        ],
      });
    }
    return jsonResponse({}, 404);
  });
  return calls;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("/clientes", () => {
  it("non-admin sees a restricted notice and no customers endpoint is called", async () => {
    const calls = setup({ isAdmin: false });
    render(<ClientesPage />);
    expect(await screen.findByText("Acesso restrito a administradores.")).toBeInTheDocument();
    expect(calls.some((path) => path.startsWith("/customers"))).toBe(false);
  });

  it("loads 'Todo o período' by default and shows masked contact data, never R$ 0,00 for missing values", async () => {
    const calls = setup();
    render(<ClientesPage />);
    const table = await screen.findByRole("table");
    expect(calls.find((path) => path.startsWith("/customers/summary"))).toContain("allTime=true");

    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByText("ma***@x.com")).toBeInTheDocument();
    expect(within(row).getByText("*******4321")).toBeInTheDocument();
    expect(within(row).getByText("Destinatário X")).toBeInTheDocument();
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(["Comprador", "Destinatário", "Telefone do destinatário"]),
    );
    // Reembolso e cidade/UF ausentes → N/D.
    expect(within(row).getAllByText("N/D").length).toBeGreaterThanOrEqual(2);
    expect(within(row).getByText("Recorrente")).toBeInTheDocument();

    const cards = screen.getByRole("region", { name: "Indicadores de clientes" });
    expect(within(cards).getByText("33,3%")).toBeInTheDocument();
    // Ticket médio e cobertura de e-mail sem base → N/D (nunca R$ 0,00 / 0%).
    expect(within(cards).getAllByText("N/D")).toHaveLength(2);
    expect(within(cards).queryByText(/R\$\s?0,00/)).toBeNull();
  });

  it("applies filters (marketplace, account, custom period, flags) and resets to page 1", async () => {
    const user = userEvent.setup();
    const calls = setup();
    render(<ClientesPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(calls.some((p) => p.includes("page=2"))).toBe(true));

    await user.selectOptions(screen.getByLabelText("Marketplace"), "SHOPEE");
    const accountSelect = screen.getByLabelText("Conta");
    expect(within(accountSelect).queryByText("ML1")).toBeNull();
    expect(within(accountSelect).queryByText("Amazon")).toBeNull();
    await user.selectOptions(accountSelect, "acc-shopee");
    await user.selectOptions(screen.getByLabelText("Tipo de cliente"), "RECURRING");
    await user.click(screen.getByLabelText("Intervalo personalizado"));
    await user.clear(screen.getByLabelText("De"));
    await user.type(screen.getByLabelText("De"), "2026-01-01");
    await user.clear(screen.getByLabelText("Até"));
    await user.type(screen.getByLabelText("Até"), "2026-01-31");
    expect(
      screen.getByText("Nomes ficam criptografados e não são pesquisáveis nesta versão."),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Buscar cliente"), "nick");
    await user.type(screen.getByLabelText("Produto/SKU"), "SKU-1");
    await user.click(screen.getByLabelText("Somente com telefone do destinatário"));
    await user.click(screen.getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => {
      const last = calls.filter((p) => p.startsWith("/customers/summary")).at(-1)!;
      const params = new URLSearchParams(last.split("?")[1]);
      expect(Object.fromEntries(params)).toEqual({
        from: "2026-01-01",
        to: "2026-01-31",
        marketplace: "SHOPEE",
        accountId: "acc-shopee",
        customerType: "RECURRING",
        search: "nick",
        product: "SKU-1",
        onlyWithRecipientPhone: "true",
        page: "1",
        pageSize: "25",
      });
    });
  });

  it("downloads the Excel generated on demand, with the server-provided filename", async () => {
    const user = userEvent.setup();
    const calls = setup();
    const createObjectURL = jest.fn(() => "blob:local");
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("clientes_todo-o-periodo_gerado-2026-09-25_1200.xlsx");
      });

    render(<ClientesPage />);
    await screen.findByRole("table");
    await user.click(screen.getByLabelText("Incluir dados pessoais completos no Excel"));
    await user.click(screen.getByRole("button", { name: "Baixar Excel" }));

    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    const exportCall = calls.find((p) => p.startsWith("/customers/export.xlsx"))!;
    expect(exportCall).toContain("allTime=true");
    expect(exportCall).toContain("includePersonalData=false");
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local");
    clickSpy.mockRestore();
  });

  it("starts the historical enrichment for all accounts on explicit click only", async () => {
    const user = userEvent.setup();
    const calls = setup();
    render(<ClientesPage />);
    await screen.findByText(/Não iniciado/);
    expect(calls.some((p) => p === "/customers/enrichment/start")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Enriquecer todas as contas" }));
    await waitFor(() =>
      expect(calls.some((p) => p === "/customers/enrichment/start")).toBe(true),
    );
  });
});
