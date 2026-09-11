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
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto } from "@/types/marketplace";

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

const { useSearchParams, useRouter, usePathname } = jest.requireMock(
  "next/navigation",
) as {
  useSearchParams: jest.Mock;
  useRouter: jest.Mock;
  usePathname: jest.Mock;
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
    recoveryHint: null,
    nextRetryAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function amazonAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "amz-1",
    marketplace: "AMAZON",
    externalSellerId: null,
    nickname: null,
    status: "DISCONNECTED",
    recoveryHint: null,
    nextRetryAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function amazonSetupStatus(
  overrides: Partial<AmazonSetupStatusDto> = {},
): AmazonSetupStatusDto {
  return {
    applicationConfigured: true,
    missingConfigurationKeys: [],
    hasAccount: false,
    accounts: [],
    canProvision: true,
    canVerify: false,
    canSynchronize: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSearchParams();
  usePathname.mockReturnValue("/integracoes");
  useRouter.mockReturnValue({ replace: jest.fn() });
  (api.redirectTo as jest.Mock).mockImplementation(() => {});
  // Default: aplicação configurada, sem conta Amazon ainda — testes de
  // Mercado Livre que não se importam com Amazon usam este default e
  // nunca precisam configurá-lo explicitamente.
  (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
    amazonSetupStatus(),
  );
});

describe("IntegracoesPage", () => {
  it("shows an empty state with a 'Conectar Mercado Livre' button when no account exists yet", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);

    render(<IntegracoesPage />);

    const card = await screen.findByTestId(
      "marketplace-account-mercado-livre-empty",
    );
    expect(
      within(card).getByText("Status: Não conectado"),
    ).toBeInTheDocument();
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

    // ML e Shopee compartilham o mesmo `loadError` e a mesma mensagem fixa —
    // cada seção mostra a sua própria instância do alerta.
    const alerts = await screen.findAllByText(
      /não foi possível carregar suas contas/i,
    );
    expect(alerts.length).toBeGreaterThan(0);
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

describe("IntegracoesPage — Amazon (Checkpoint 4-C)", () => {
  it("Amazon and Shopee never show 'Disponível futuramente' anymore (CP2E: Shopee connector wired)", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);

    render(<IntegracoesPage />);

    await screen.findByText("Amazon");
    expect(
      screen.getByRole("button", { name: /conectar shopee/i }),
    ).toBeEnabled();
    expect(
      screen.queryByText("Status: Disponível futuramente"),
    ).not.toBeInTheDocument();
  });

  it("shows a 'Configurar Amazon' button and 'Conta Amazon ainda não configurada' when the app is configured but no account exists", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({ applicationConfigured: true, accounts: [] }),
    );

    render(<IntegracoesPage />);

    expect(
      await screen.findByText("Status: Conta Amazon ainda não configurada"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /configurar amazon/i }),
    ).toBeEnabled();
  });

  it("shows 'Configuração do servidor pendente' with the missing variable NAMES (never a value) and never offers a Client Secret field", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        applicationConfigured: false,
        missingConfigurationKeys: [
          "AMAZON_LWA_CLIENT_SECRET",
          "AMAZON_MARKETPLACE_IDS",
        ],
      }),
    );

    render(<IntegracoesPage />);

    expect(
      await screen.findByText(/configuração do servidor pendente/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/AMAZON_LWA_CLIENT_SECRET/)).toBeInTheDocument();
    expect(screen.getByText(/AMAZON_MARKETPLACE_IDS/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /configurar amazon/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
  });

  it("a DISCONNECTED account shows 'Aguardando credenciais' and 'Continuar configuração'", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        hasAccount: true,
        accounts: [amazonAccount({ status: "DISCONNECTED" })],
      }),
    );

    render(<IntegracoesPage />);

    expect(
      await screen.findByText("Status: Aguardando credenciais"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continuar configuração/i }),
    ).toBeInTheDocument();
  });

  it("clicking 'Continuar configuração' opens the credentials modal for that account", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        hasAccount: true,
        accounts: [amazonAccount({ id: "amz-1", status: "DISCONNECTED" })],
      }),
    );

    render(<IntegracoesPage />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /continuar configuração/i }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Modo "credentials": sem campo de apelido.
    expect(
      screen.queryByLabelText(/apelido da conta/i),
    ).not.toBeInTheDocument();
  });

  it("a CONNECTED account shows 'Conectado', the Selling Partner ID/nickname, 'Sincronizar agora' AND 'Reconfigurar credenciais'", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        hasAccount: true,
        canVerify: true,
        canSynchronize: true,
        accounts: [
          amazonAccount({
            status: "CONNECTED",
            externalSellerId: "A1SELLERPARTNERID",
            nickname: "Amazon principal",
          }),
        ],
      }),
    );

    render(<IntegracoesPage />);

    expect(await screen.findByText("Status: Conectado")).toBeInTheDocument();
    expect(screen.getByText(/amazon principal/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^sincronizar agora$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reconfigurar credenciais/i }),
    ).toBeInTheDocument();
  });

  it("clicking 'Sincronizar agora' calls the EXISTING Amazon sync endpoint — never a duplicated sync implementation", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        hasAccount: true,
        canSynchronize: true,
        accounts: [
          amazonAccount({ id: "amz-1", status: "CONNECTED" }),
        ],
      }),
    );
    (api.syncAmazonOrders as jest.Mock).mockResolvedValue({
      syncRunId: "run-1",
      status: "SUCCESS",
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-09-01T00:00:00.000Z",
      pagesFetched: 1,
      ordersFetched: 0,
      ordersUpserted: 0,
      itemsUpserted: 0,
    });

    render(<IntegracoesPage />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^sincronizar agora$/i }),
    );

    await waitFor(() =>
      expect(api.syncAmazonOrders).toHaveBeenCalledWith("amz-1"),
    );
  });

  it("a sync failure shows a sanitized error message — never a raw exception", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        hasAccount: true,
        canSynchronize: true,
        accounts: [amazonAccount({ id: "amz-1", status: "CONNECTED" })],
      }),
    );
    (api.syncAmazonOrders as jest.Mock).mockRejectedValue(
      new Error("PROVIDER_UNAVAILABLE"),
    );

    render(<IntegracoesPage />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^sincronizar agora$/i }),
    );

    expect(
      await screen.findByText(/não foi possível sincronizar agora/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("PROVIDER_UNAVAILABLE")).not.toBeInTheDocument();
  });

  it.each([["TOKEN_EXPIRED"], ["ERROR"]] as const)(
    "a %s account shows a sanitized error status and a 'Reconfigurar' button",
    async (status) => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
      (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
        amazonSetupStatus({
          hasAccount: true,
          canVerify: true,
          accounts: [amazonAccount({ status })],
        }),
      );

      render(<IntegracoesPage />);

      expect(
        await screen.findByText("Status: Erro — reconexão necessária"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^reconfigurar$/i }),
      ).toBeInTheDocument();
    },
  );

  it("'Adicionar outra conta' (Amazon) is absent when there is no account yet", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({ accounts: [] }),
    );

    render(<IntegracoesPage />);
    await screen.findByText("Status: Conta Amazon ainda não configurada");

    expect(
      screen.queryByRole("button", { name: /adicionar outra conta/i }),
    ).not.toBeInTheDocument();
  });

  it("'Adicionar outra conta' (Amazon) appears once at least one Amazon account already exists, and opens the create-mode modal", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        hasAccount: true,
        canSynchronize: true,
        accounts: [amazonAccount({ status: "CONNECTED" })],
      }),
    );

    render(<IntegracoesPage />);
    const user = userEvent.setup();
    const addButton = await screen.findByRole("button", {
      name: /adicionar outra conta/i,
    });
    await user.click(addButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/apelido da conta/i)).toBeInTheDocument();
  });

  it("a load error for the Amazon status shows a dedicated message — never a false empty/disconnected card", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockRejectedValue(
      new Error("network down"),
    );

    render(<IntegracoesPage />);

    expect(
      await screen.findByText(
        /não foi possível carregar o status da configuração amazon/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Status: Conta Amazon ainda não configurada"),
    ).not.toBeInTheDocument();
  });

  it("Mercado Livre keeps working exactly as before, unaffected by the Amazon section", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "CONNECTED", nickname: "Loja ML" }),
    ]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        hasAccount: true,
        canSynchronize: true,
        accounts: [amazonAccount({ status: "CONNECTED" })],
      }),
    );

    render(<IntegracoesPage />);

    const mlCard = await screen.findByTestId("marketplace-account-acc-1");
    expect(within(mlCard).getByText(/loja ml/i)).toBeInTheDocument();
    expect(within(mlCard).getByText("Status: Conectado")).toBeInTheDocument();
    expect(
      within(mlCard).getByRole("button", { name: /reconectar/i }),
    ).toBeInTheDocument();
  });

  it("renames a connected account inline without reloading the page", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "CONNECTED", externalSellerId: "111" }),
    ]);
    (api.renameMarketplaceAccount as jest.Mock).mockResolvedValue(
      mlAccount({
        id: "acc-1",
        status: "CONNECTED",
        externalSellerId: "111",
        nickname: "Meli 1",
      }),
    );

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /renomear/i }));
    const input = within(card).getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Meli 1");
    await user.click(within(card).getByRole("button", { name: /salvar/i }));

    await waitFor(() =>
      expect(api.renameMarketplaceAccount).toHaveBeenCalledWith(
        "acc-1",
        "Meli 1",
      ),
    );
    expect(within(card).getByText(/meli 1/i)).toBeInTheDocument();
    // Sem novo fetch de listagem — a UI aplica a resposta do PATCH direto.
    expect(api.fetchMarketplaceAccounts).toHaveBeenCalledTimes(1);
  });

  it("renames a disconnected account inline as well", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "DISCONNECTED" }),
    ]);
    (api.renameMarketplaceAccount as jest.Mock).mockResolvedValue(
      mlAccount({ id: "acc-1", status: "DISCONNECTED", nickname: "Meli 2" }),
    );

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /renomear/i }));
    await user.type(within(card).getByRole("textbox"), "Meli 2");
    await user.click(within(card).getByRole("button", { name: /salvar/i }));

    await waitFor(() =>
      expect(within(card).getByText(/meli 2/i)).toBeInTheDocument(),
    );
  });

  it("shows a clear error message when the nickname is a duplicate, without discarding the previous name", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "acc-1", status: "CONNECTED", nickname: "Loja Principal" }),
    ]);
    (api.renameMarketplaceAccount as jest.Mock).mockRejectedValue(
      new (jest.requireActual("../src/lib/api") as typeof api).ApiFetchError(
        "Já existe uma conta com esse nome neste marketplace.",
        "NICKNAME_ALREADY_IN_USE",
      ),
    );

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /renomear/i }));
    const input = within(card).getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Outra Loja");
    await user.click(within(card).getByRole("button", { name: /salvar/i }));

    expect(
      await within(card).findByText(/já existe uma conta com esse nome/i),
    ).toBeInTheDocument();
    // Cancelar após a falha volta a exibir o apelido anterior — a tentativa
    // rejeitada nunca chegou a sobrescrever o estado da conta no componente
    // pai (nenhuma chamada bem-sucedida a `renameMarketplaceAccount`).
    await user.click(within(card).getByRole("button", { name: /cancelar/i }));
    expect(within(card).getByText(/loja principal/i)).toBeInTheDocument();
  });

  it("restores the default name via 'Restaurar nome padrão'", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({
        id: "acc-1",
        status: "CONNECTED",
        nickname: "Loja Principal",
        externalSellerId: "111",
      }),
    ]);
    (api.renameMarketplaceAccount as jest.Mock).mockResolvedValue(
      mlAccount({ id: "acc-1", status: "CONNECTED", externalSellerId: "111" }),
    );

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /renomear/i }));
    await user.click(
      within(card).getByRole("button", { name: /restaurar nome padrão/i }),
    );

    await waitFor(() =>
      expect(api.renameMarketplaceAccount).toHaveBeenCalledWith("acc-1", null),
    );
    expect(within(card).getByText(/conta 111/i)).toBeInTheDocument();
  });
});

