import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { ShopeeSection } from "./ShopeeSection";
import type { MarketplaceAccountDto } from "@/types/marketplace";

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock("../../lib/api", () => {
  const actual = jest.requireActual("../../lib/api");
  return {
    ...actual,
    connectShopee: jest.fn(),
    createMarketplaceAccount: jest.fn(),
    disconnectMarketplaceAccount: jest.fn(),
    redirectTo: jest.fn(),
  };
});

const api = jest.requireMock("../../lib/api") as {
  connectShopee: jest.Mock;
  createMarketplaceAccount: jest.Mock;
  disconnectMarketplaceAccount: jest.Mock;
  redirectTo: jest.Mock;
};

function shopeeAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "shopee-1",
    marketplace: "SHOPEE",
    externalSellerId: "227899344",
    nickname: null,
    status: "CONNECTED",
    recoveryHint: null,
    nextRetryAt: null,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renamePropsFor(account: MarketplaceAccountDto) {
  return {
    currentNickname: account.nickname,
    secondaryLabel: account.externalSellerId
      ? `ID: ${account.externalSellerId}`
      : `ID interno: ${account.id.slice(0, 8)}`,
    onSave: jest.fn(),
  };
}

function renderSection(
  accounts: MarketplaceAccountDto[],
  onRefresh: () => Promise<void> = jest.fn().mockResolvedValue(undefined),
) {
  return render(
    <ShopeeSection
      accounts={accounts}
      loadError={false}
      onRefresh={onRefresh}
      renamePropsFor={renamePropsFor}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  (usePathname as jest.Mock).mockReturnValue("/integracoes");
  (useRouter as jest.Mock).mockReturnValue({ replace: jest.fn() });
  jest.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ShopeeSection — desconexão segura", () => {
  it("mostra o botão Desconectar para uma conta CONNECTED", () => {
    renderSection([shopeeAccount({ status: "CONNECTED" })]);
    expect(
      screen.getByRole("button", { name: "Desconectar" }),
    ).toBeInTheDocument();
  });

  it("não mostra o botão Desconectar para uma conta DISCONNECTED", () => {
    renderSection([shopeeAccount({ status: "DISCONNECTED" })]);
    expect(
      screen.queryByRole("button", { name: "Desconectar" }),
    ).not.toBeInTheDocument();
  });

  it("cancelar a confirmação não chama a API", () => {
    jest.spyOn(window, "confirm").mockReturnValue(false);
    renderSection([shopeeAccount({ status: "CONNECTED" })]);

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));

    expect(api.disconnectMarketplaceAccount).not.toHaveBeenCalled();
  });

  it("confirmar chama o endpoint com o account.id correto", async () => {
    api.disconnectMarketplaceAccount.mockResolvedValue(
      shopeeAccount({ status: "DISCONNECTED" }),
    );
    renderSection([shopeeAccount({ id: "shopee-42", status: "CONNECTED" })]);

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));

    await waitFor(() =>
      expect(api.disconnectMarketplaceAccount).toHaveBeenCalledWith(
        "shopee-42",
      ),
    );
  });

  it("durante a requisição, o botão Desconectar fica desabilitado", async () => {
    let resolveDisconnect!: (value: MarketplaceAccountDto) => void;
    api.disconnectMarketplaceAccount.mockReturnValue(
      new Promise((resolve) => {
        resolveDisconnect = resolve;
      }),
    );
    renderSection([shopeeAccount({ status: "CONNECTED" })]);

    const button = screen.getByRole("button", { name: "Desconectar" });
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());

    resolveDisconnect(shopeeAccount({ status: "DISCONNECTED" }));
    await waitFor(() => expect(api.disconnectMarketplaceAccount).toHaveBeenCalled());
  });

  it("após sucesso, recarrega a lista de contas", async () => {
    api.disconnectMarketplaceAccount.mockResolvedValue(
      shopeeAccount({ status: "DISCONNECTED" }),
    );
    const onRefresh = jest.fn().mockResolvedValue(undefined);
    renderSection([shopeeAccount({ status: "CONNECTED" })], onRefresh);

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("falha na desconexão mostra mensagem segura e não inicia OAuth", async () => {
    api.disconnectMarketplaceAccount.mockRejectedValue(new Error("boom"));
    renderSection([shopeeAccount({ status: "CONNECTED" })]);

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));

    expect(
      await screen.findByText(
        "Não foi possível desconectar esta conta. Tente novamente.",
      ),
    ).toBeInTheDocument();
    expect(api.connectShopee).not.toHaveBeenCalled();
    expect(api.redirectTo).not.toHaveBeenCalled();
  });

  it('"Adicionar outra conta" continua funcionando', async () => {
    api.createMarketplaceAccount.mockResolvedValue(
      shopeeAccount({ id: "shopee-novo", status: "DISCONNECTED" }),
    );
    api.connectShopee.mockResolvedValue({
      authorizationUrl: "https://open.shopee.com.br/auth",
    });
    renderSection([shopeeAccount({ id: "shopee-1", status: "CONNECTED" })]);

    fireEvent.click(screen.getByRole("button", { name: "Adicionar outra conta" }));

    await waitFor(() =>
      expect(api.createMarketplaceAccount).toHaveBeenCalledWith("SHOPEE"),
    );
    await waitFor(() => expect(api.redirectTo).toHaveBeenCalledTimes(1));
  });

  it('"Reconectar" continua chamando connectShopee sem alteração de comportamento', async () => {
    api.connectShopee.mockResolvedValue({
      authorizationUrl: "https://open.shopee.com.br/auth",
    });
    renderSection([shopeeAccount({ id: "shopee-1", status: "CONNECTED" })]);

    fireEvent.click(screen.getByRole("button", { name: "Reconectar" }));

    await waitFor(() =>
      expect(api.connectShopee).toHaveBeenCalledWith("shopee-1"),
    );
  });
});
