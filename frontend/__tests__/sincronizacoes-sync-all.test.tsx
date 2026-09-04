// Mesma divergência documentada em integracoes.test.tsx: `jest.mock` de
// `lib/api` (automock) em vez de `jest.spyOn`, porque o transform SWC deste
// projeto torna os exports nomeados não configuráveis para `spyOn`. Um
// arquivo SEPARADO de sincronizacoes.test.tsx: aquele usa `global.fetch`
// bruto (via `apiFetch` real) para testar o histórico; misturar os dois
// estilos no mesmo arquivo quebraria um dos dois, já que `jest.mock` é
// aplicado ao módulo inteiro.
jest.mock("../src/lib/api");

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";
import * as api from "@/lib/api";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto } from "@/types/marketplace";

function mlAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "ml-1",
    marketplace: "MERCADO_LIVRE",
    externalSellerId: "111",
    nickname: "Meli 1",
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

function amazonAccount(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "amz-1",
    marketplace: "AMAZON",
    externalSellerId: "A1SELLER",
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
  (api.apiFetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
  });
  (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
    amazonSetupStatus(),
  );
});

describe("SincronizacoesPage — Sincronizar todas as lojas", () => {
  it("lists two connected Mercado Livre accounts as PENDING and syncs both via the button", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1", nickname: "Meli 1" }),
      mlAccount({ id: "ml-2", nickname: "Meli 2" }),
    ]);
    (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({});

    const user = userEvent.setup();
    render(<SincronizacoesPage />);

    await screen.findByTestId("sync-all-row-ml-1");
    await screen.findByTestId("sync-all-row-ml-2");

    await user.click(
      screen.getByRole("button", { name: /sincronizar todas as lojas/i }),
    );

    await waitFor(() => {
      expect(api.syncMercadoLivreOrders).toHaveBeenCalledWith("ml-1");
      expect(api.syncMercadoLivreOrders).toHaveBeenCalledWith("ml-2");
    });

    await waitFor(() => {
      expect(
        within(screen.getByTestId("sync-all-row-ml-1")).getByText(
          "Sincronizada",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("sync-all-row-ml-2")).getByText(
          "Sincronizada",
        ),
      ).toBeInTheDocument();
    });
  });

  it("never mixes tokens/orders across accounts — each account is synced through its own id", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
      mlAccount({ id: "ml-2" }),
    ]);
    (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({});

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    await screen.findByTestId("sync-all-row-ml-1");

    await user.click(
      screen.getByRole("button", { name: /sincronizar todas as lojas/i }),
    );

    await waitFor(() =>
      expect(api.syncMercadoLivreOrders).toHaveBeenCalledTimes(2),
    );
    const calledIds = (api.syncMercadoLivreOrders as jest.Mock).mock.calls.map(
      (call) => call[0],
    );
    expect(new Set(calledIds).size).toBe(2);
  });

  it("one account failing does not stop the other from completing", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-fails" }),
      mlAccount({ id: "ml-ok" }),
    ]);
    (api.syncMercadoLivreOrders as jest.Mock).mockImplementation(
      (accountId: string) =>
        accountId === "ml-fails"
          ? Promise.reject(new Error("boom"))
          : Promise.resolve({}),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    await screen.findByTestId("sync-all-row-ml-fails");

    await user.click(
      screen.getByRole("button", { name: /sincronizar todas as lojas/i }),
    );

    await waitFor(() => {
      expect(
        within(screen.getByTestId("sync-all-row-ml-fails")).getByText(
          "Falhou",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("sync-all-row-ml-ok")).getByText(
          "Sincronizada",
        ),
      ).toBeInTheDocument();
    });
  });

  it("shows progress while syncing (Sincronizando N de M)", async () => {
    let resolveFirst!: () => void;
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
      mlAccount({ id: "ml-2" }),
    ]);
    (api.syncMercadoLivreOrders as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({});
        }),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    await screen.findByTestId("sync-all-row-ml-1");

    await user.click(
      screen.getByRole("button", { name: /sincronizar todas as lojas/i }),
    );

    expect(
      await screen.findByRole("button", { name: /sincronizando 1 de 2/i }),
    ).toBeInTheDocument();

    resolveFirst();
  });

  it("ignores an Amazon account with a sanitized reason when the Amazon application is not configured", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([]);
    (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
      amazonSetupStatus({
        applicationConfigured: false,
        accounts: [amazonAccount({ id: "amz-1" })],
      }),
    );

    render(<SincronizacoesPage />);

    const row = await screen.findByTestId("sync-all-row-amz-1");
    expect(within(row).getByText("Ignorada")).toBeInTheDocument();
    expect(
      within(row).getByText(/integração amazon não configurada/i),
    ).toBeInTheDocument();
    expect(api.syncAmazonOrders).not.toHaveBeenCalled();
  });

  it("ignores a disconnected account with a sanitized reason instead of attempting it", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1", status: "DISCONNECTED" }),
    ]);

    render(<SincronizacoesPage />);

    const row = await screen.findByTestId("sync-all-row-ml-1");
    expect(within(row).getByText("Ignorada")).toBeInTheDocument();
    expect(api.syncMercadoLivreOrders).not.toHaveBeenCalled();
  });

  it("disables the button when there is nothing eligible to sync", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1", status: "DISCONNECTED" }),
    ]);

    render(<SincronizacoesPage />);
    await screen.findByTestId("sync-all-row-ml-1");

    expect(
      screen.getByRole("button", { name: /sincronizar todas as lojas/i }),
    ).toBeDisabled();
  });

  it("reloads the sync-runs history only after the whole batch finishes, not per account", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
      mlAccount({ id: "ml-2" }),
    ]);
    (api.syncMercadoLivreOrders as jest.Mock).mockResolvedValue({});

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    await screen.findByTestId("sync-all-row-ml-1");

    const callsBeforeSync = (api.apiFetch as jest.Mock).mock.calls.length;

    await user.click(
      screen.getByRole("button", { name: /sincronizar todas as lojas/i }),
    );

    await waitFor(() =>
      expect(api.syncMercadoLivreOrders).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect((api.apiFetch as jest.Mock).mock.calls.length).toBe(
        callsBeforeSync + 1,
      ),
    );
  });
});
