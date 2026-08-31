// Divergência mínima do plano: `jest.spyOn(api, "algumExport")` falha com
// "Cannot redefine property" para QUALQUER export nomeado de `lib/api.ts`
// neste projeto — o transform SWC usado por `next/jest` compila exports
// ESM para bindings não configuráveis (correto por spec de módulos ES; o
// `spyOn` do plano presumia um transform mais permissivo). Corrigido
// substituindo `jest.spyOn` por `jest.mock("../src/lib/api")` (automock: o
// Jest substitui o módulo inteiro no registro por uma cópia cujas funções
// já são `jest.fn()`, sem precisar redefinir nenhuma propriedade do módulo
// real) — cada teste configura o retorno via
// `(api.fn as jest.Mock).mockResolvedValue(...)`. O caminho é relativo
// (`../src/lib/api`, não o alias `@/lib/api`) porque o alias só é
// reescrito pelo SWC em declarações `import` estáticas, não na string
// passada para `jest.mock`.
jest.mock("../src/lib/api");

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntegracoesPage from "@/app/(protegido)/integracoes/page";
import * as api from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
}));

const { useSearchParams } = jest.requireMock("next/navigation") as {
  useSearchParams: jest.Mock;
};

function mockSearchParams(params: Record<string, string> = {}) {
  useSearchParams.mockReturnValue(new URLSearchParams(params));
}

function mlAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "acc-1",
    marketplace: "MERCADO_LIVRE",
    externalSellerId: null,
    nickname: null,
    status: "DISCONNECTED",
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSearchParams();
  (api.redirectTo as jest.Mock).mockImplementation(() => {});
});

