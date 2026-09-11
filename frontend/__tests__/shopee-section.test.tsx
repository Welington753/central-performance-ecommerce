// Mesmo padrão de integracoes.test.tsx: `jest.mock("../src/lib/api")`
// (automock) em vez de `jest.spyOn`, porque o SWC compila os exports de
// `lib/api.ts` para bindings não configuráveis.
jest.mock("../src/lib/api");

import type { ComponentProps } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShopeeSection } from "@/components/integracoes/ShopeeSection";
import * as api from "@/lib/api";
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

let routerReplace: jest.Mock;

function shopeeAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "shopee-1",
    marketplace: "SHOPEE",
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

const noopRenamePropsFor = (account: MarketplaceAccountDto) => ({
  currentNickname: account.nickname,
  secondaryLabel: account.id,
  onSave: async () => {},
});

function renderSection(
  props: Partial<ComponentProps<typeof ShopeeSection>> = {},
) {
  return render(
    <ShopeeSection
      accounts={props.accounts ?? []}
      loadError={props.loadError ?? false}
      onRefresh={props.onRefresh ?? jest.fn().mockResolvedValue(undefined)}
      renamePropsFor={props.renamePropsFor ?? noopRenamePropsFor}
    />,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSearchParams();
  usePathname.mockReturnValue("/integracoes");
  routerReplace = jest.fn();
  useRouter.mockReturnValue({ replace: routerReplace });
  (api.redirectTo as jest.Mock).mockImplementation(() => {});
});

