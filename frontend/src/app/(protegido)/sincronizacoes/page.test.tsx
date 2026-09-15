import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SincronizacoesPage from "./page";
import { ApiFetchError } from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { BackfillStatusDto } from "@/types/marketplace-backfill";

// `jest.mock`/`jest.requireActual` resolvem o próprio argumento fora do
// pipeline de transform do Next — por isso é preciso caminho relativo real
// para `src/lib/api.ts` (mesmo padrão de dashboard/page.test.tsx).
jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return {
    ...actual,
    apiFetch: jest.fn(),
    fetchMarketplaceAccounts: jest.fn(),
    fetchAmazonSetupStatus: jest.fn(),
    fetchBackfillStatus: jest.fn(),
    syncMercadoLivreOrders: jest.fn(),
    syncAmazonOrders: jest.fn(),
    syncShopeeOrders: jest.fn(),
  };
});

const api = jest.requireMock("../../../lib/api") as {
  apiFetch: jest.Mock;
  fetchMarketplaceAccounts: jest.Mock;
  fetchAmazonSetupStatus: jest.Mock;
  fetchBackfillStatus: jest.Mock;
  syncMercadoLivreOrders: jest.Mock;
  syncAmazonOrders: jest.Mock;
  syncShopeeOrders: jest.Mock;
};

function account(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "shopee-1",
    marketplace: "SHOPEE",
    externalSellerId: "999",
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
    canVerify: true,
    canSynchronize: true,
    ...overrides,
  };
}

function backfillStatus(
  overrides: Partial<BackfillStatusDto> = {},
): BackfillStatusDto {
  return {
    status: "NOT_STARTED",
    oldestCoveredAt: null,
    firstOrderAt: null,
    lastOrderAt: null,
    synchronizedIntervals: [],
    lastProcessedChunk: null,
    lastRunErrorCode: null,
    job: null,
    workerEnabled: false,
    ...overrides,
  };
}

function mockEmptySyncRuns() {
  api.apiFetch.mockResolvedValue({
    ok: true,
    json: async () => [],
  } as unknown as Response);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEmptySyncRuns();
  api.fetchAmazonSetupStatus.mockResolvedValue(amazonSetupStatus());
  api.fetchBackfillStatus.mockResolvedValue(backfillStatus());
});