describe("IntegracoesPage", () => {
  it("renders Amazon and Shopee as static placeholders", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);

    render(<IntegracoesPage />);

    expect(await screen.findByText("Amazon")).toBeInTheDocument();
    expect(screen.getByText("Shopee")).toBeInTheDocument();
    // Divergência mínima do plano: `MarketplaceCard` renderiza
    // `Status: {statusLabel}` como um único elemento (design/convenção já
    // usada em todas as outras asserções deste arquivo) — o texto
    // completo inclui o prefixo "Status: ", então o matcher precisa dele
    // também para casar com o `textContent` real do elemento.
    expect(
      screen.getAllByText("Status: Disponível futuramente"),
    ).toHaveLength(2);
  });

  it("shows an empty state with a 'Conectar Mercado Livre' button when no account exists yet", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);

    render(<IntegracoesPage />);

    await waitFor(() =>
      expect(screen.getByText("Status: Não conectado")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /conectar mercado livre/i }),
    ).toBeEnabled();
  });

  it("renders TWO Mercado Livre accounts side by side, each with its own status and its own button", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({
        id: "acc-1",
        nickname: "Loja Principal",
        status: "CONNECTED",
        externalSellerId: "111",
      }),
      mlAccount({
        id: "acc-2",
        nickname: "Loja Secundária",
        status: "TOKEN_EXPIRED",
        externalSellerId: "222",
      }),
    ]);

    render(<IntegracoesPage />);

    const card1 = await screen.findByTestId("marketplace-account-acc-1");
    const card2 = await screen.findByTestId("marketplace-account-acc-2");

    expect(within(card1).getByText(/loja principal/i)).toBeInTheDocument();
    expect(within(card1).getByText("Status: Conectado")).toBeInTheDocument();
    expect(
      within(card1).getByRole("button", { name: /reconectar/i }),
    ).toBeInTheDocument();

    expect(within(card2).getByText(/loja secundária/i)).toBeInTheDocument();
    expect(
      within(card2).getByText("Status: Token expirado — reconexão necessária"),
    ).toBeInTheDocument();
    expect(
      within(card2).getByRole("button", { name: /reconectar/i }),
    ).toBeInTheDocument();
  });

  it("never shows failureCode or errorSummary text — only the fixed, generic status description", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "ERROR" }),
    ]);

    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    expect(
      within(card).getByText("Status: Erro — reconexão necessária"),
    ).toBeInTheDocument();
    // Nenhum texto de failureCode/errorSummary interno é renderizado — a
    // descrição vem só do STATUS_DESCRIPTIONS fixo do frontend.
    expect(
      screen.queryByText(/ACCOUNT_ALREADY_CONNECTED/),
    ).not.toBeInTheDocument();
  });

  it("clicking 'Conectar' on a specific account calls connectMercadoLivre with THAT account's id and redirects", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "DISCONNECTED" }),
    ]);
    (api.connectMercadoLivre as jest.Mock).mockResolvedValue({
      authorizationUrl:
        "https://auth.mercadolivre.com.br/authorization?state=abc",
    });

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /conectar/i }));

    await waitFor(() =>
      expect(api.connectMercadoLivre).toHaveBeenCalledWith("acc-1"),
    );
    expect(api.redirectTo).toHaveBeenCalledWith(
      "https://auth.mercadolivre.com.br/authorization?state=abc",
    );
  });

  it("double-clicking the same account's connect button only calls connectMercadoLivre once (no duplicate in-flight requests)", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "DISCONNECTED" }),
    ]);
    let resolveConnect!: (v: { authorizationUrl: string }) => void;
    (api.connectMercadoLivre as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    const button = within(card).getByRole("button", { name: /conectar/i });
    await user.click(button);
    await user.click(button); // segundo clique enquanto a primeira chamada ainda está em voo

    expect(api.connectMercadoLivre).toHaveBeenCalledTimes(1);

    resolveConnect({
      authorizationUrl:
        "https://auth.mercadolivre.com.br/authorization?state=abc",
    });
    // Aguarda a atualização assíncrona (redirecionamento) se completar antes
    // do teste terminar — sem isso, a promessa resolvida continua pendente
    // e o `act(...)` correspondente só ocorreria depois do teste já ter
    // encerrado, gerando warning e possível vazamento para o próximo teste.
    await waitFor(() =>
      expect(api.redirectTo).toHaveBeenCalledWith(
        "https://auth.mercadolivre.com.br/authorization?state=abc",
      ),
    );
  });

  it("'Adicionar outra conta' creates exactly one new account per click, then connects it (double-click never creates two rows)", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    let resolveCreate!: (v: MarketplaceAccountDto) => void;
    (api.createMarketplaceAccount as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    (api.connectMercadoLivre as jest.Mock).mockResolvedValue({
      authorizationUrl:
        "https://auth.mercadolivre.com.br/authorization?state=abc",
    });

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const addButton = await screen.findByRole("button", {
      name: /adicionar outra conta|conectar mercado livre/i,
    });
    await user.click(addButton);
    await user.click(addButton); // segundo clique enquanto a criação ainda está em voo

    expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(1);

    resolveCreate(mlAccount({ id: "acc-new" }));
    // Aguarda toda a cadeia assíncrona subsequente (loadAccounts +
    // handleConnect da conta recém-criada) se completar antes do teste
    // terminar — mesma razão do teste anterior: evita promessa pendente e
    // warning de `act(...)` fora do teste.
    await waitFor(() =>
      expect(api.connectMercadoLivre).toHaveBeenCalledWith("acc-new"),
    );
  });

  it("shows a distinct load-error message when fetching accounts fails — never falls back to a false 'Não conectado' card", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockRejectedValue(
      new Error("network down"),
    );

    render(<IntegracoesPage />);

    expect(
      await screen.findByText(/não foi possível carregar suas contas/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Status: Não conectado")).not.toBeInTheDocument();
  });

  it("shows a success banner ONLY when ml=success AND reason=success are BOTH present", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    mockSearchParams({ ml: "success", reason: "success" });

    render(<IntegracoesPage />);

    expect(
      await screen.findByText("Conta do Mercado Livre conectada com sucesso."),
    ).toBeInTheDocument();
  });

  it("does NOT show the success banner when ml=success is present but reason is missing/mismatched", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    mockSearchParams({ ml: "success" });

    render(<IntegracoesPage />);
    await screen.findByText("Amazon"); // espera a página terminar de montar

    expect(
      screen.queryByText("Conta do Mercado Livre conectada com sucesso."),
    ).not.toBeInTheDocument();
  });

  it("shows an error banner for reason=ACCOUNT_ALREADY_CONNECTED", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    mockSearchParams({ ml: "error", reason: "ACCOUNT_ALREADY_CONNECTED" });

    render(<IntegracoesPage />);

    expect(
      await screen.findByText(
        "Esta conta do Mercado Livre já está conectada em outro registro.",
      ),
    ).toBeInTheDocument();
  });

  it("does NOT show the error banner when reason is a known error code but ml is not 'error' (a malformed/manipulated link)", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    mockSearchParams({ ml: "success", reason: "ACCOUNT_ALREADY_CONNECTED" });

    render(<IntegracoesPage />);
    await screen.findByText("Amazon"); // espera a página terminar de montar

    expect(
      screen.queryByText(
        "Esta conta do Mercado Livre já está conectada em outro registro.",
      ),
    ).not.toBeInTheDocument();
    // reason !== "success", então também não deve cair no caminho de sucesso.
    expect(
      screen.queryByText("Conta do Mercado Livre conectada com sucesso."),
    ).not.toBeInTheDocument();
  });
});