describe("ShopeeSection — estados da conta", () => {
  it("1. shows a 'Conectar Shopee' button when disconnected/no account exists", () => {
    renderSection({ accounts: [] });

    expect(
      screen.getByRole("button", { name: /conectar shopee/i }),
    ).toBeEnabled();
    expect(screen.getByText("Status: Não conectado")).toBeInTheDocument();
  });

  it("2. shows the connected state for a CONNECTED account", () => {
    renderSection({
      accounts: [shopeeAccount({ status: "CONNECTED", nickname: "Loja X" })],
    });

    expect(screen.getByText("Status: Conectado")).toBeInTheDocument();
    expect(screen.getByText(/loja x/i)).toBeInTheDocument();
  });

  it("shows TOKEN_EXPIRED and ERROR with a 'Reconectar' action", () => {
    renderSection({
      accounts: [
        shopeeAccount({ id: "s1", status: "TOKEN_EXPIRED" }),
        shopeeAccount({ id: "s2", status: "ERROR" }),
      ],
    });

    expect(
      screen.getByText("Status: Token expirado — reconexão necessária"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Status: Erro — reconexão necessária"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^reconectar$/i }),
    ).toHaveLength(2);
  });

  it("6. supports multiple Shopee accounts side by side, each with its own status and button", () => {
    renderSection({
      accounts: [
        shopeeAccount({ id: "s1", nickname: "Loja 1", status: "CONNECTED" }),
        shopeeAccount({ id: "s2", nickname: "Loja 2", status: "DISCONNECTED" }),
      ],
    });

    const card1 = screen.getByTestId("marketplace-account-s1");
    const card2 = screen.getByTestId("marketplace-account-s2");
    expect(within(card1).getByText(/loja 1/i)).toBeInTheDocument();
    expect(within(card1).getByText("Status: Conectado")).toBeInTheDocument();
    expect(within(card2).getByText(/loja 2/i)).toBeInTheDocument();
    expect(within(card2).getByText("Status: Não conectado")).toBeInTheDocument();
  });
});

describe("ShopeeSection — conectar", () => {
  it("3. clicking connect creates the account (when absent) and calls connectShopee with the returned id, then redirects to the validated URL", async () => {
    (api.createMarketplaceAccount as jest.Mock).mockResolvedValue(
      shopeeAccount({ id: "shopee-new" }),
    );
    (api.connectShopee as jest.Mock).mockResolvedValue({
      authorizationUrl: "https://open.shopee.com.br/auth",
    });
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderSection({ accounts: [], onRefresh });

    await user.click(
      screen.getByRole("button", { name: /conectar shopee/i }),
    );

    await waitFor(() =>
      expect(api.createMarketplaceAccount).toHaveBeenCalledWith("SHOPEE"),
    );
    await waitFor(() =>
      expect(api.connectShopee).toHaveBeenCalledWith("shopee-new"),
    );
    expect(api.redirectTo).toHaveBeenCalledWith(
      "https://open.shopee.com.br/auth",
    );
  });

  it("clicking connect on an EXISTING account uses that account's own id directly (no account creation)", async () => {
    (api.connectShopee as jest.Mock).mockResolvedValue({
      authorizationUrl: "https://open.shopee.com.br/auth",
    });

    const user = userEvent.setup();
    renderSection({
      accounts: [shopeeAccount({ id: "shopee-existing", status: "DISCONNECTED" })],
    });

    const card = screen.getByTestId("marketplace-account-shopee-existing");
    await user.click(within(card).getByRole("button", { name: /conectar/i }));

    await waitFor(() =>
      expect(api.connectShopee).toHaveBeenCalledWith("shopee-existing"),
    );
    expect(api.createMarketplaceAccount).not.toHaveBeenCalled();
  });

  it("4. double-clicking the same account's connect button only calls connectShopee once", async () => {
    let resolveConnect!: (v: { authorizationUrl: string }) => void;
    (api.connectShopee as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );

    const user = userEvent.setup();
    renderSection({
      accounts: [shopeeAccount({ id: "shopee-1", status: "DISCONNECTED" })],
    });

    const card = screen.getByTestId("marketplace-account-shopee-1");
    const button = within(card).getByRole("button", { name: /conectar/i });
    await user.click(button);
    await user.click(button);

    expect(api.connectShopee).toHaveBeenCalledTimes(1);

    resolveConnect({ authorizationUrl: "https://open.shopee.com.br/auth" });
    await waitFor(() =>
      expect(api.redirectTo).toHaveBeenCalledWith(
        "https://open.shopee.com.br/auth",
      ),
    );
  });

  it('5. a 401/409/5xx failure from connectShopee shows a safe, generic message', async () => {
    const { ApiFetchError } = jest.requireActual(
      "../src/lib/api",
    ) as typeof api;
    (api.connectShopee as jest.Mock).mockRejectedValue(
      new ApiFetchError("Conflito interno detalhado do backend"),
    );

    const user = userEvent.setup();
    renderSection({
      accounts: [shopeeAccount({ id: "shopee-1", status: "DISCONNECTED" })],
    });

    const card = screen.getByTestId("marketplace-account-shopee-1");
    await user.click(within(card).getByRole("button", { name: /conectar/i }));

    expect(
      await screen.findByText(
        /não foi possível iniciar a conexão com a shopee/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/conflito interno detalhado do backend/i),
    ).not.toBeInTheDocument();
  });

  it("6. a host outside the allowlist in authorizationUrl is rejected and never redirected to", async () => {
    (api.connectShopee as jest.Mock).mockResolvedValue({
      authorizationUrl: "https://open.shopee.com.br.evil.com/auth",
    });

    const user = userEvent.setup();
    renderSection({
      accounts: [shopeeAccount({ id: "shopee-1", status: "DISCONNECTED" })],
    });

    const card = screen.getByTestId("marketplace-account-shopee-1");
    await user.click(within(card).getByRole("button", { name: /conectar/i }));

    expect(
      await screen.findByText(
        /não foi possível iniciar a conexão com a shopee/i,
      ),
    ).toBeInTheDocument();
    expect(api.redirectTo).not.toHaveBeenCalled();
  });
});

describe("ShopeeSection — CP2E-R1: nunca duplica conta vazia após falha de conexão", () => {
  it("first attempt creates the account and fails to connect; second attempt reconnects the SAME id without creating another account", async () => {
    (api.createMarketplaceAccount as jest.Mock).mockResolvedValue(
      shopeeAccount({ id: "shopee-pending" }),
    );
    (api.connectShopee as jest.Mock)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        authorizationUrl: "https://open.shopee.com.br/auth",
      });
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    const user = userEvent.setup();
    const { rerender } = renderSection({ accounts: [], onRefresh });

    // Tentativa 1: cria a conta, connect falha.
    await user.click(
      screen.getByRole("button", { name: /conectar shopee/i }),
    );
    await waitFor(() =>
      expect(api.connectShopee).toHaveBeenNthCalledWith(1, "shopee-pending"),
    );
    expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(1);
    await screen.findByText(/não foi possível iniciar a conexão/i);

    // A lista real (via onRefresh) não teria sido atualizada nesta simulação
    // (`accounts` prop segue vazia) — mesmo assim, a próxima tentativa via
    // "Conectar Shopee" reutiliza o id pendente, sem criar outra conta.
    rerender(
      <ShopeeSection
        accounts={[]}
        loadError={false}
        onRefresh={onRefresh}
        renamePropsFor={noopRenamePropsFor}
      />,
    );

    // Tentativa 2: reconecta com o MESMO id, sem criar outra conta.
    await user.click(
      screen.getByRole("button", { name: /conectar shopee/i }),
    );
    await waitFor(() =>
      expect(api.connectShopee).toHaveBeenNthCalledWith(2, "shopee-pending"),
    );
    expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(1);
    expect(api.redirectTo).toHaveBeenCalledWith(
      "https://open.shopee.com.br/auth",
    );
  });

  it("also reuses the same pending id when the FAILURE is the authorizationUrl allowlist validation (not a rejected promise)", async () => {
    (api.createMarketplaceAccount as jest.Mock).mockResolvedValue(
      shopeeAccount({ id: "shopee-pending" }),
    );
    (api.connectShopee as jest.Mock)
      .mockResolvedValueOnce({
        authorizationUrl: "https://open.shopee.com.br.evil.com/auth",
      })
      .mockResolvedValueOnce({
        authorizationUrl: "https://open.shopee.com.br/auth",
      });
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderSection({ accounts: [], onRefresh });

    await user.click(
      screen.getByRole("button", { name: /conectar shopee/i }),
    );
    await screen.findByText(/não foi possível iniciar a conexão/i);
    expect(api.redirectTo).not.toHaveBeenCalled();
    expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole("button", { name: /conectar shopee/i }),
    );
    await waitFor(() =>
      expect(api.connectShopee).toHaveBeenNthCalledWith(2, "shopee-pending"),
    );
    expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(1);
    expect(api.redirectTo).toHaveBeenCalledWith(
      "https://open.shopee.com.br/auth",
    );
  });

  it("once the pending account is confirmed present in `accounts`, 'Adicionar outra conta' creates a genuinely NEW account", async () => {
    (api.createMarketplaceAccount as jest.Mock)
      .mockResolvedValueOnce(shopeeAccount({ id: "shopee-1" }))
      .mockResolvedValueOnce(shopeeAccount({ id: "shopee-2" }));
    (api.connectShopee as jest.Mock).mockResolvedValue({
      authorizationUrl: "https://open.shopee.com.br/auth",
    });

    const user = userEvent.setup();
    const { rerender } = renderSection({ accounts: [] });

    await user.click(
      screen.getByRole("button", { name: /conectar shopee/i }),
    );
    await waitFor(() =>
      expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(1),
    );

    // Simula o refresh real trazendo a conta recém-criada de volta — a
    // partir daqui ela está "confirmada" na lista.
    rerender(
      <ShopeeSection
        accounts={[shopeeAccount({ id: "shopee-1", status: "CONNECTED" })]}
        loadError={false}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
        renamePropsFor={noopRenamePropsFor}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /adicionar outra conta/i }),
    );
    await waitFor(() =>
      expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(api.connectShopee).toHaveBeenCalledWith("shopee-2"),
    );
  });
});