describe("IntegracoesPage — recuperação de falha temporária (Fase 4, resiliência OAuth)", () => {
  it("shows 'Tentar agora' (never 'Reconectar') for TEMPORARY_RETRY, with the scheduled retry time", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({
        id: "acc-1",
        status: "ERROR",
        recoveryHint: "TEMPORARY_RETRY",
        nextRetryAt: "2026-09-04T12:30:00.000Z",
      }),
    ]);

    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    expect(
      within(card).getByText("Status: Conexão temporariamente indisponível"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/nova tentativa automática em/i),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: /tentar agora/i }),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: /^reconectar$/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking 'Tentar agora' calls the recover endpoint and reloads the account list", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock)
      .mockResolvedValueOnce([
        mlAccount({
          id: "acc-1",
          status: "ERROR",
          recoveryHint: "TEMPORARY_RETRY",
        }),
      ])
      .mockResolvedValueOnce([
        mlAccount({ id: "acc-1", status: "CONNECTED", recoveryHint: null }),
      ]);
    (api.recoverMercadoLivreConnection as jest.Mock).mockResolvedValue({
      outcome: "RECOVERED",
    });

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /tentar agora/i }));

    await waitFor(() =>
      expect(api.recoverMercadoLivreConnection).toHaveBeenCalledWith("acc-1"),
    );
    await waitFor(() =>
      expect(
        within(
          screen.getByTestId("marketplace-account-acc-1"),
        ).getByText("Status: Conectado"),
      ).toBeInTheDocument(),
    );
  });

  it("a still-pending recovery (PENDING_RETRY) reloads without an error banner", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({
        id: "acc-1",
        status: "ERROR",
        recoveryHint: "TEMPORARY_RETRY",
      }),
    ]);
    (api.recoverMercadoLivreConnection as jest.Mock).mockResolvedValue({
      outcome: "PENDING_RETRY",
    });

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /tentar agora/i }));

    await waitFor(() =>
      expect(api.recoverMercadoLivreConnection).toHaveBeenCalled(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("RECONNECT_REQUIRED after a recovery attempt shows a clear message instead of silently retrying", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({
        id: "acc-1",
        status: "ERROR",
        recoveryHint: "TEMPORARY_RETRY",
      }),
    ]);
    (api.recoverMercadoLivreConnection as jest.Mock).mockResolvedValue({
      outcome: "RECONNECT_REQUIRED",
    });

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /tentar agora/i }));

    expect(
      await screen.findByText(/precisa ser reconectada/i),
    ).toBeInTheDocument();
  });

  it("CONFIGURATION_ERROR shows 'Verifique as credenciais', never a 'Reconectar' primary action", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({
        id: "acc-1",
        status: "ERROR",
        recoveryHint: "CONFIGURATION_ERROR",
      }),
    ]);

    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    expect(
      within(card).getByText(/verifique as credenciais/i),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: /^reconectar$/i }),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: /tentar agora/i }),
    ).not.toBeInTheDocument();
  });

  it("RECONNECT_REQUIRED (no recoveryHint override, e.g. TOKEN_EXPIRED) still shows 'Reconectar' as before", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({
        id: "acc-1",
        status: "TOKEN_EXPIRED",
        recoveryHint: "RECONNECT_REQUIRED",
      }),
    ]);

    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    expect(
      within(card).getByRole("button", { name: /^reconectar$/i }),
    ).toBeInTheDocument();
  });
});
