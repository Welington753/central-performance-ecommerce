import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import IntegracoesPage from "./page";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

// `jest.mock`/`jest.requireActual` resolvem o próprio argumento fora do
// pipeline de transform do Next (que é o que entende o alias `@/*`) — por
// isso, ao contrário dos `import`s normais deste arquivo, aqui é preciso um
// caminho relativo real para `src/lib/api.ts`.
jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return {
    ...actual,
    fetchMarketplaceAccounts: jest.fn(),
    fetchAmazonSetupStatus: jest.fn(),
    renameMarketplaceAccount: jest.fn(),
    connectMercadoLivre: jest.fn(),
    createMarketplaceAccount: jest.fn(),
    recoverMercadoLivreConnection: jest.fn(),
    redirectTo: jest.fn(),
    syncAmazonOrders: jest.fn(),
  };
});

const api = jest.requireMock("../../../lib/api") as {
  fetchMarketplaceAccounts: jest.Mock;
  fetchAmazonSetupStatus: jest.Mock;
  renameMarketplaceAccount: jest.Mock;
  connectMercadoLivre: jest.Mock;
  createMarketplaceAccount: jest.Mock;
  recoverMercadoLivreConnection: jest.Mock;
  redirectTo: jest.Mock;
  syncAmazonOrders: jest.Mock;
};

function mlAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "ml-1",
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

function amazonStatus(
  overrides: Partial<AmazonSetupStatusDto> = {},
): AmazonSetupStatusDto {
  return {
    applicationConfigured: true,
    missingConfigurationKeys: [],
    hasAccount: false,
    accounts: [],
    canProvision: true,
    canVerify: true,
    canSynchronize: true,
    ...overrides,
  };
}

function mockSearchParams(params: Record<string, string> = {}) {
  const search = new URLSearchParams(params);
  (useSearchParams as jest.Mock).mockReturnValue(search);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams();
  (usePathname as jest.Mock).mockReturnValue("/integracoes");
  (useRouter as jest.Mock).mockReturnValue({ replace: jest.fn() });
  api.fetchMarketplaceAccounts.mockResolvedValue([]);
  api.fetchAmazonSetupStatus.mockResolvedValue(amazonStatus());
});

describe("IntegracoesPage — banner de retorno OAuth do Mercado Livre", () => {
  it("mostra a mensagem de sucesso somente quando ml=success E reason=success", async () => {
    mockSearchParams({ ml: "success", reason: "success" });
    render(<IntegracoesPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Conta do Mercado Livre conectada com sucesso.",
    );
  });

  it("mostra a mensagem pública fixa para um reason de erro conhecido", async () => {
    mockSearchParams({ ml: "error", reason: "AUTHORIZATION_DENIED" });
    render(<IntegracoesPage />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "A autorização foi cancelada no Mercado Livre.",
    );
  });

  it("nunca mostra banner quando só um dos dois parâmetros está presente", async () => {
    mockSearchParams({ reason: "AUTHORIZATION_DENIED" });
    render(<IntegracoesPage />);
    await waitFor(() => expect(api.fetchMarketplaceAccounts).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("IntegracoesPage — trava de clique duplo e isolamento entre contas Mercado Livre", () => {
  it("clicar duas vezes seguidas em Conectar dispara apenas uma chamada", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValue([mlAccount({ id: "ml-1" })]);
    api.connectMercadoLivre.mockResolvedValue({
      authorizationUrl: "https://ml.example/auth",
    });
    render(<IntegracoesPage />);

    const button = await screen.findByRole("button", { name: "Conectar" });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(api.redirectTo).toHaveBeenCalledTimes(1));
    expect(api.connectMercadoLivre).toHaveBeenCalledTimes(1);
  });

  it("conectar a conta 1 não desabilita nem afeta a conta 2", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValue([
      mlAccount({ id: "ml-1", nickname: "Loja 1" }),
      mlAccount({ id: "ml-2", nickname: "Loja 2" }),
    ]);
    let resolveConnect!: (value: { authorizationUrl: string }) => void;
    api.connectMercadoLivre.mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );
    render(<IntegracoesPage />);

    const buttons = await screen.findAllByRole("button", { name: "Conectar" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(buttons[0]).toBeDisabled());
    expect(buttons[1]).not.toBeDisabled();

    resolveConnect({ authorizationUrl: "https://ml.example/auth" });
    await waitFor(() => expect(api.redirectTo).toHaveBeenCalledTimes(1));
  });

  it("um erro ao conectar a conta Mercado Livre não aparece na seção Amazon", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValue([mlAccount({ id: "ml-1" })]);
    api.fetchAmazonSetupStatus.mockResolvedValue(
      amazonStatus({ accounts: [] }),
    );
    api.connectMercadoLivre.mockRejectedValue(new Error("boom"));
    render(<IntegracoesPage />);

    const button = await screen.findByRole("button", { name: "Conectar" });
    fireEvent.click(button);

    expect(
      await screen.findByText(
        "Não foi possível iniciar a conexão com o Mercado Livre. Tente novamente.",
      ),
    ).toBeInTheDocument();

    const amazonSectionHeading = screen
      .getAllByRole("heading", { name: "Amazon" })
      .find((heading) => !heading.closest('[data-testid^="marketplace-account-"]'));
    const amazonSection = amazonSectionHeading?.closest("section") ?? null;
    expect(amazonSection).not.toBeNull();
    expect(amazonSection?.textContent).not.toMatch(
      /Não foi possível iniciar a conexão com o Mercado Livre/,
    );
  });
});