describe("ShopeeSection — callback (shopee/reason)", () => {
  it("7. shopee=success shows a success message and refreshes the account list", async () => {
    mockSearchParams({ shopee: "success" });
    const onRefresh = jest.fn().mockResolvedValue(undefined);

    renderSection({ accounts: [], onRefresh });

    expect(
      await screen.findByText("Conta da Shopee conectada com sucesso."),
    ).toBeInTheDocument();
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it.each([
    [
      "OAUTH_CALLBACK_INVALID",
      "O link de retorno da Shopee é inválido ou expirou. Tente conectar novamente.",
    ],
    [
      "CONNECTION_FAILED",
      "Não foi possível concluir a conexão com a Shopee agora. Tente novamente.",
    ],
    [
      "CONNECTION_BUSY",
      "Esta conta está processando outra operação agora. Tente novamente em instantes.",
    ],
  ])("8. shopee=error&reason=%s shows its fixed message", async (reason, expected) => {
    mockSearchParams({ shopee: "error", reason });

    renderSection({ accounts: [] });

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it("9. an unrecognized reason is never shown directly — falls back to the fixed generic message (CP2E-R1)", async () => {
    mockSearchParams({ shopee: "error", reason: "SOME_INTERNAL_CODE" });

    renderSection({ accounts: [] });

    expect(
      await screen.findByText(
        "Não foi possível conectar a conta da Shopee. Tente novamente.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/SOME_INTERNAL_CODE/)).not.toBeInTheDocument();
    await waitFor(() => expect(routerReplace).toHaveBeenCalled());
  });

  it("9b. shopee=error with NO reason also falls back to the fixed generic message (CP2E-R1)", async () => {
    mockSearchParams({ shopee: "error" });

    renderSection({ accounts: [] });

    expect(
      await screen.findByText(
        "Não foi possível conectar a conta da Shopee. Tente novamente.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(routerReplace).toHaveBeenCalled());
  });

  it("9c. an unrecognized reason still removes shopee/reason from the URL, preserving other params", async () => {
    mockSearchParams({ shopee: "error", reason: "SOME_INTERNAL_CODE", tab: "kpis" });

    renderSection({ accounts: [] });

    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith("/integracoes?tab=kpis", {
        scroll: false,
      }),
    );
  });

  it("10. removes shopee/reason from the URL after processing, preserving other legitimate params", async () => {
    mockSearchParams({ shopee: "success", tab: "kpis" });

    renderSection({ accounts: [] });

    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith("/integracoes?tab=kpis", {
        scroll: false,
      }),
    );
  });

  it("removes shopee/reason from the URL and leaves a bare path when there is nothing else to preserve", async () => {
    mockSearchParams({ shopee: "error", reason: "CONNECTION_BUSY" });

    renderSection({ accounts: [] });

    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith("/integracoes", {
        scroll: false,
      }),
    );
  });

  it("11. never renders code/state/authorizationUrl in the DOM for a successful callback", async () => {
    mockSearchParams({
      shopee: "success",
      state: "should-never-be-read-by-this-component",
    });

    renderSection({ accounts: [] });

    await screen.findByText("Conta da Shopee conectada com sucesso.");
    expect(document.body.innerHTML).not.toMatch(
      /should-never-be-read-by-this-component/,
    );
  });
});
