// Mesmo padrão de automock documentado em sincronizacoes-backfill.test.tsx.
jest.mock("../src/lib/api");

const routerReplaceMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: jest.fn() }),
}));

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";
import * as api from "@/lib/api";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { MlLogisticsReclassificationAccountStatusDto } from "@/types/ml-logistics-reclassification";

/**
 * `jest.mock("../src/lib/api")` automocka a classe `ApiFetchError` — `new
 * api.ApiFetchError(...)` no automock não roda o construtor real (não seta
 * `message`/`code`). Reconstrói uma instância que passa em `instanceof
 * ApiFetchError` com as propriedades reais que a página lê (mesmo padrão
 * documentado em sincronizacoes-backfill.test.tsx).
 */
function fakeApiFetchError(message: string, code?: string): Error {
  const error = new Error(message);
  Object.setPrototypeOf(error, api.ApiFetchError.prototype);
  Object.assign(error, { code, name: "ApiFetchError" });
  return error;
}

function account(
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

function amazonSetupStatus(): AmazonSetupStatusDto {
  return {
    applicationConfigured: true,
    missingConfigurationKeys: [],
    hasAccount: false,
    accounts: [],
    canProvision: true,
    canVerify: false,
    canSynchronize: false,
  };
}

function mlReclassStatus(
  overrides: Partial<MlLogisticsReclassificationAccountStatusDto> = {},
): MlLogisticsReclassificationAccountStatusDto {
  return {
    accountId: "ml-1",
    nickname: "Meli 1",
    status: "IDLE",
    initialUnknownCount: 0,
    remainingUnknownCount: 0,
    resolvedFullCount: 0,
    resolvedNotFullCount: 0,
    callsMadeCount: 0,
    lastActivityAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    pauseRequested: false,
    workerEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  routerReplaceMock.mockClear();
  (api.apiFetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
  });
  (api.fetchAmazonSetupStatus as jest.Mock).mockResolvedValue(
    amazonSetupStatus(),
  );
  (api.fetchBackfillStatus as jest.Mock).mockResolvedValue({
    status: "NOT_STARTED",
    oldestCoveredAt: null,
    firstOrderAt: null,
    lastOrderAt: null,
    synchronizedIntervals: [],
    lastProcessedChunk: null,
    lastRunErrorCode: null,
    job: null,
    workerEnabled: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SincronizacoesPage — Corrigir histórico Full do Mercado Livre", () => {
  it("shows the section heading, distinct from 'Completar histórico', with progress fields", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
      mlReclassStatus({
        status: "RUNNING",
        initialUnknownCount: 100,
        remainingUnknownCount: 60,
        resolvedFullCount: 30,
        resolvedNotFullCount: 10,
      }),
    );

    render(<SincronizacoesPage />);

    expect(
      await screen.findByRole("heading", {
        name: "Corrigir histórico Full do Mercado Livre",
      }),
    ).toBeInTheDocument();
    const panel = await screen.findByTestId(
      "ml-logistics-reclassification-panel-Meli 1",
    );
    expect(within(panel).getByText("40%")).toBeInTheDocument();
    expect(within(panel).getByText("100")).toBeInTheDocument();
    expect(within(panel).getByText("60")).toBeInTheDocument();
    expect(within(panel).getByText("30")).toBeInTheDocument();
    expect(within(panel).getByText("10")).toBeInTheDocument();
  });

  it("never shows Shopee/Amazon accounts in this section — Mercado Livre only", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1" }),
      account({ id: "shopee-1", marketplace: "SHOPEE", nickname: "Shopee 1" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
      mlReclassStatus(),
    );

    render(<SincronizacoesPage />);
    await screen.findByTestId("ml-logistics-reclassification-panel-Meli 1");
    expect(
      screen.queryByTestId("ml-logistics-reclassification-panel-Shopee 1"),
    ).not.toBeInTheDocument();
    expect(api.fetchMlLogisticsReclassificationStatus).not.toHaveBeenCalledWith(
      "shopee-1",
    );
  });

  it('clicking "Iniciar" on an IDLE account calls startMlLogisticsReclassification and reflects the returned status', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "IDLE", remainingUnknownCount: 50 }),
    );
    (api.startMlLogisticsReclassification as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "RUNNING", initialUnknownCount: 50 }),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId(
      "ml-logistics-reclassification-panel-Meli 1",
    );
    await user.click(within(panel).getByRole("button", { name: "Iniciar" }));

    expect(api.startMlLogisticsReclassification).toHaveBeenCalledWith("ml-1");
    expect(
      await within(panel).findByText("Corrigindo histórico..."),
    ).toBeInTheDocument();
  });

  it('clicking "Pausar" calls pauseMlLogisticsReclassification and reflects the returned status', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "RUNNING" }),
    );
    (api.pauseMlLogisticsReclassification as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "PAUSED" }),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId(
      "ml-logistics-reclassification-panel-Meli 1",
    );
    await user.click(within(panel).getByRole("button", { name: "Pausar" }));

    expect(api.pauseMlLogisticsReclassification).toHaveBeenCalledWith("ml-1");
    expect(await within(panel).findByText("Pausado")).toBeInTheDocument();
  });

  it('clicking "Retomar" on a FAILED_AUTH account calls resumeMlLogisticsReclassification', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "FAILED_AUTH", lastErrorCode: "ABORTED_UNAUTHORIZED" }),
    );
    (api.resumeMlLogisticsReclassification as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "RUNNING" }),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId(
      "ml-logistics-reclassification-panel-Meli 1",
    );
    expect(
      within(panel).getByText(/reconecte a conta/i),
    ).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Retomar" }));

    expect(api.resumeMlLogisticsReclassification).toHaveBeenCalledWith("ml-1");
  });

  it('"Corrigir histórico Full de todas as lojas" calls startAllMlLogisticsReclassification once, for both accounts', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1", nickname: "Meli 1" }),
      account({ id: "ml-2", nickname: "Meli 2" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
      mlReclassStatus(),
    );
    (api.startAllMlLogisticsReclassification as jest.Mock).mockResolvedValue([
      mlReclassStatus({ accountId: "ml-1", status: "RUNNING" }),
      mlReclassStatus({ accountId: "ml-2", status: "RUNNING" }),
    ]);

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    await screen.findByTestId("ml-logistics-reclassification-panel-Meli 1");

    await user.click(
      screen.getByRole("button", {
        name: "Corrigir histórico Full de todas as lojas",
      }),
    );

    expect(api.startAllMlLogisticsReclassification).toHaveBeenCalledTimes(1);
  });

  it("polls the status endpoint periodically while RUNNING, and stops once COMPLETED", async () => {
    jest.useFakeTimers();
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock)
      .mockResolvedValueOnce(
        mlReclassStatus({ status: "RUNNING", resolvedFullCount: 1 }),
      )
      .mockResolvedValue(
        mlReclassStatus({ status: "COMPLETED", resolvedFullCount: 9 }),
      );

    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId(
      "ml-logistics-reclassification-panel-Meli 1",
    );
    expect(within(panel).getByText("1")).toBeInTheDocument();

    const callsBefore = (
      api.fetchMlLogisticsReclassificationStatus as jest.Mock
    ).mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });

    await waitFor(() =>
      expect(
        (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mock.calls
          .length,
      ).toBeGreaterThan(callsBefore),
    );
    expect(await within(panel).findByText("9")).toBeInTheDocument();

    const callsAfterCompleted = (
      api.fetchMlLogisticsReclassificationStatus as jest.Mock
    ).mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(
      (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mock.calls
        .length,
    ).toBe(callsAfterCompleted);
  });

  it("never triggers syncMercadoLivreOrders or startBackfill — independent flow", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      account({ id: "ml-1" }),
    ]);
    (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "IDLE", remainingUnknownCount: 10 }),
    );
    (api.startMlLogisticsReclassification as jest.Mock).mockResolvedValue(
      mlReclassStatus({ status: "RUNNING" }),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId(
      "ml-logistics-reclassification-panel-Meli 1",
    );
    await user.click(within(panel).getByRole("button", { name: "Iniciar" }));

    expect(api.syncMercadoLivreOrders).not.toHaveBeenCalled();
    expect(api.startBackfill).not.toHaveBeenCalled();
  });

  describe("resiliência a cold start do Render / falha temporária de polling", () => {
    it("preserva o último status válido e mostra o aviso não bloqueante quando a consulta falha por rede", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        account({ id: "ml-1" }),
      ]);
      (api.fetchMlLogisticsReclassificationStatus as jest.Mock)
        .mockResolvedValueOnce(
          mlReclassStatus({ status: "RUNNING", resolvedFullCount: 5 }),
        )
        .mockRejectedValueOnce(fakeApiFetchError("Falha de conexão."));

      render(<SincronizacoesPage />);
      const panel = await screen.findByTestId(
        "ml-logistics-reclassification-panel-Meli 1",
      );
      expect(within(panel).getByText("5")).toBeInTheDocument();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });

      // Último status válido continua na tela — nunca some/zera.
      expect(within(panel).getByText("5")).toBeInTheDocument();
      expect(
        screen.getByText(/conexão temporariamente indisponível/i),
      ).toBeInTheDocument();
      // Nunca a mensagem bloqueante de "não foi possível carregar" — já
      // existe um status válido para esta conta.
      expect(
        within(panel).queryByText(/não foi possível carregar/i),
      ).not.toBeInTheDocument();
    });

    it("recupera o polling automaticamente com backoff limitado, sem depender de atualização manual", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        account({ id: "ml-1" }),
      ]);
      (api.fetchMlLogisticsReclassificationStatus as jest.Mock)
        .mockResolvedValueOnce(mlReclassStatus({ status: "RUNNING" }))
        .mockRejectedValueOnce(fakeApiFetchError("Falha de conexão."))
        .mockRejectedValueOnce(fakeApiFetchError("Falha de conexão."))
        .mockResolvedValue(
          mlReclassStatus({ status: "RUNNING", resolvedFullCount: 7 }),
        );

      render(<SincronizacoesPage />);
      await screen.findByTestId("ml-logistics-reclassification-panel-Meli 1");

      // Primeira falha — o aviso não bloqueante aparece.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4001);
      });
      expect(
        screen.getByText(/conexão temporariamente indisponível/i),
      ).toBeInTheDocument();

      // Backoff LIMITADO (nunca imediato para sempre): tempo suficiente para
      // a segunda falha e a recuperação subsequente, dentro do teto de 30s.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30000);
      });

      await waitFor(() =>
        expect(
          screen.queryByText(/conexão temporariamente indisponível/i),
        ).not.toBeInTheDocument(),
      );
      const panel = await screen.findByTestId(
        "ml-logistics-reclassification-panel-Meli 1",
      );
      expect(within(panel).getByText("7")).toBeInTheDocument();
    });

    it("nunca cria timers duplicados durante retries com backoff (só uma chamada por ciclo agendado)", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        account({ id: "ml-1" }),
      ]);
      (api.fetchMlLogisticsReclassificationStatus as jest.Mock)
        .mockResolvedValueOnce(mlReclassStatus({ status: "RUNNING" }))
        .mockRejectedValueOnce(fakeApiFetchError("Falha de conexão."))
        .mockResolvedValue(mlReclassStatus({ status: "RUNNING" }));

      render(<SincronizacoesPage />);
      await screen.findByTestId("ml-logistics-reclassification-panel-Meli 1");

      // Cobre o ciclo inicial (4s) que falha e o retry de backoff (4s) que
      // sucede — se houvesse um segundo timer concorrente (ex.: o antigo
      // `setInterval` fixo ainda vivo junto do novo esquema de backoff), o
      // número de chamadas seria maior que 3 já aqui.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(8001);
      });
      const callsAfterRecovery = (
        api.fetchMlLogisticsReclassificationStatus as jest.Mock
      ).mock.calls.length;
      expect(callsAfterRecovery).toBe(3);

      // Uma janela BEM curta, insuficiente para o próximo ciclo normal
      // (4s) — nenhuma chamada extra deve aparecer aqui; se houvesse um
      // timer duplicado disparando fora de sincronia, apareceria.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });
      expect(
        (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mock.calls
          .length,
      ).toBe(callsAfterRecovery);
    });

    it("consulta imediatamente ao voltar para a aba (visibilitychange), sem esperar o próximo ciclo", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        account({ id: "ml-1" }),
      ]);
      (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mockResolvedValue(
        mlReclassStatus({ status: "RUNNING", resolvedFullCount: 3 }),
      );

      render(<SincronizacoesPage />);
      await screen.findByTestId("ml-logistics-reclassification-panel-Meli 1");

      const callsBefore = (
        api.fetchMlLogisticsReclassificationStatus as jest.Mock
      ).mock.calls.length;

      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await waitFor(() =>
        expect(
          (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mock.calls
            .length,
        ).toBeGreaterThan(callsBefore),
      );
    });

    it("401 no polling segue o fluxo de sessão expirada (redireciona para /login), nunca fica tentando de novo sozinho", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        account({ id: "ml-1" }),
      ]);
      (api.fetchMlLogisticsReclassificationStatus as jest.Mock)
        .mockResolvedValueOnce(mlReclassStatus({ status: "RUNNING" }))
        .mockRejectedValueOnce(
          fakeApiFetchError("Sessão expirada.", "UNAUTHENTICATED"),
        );

      render(<SincronizacoesPage />);
      await screen.findByTestId("ml-logistics-reclassification-panel-Meli 1");

      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });

      expect(routerReplaceMock).toHaveBeenCalledWith("/login");

      const callsAfterRedirect = (
        api.fetchMlLogisticsReclassificationStatus as jest.Mock
      ).mock.calls.length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60000);
      });
      // Nunca continua tentando depois de detectar sessão expirada.
      expect(
        (api.fetchMlLogisticsReclassificationStatus as jest.Mock).mock.calls
          .length,
      ).toBe(callsAfterRedirect);
    });

    it("nunca dispara start/resume durante o retry do polling", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        account({ id: "ml-1" }),
      ]);
      (api.fetchMlLogisticsReclassificationStatus as jest.Mock)
        .mockResolvedValueOnce(mlReclassStatus({ status: "RUNNING" }))
        .mockRejectedValueOnce(fakeApiFetchError("Falha de conexão."))
        .mockResolvedValue(mlReclassStatus({ status: "RUNNING" }));

      render(<SincronizacoesPage />);
      await screen.findByTestId("ml-logistics-reclassification-panel-Meli 1");

      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(8000);
      });

      expect(api.startMlLogisticsReclassification).not.toHaveBeenCalled();
      expect(api.resumeMlLogisticsReclassification).not.toHaveBeenCalled();
    });
  });
});