describe("SincronizacoesPage — contas Shopee", () => {
  it("mostra conta Shopee CONNECTED na lista de sincronização manual", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValueOnce([
      account({ nickname: "Loja Principal" }),
    ]);

    render(<SincronizacoesPage />);

    expect(
      await screen.findByText("Shopee — Loja Principal"),
    ).toBeInTheDocument();
  });

  it("marca conta Shopee não conectada como ignorada e não a sincroniza", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValueOnce([
      account({ status: "TOKEN_EXPIRED" }),
    ]);

    render(<SincronizacoesPage />);

    await screen.findByText(/Shopee — /);
    expect(screen.getByText("Ignorada")).toBeInTheDocument();
    expect(
      screen.getByText(/Conta não conectada à Shopee\./),
    ).toBeInTheDocument();

    const button = screen.getByRole("button", {
      name: "Sincronizar todas as lojas",
    });
    expect(button).toBeDisabled();
  });

  it("chama syncShopeeOrders para a conta Shopee elegível ao clicar em sincronizar todas", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValueOnce([account()]);
    api.syncShopeeOrders.mockResolvedValueOnce({ status: "SUCCESS" });

    const user = userEvent.setup();
    render(<SincronizacoesPage />);

    const button = await screen.findByRole("button", {
      name: "Sincronizar todas as lojas",
    });
    await user.click(button);

    await waitFor(() => expect(api.syncShopeeOrders).toHaveBeenCalledTimes(1));
    expect(api.syncShopeeOrders).toHaveBeenCalledWith("shopee-1");
  });

  it("isola falha da Shopee sem impedir sincronização de ML e Amazon", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValueOnce([
      account(),
      account({
        id: "ml-1",
        marketplace: "MERCADO_LIVRE",
        nickname: "ML Loja",
      }),
    ]);
    api.fetchAmazonSetupStatus.mockResolvedValue(
      amazonSetupStatus({
        accounts: [
          account({
            id: "amz-1",
            marketplace: "AMAZON",
            nickname: "Amazon Loja",
          }),
        ],
      }),
    );
    api.syncShopeeOrders.mockRejectedValueOnce(
      new ApiFetchError(
        "Já existe uma sincronização em andamento para esta conta.",
        "SYNC_ALREADY_RUNNING",
      ),
    );
    api.syncMercadoLivreOrders.mockResolvedValueOnce({ status: "SUCCESS" });
    api.syncAmazonOrders.mockResolvedValueOnce({ status: "SUCCESS" });

    const user = userEvent.setup();
    render(<SincronizacoesPage />);

    const button = await screen.findByRole("button", {
      name: "Sincronizar todas as lojas",
    });
    await user.click(button);

    await waitFor(() => {
      expect(api.syncShopeeOrders).toHaveBeenCalledTimes(1);
      expect(api.syncMercadoLivreOrders).toHaveBeenCalledTimes(1);
      expect(api.syncAmazonOrders).toHaveBeenCalledTimes(1);
    });

    expect(
      await screen.findByText(
        /Já existe uma sincronização em andamento para esta conta\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Sincronizada")).toHaveLength(2);
    expect(screen.getByText("Falhou")).toBeInTheDocument();
  });

  it("mostra mensagem em português para cada código público de erro da Shopee", async () => {
    const cases: Array<[string, string]> = [
      ["NOT_CONNECTED", "Esta conta não está mais conectada."],
      ["CONNECTION_BUSY", "Esta conta está processando outra operação agora."],
      ["NOT_CONFIGURED", "Integração Shopee não configurada no servidor."],
      ["DATA_UNAVAILABLE", "O marketplace retornou uma resposta inesperada."],
      [
        "TEMPORARILY_UNAVAILABLE",
        "O marketplace está indisponível no momento.",
      ],
      [
        "SYNC_ALREADY_RUNNING",
        "Já existe uma sincronização em andamento para esta conta.",
      ],
      ["SYNC_FAILED", "Falha ao consultar o marketplace."],
    ];

    for (const [code, expectedFragment] of cases) {
      jest.clearAllMocks();
      mockEmptySyncRuns();
      api.fetchAmazonSetupStatus.mockResolvedValue(amazonSetupStatus());
      api.fetchBackfillStatus.mockResolvedValue(backfillStatus());
      api.fetchMarketplaceAccounts.mockResolvedValueOnce([account()]);
      api.syncShopeeOrders.mockRejectedValueOnce(
        new ApiFetchError("mensagem crua ignorada", code),
      );

      const user = userEvent.setup();
      const { unmount } = render(<SincronizacoesPage />);

      const button = await screen.findByRole("button", {
        name: "Sincronizar todas as lojas",
      });
      await user.click(button);

      expect(
        await screen.findByText(
          new RegExp(expectedFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        ),
      ).toBeInTheDocument();

      unmount();
    }
  });

  it("recarrega o histórico de SyncRun ao final da sincronização em lote", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValueOnce([account()]);
    api.syncShopeeOrders.mockResolvedValueOnce({ status: "SUCCESS" });

    const user = userEvent.setup();
    render(<SincronizacoesPage />);

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(1));

    const button = await screen.findByRole("button", {
      name: "Sincronizar todas as lojas",
    });
    await user.click(button);

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(2));
    expect(api.apiFetch).toHaveBeenLastCalledWith("/sync-runs", {
      method: "GET",
    });
  });

  it("não bloqueia contas Shopee por /integrations/amazon/setup-status e não duplica contas", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValueOnce([account()]);
    api.fetchAmazonSetupStatus.mockResolvedValue(
      amazonSetupStatus({ applicationConfigured: false }),
    );

    render(<SincronizacoesPage />);

    await screen.findByText("Shopee — Conta 999");
    expect(screen.getAllByText(/Shopee —/)).toHaveLength(1);
    expect(screen.getByText("Aguardando")).toBeInTheDocument();
  });

  it("mantém contas ML e Amazon inalteradas quando não há conta Shopee", async () => {
    api.fetchMarketplaceAccounts.mockResolvedValueOnce([
      account({
        id: "ml-1",
        marketplace: "MERCADO_LIVRE",
        nickname: "ML Loja",
      }),
    ]);
    api.fetchAmazonSetupStatus.mockResolvedValue(
      amazonSetupStatus({
        accounts: [
          account({
            id: "amz-1",
            marketplace: "AMAZON",
            nickname: "Amazon Loja",
          }),
        ],
      }),
    );

    render(<SincronizacoesPage />);

    expect(
      await screen.findByText("Mercado Livre — ML Loja"),
    ).toBeInTheDocument();
    expect(screen.getByText("Amazon — Amazon Loja")).toBeInTheDocument();
    expect(screen.queryByText(/Shopee —/)).not.toBeInTheDocument();
  });
});
