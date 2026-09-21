// Mesmo padrão de automock documentado em sincronizacoes-sync-all.test.tsx.
jest.mock("../src/lib/api");

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";
import * as api from "@/lib/api";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type {
  BackfillJobSummaryDto,
  BackfillStatusDto,
} from "@/types/marketplace-backfill";

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

function job(overrides: Partial<BackfillJobSummaryDto> = {}): BackfillJobSummaryDto {
  return {
    id: "job-1",
    status: "RUNNING",
    chunksProcessed: 2,
    attemptCount: 0,
    requestedAt: "2026-09-01T00:00:00.000Z",
    startedAt: "2026-09-01T00:00:00.000Z",
    lastActivityAt: "2026-09-01T00:05:00.000Z",
    nextAttemptAt: null,
    completedAt: null,
    lastErrorCode: null,
    pauseRequested: false,
    ...overrides,
  };
}

function backfillStatus(
  overrides: Partial<BackfillStatusDto> = {},
): BackfillStatusDto {
  return {
    status: "IN_PROGRESS",
    oldestCoveredAt: "2026-06-01",
    firstOrderAt: "2026-06-01",
    lastOrderAt: "2026-08-30",
    synchronizedIntervals: [{ from: "2026-06-01", to: "2026-08-30" }],
    lastProcessedChunk: { from: "2026-05-02", to: "2026-06-01", ordersFetched: 3 },
    lastRunErrorCode: null,
    job: job(),
    workerEnabled: true,
    ...overrides,
  };
}

/**
 * `jest.mock("../src/lib/api")` automocka a classe `ApiFetchError` —
 * `new api.ApiFetchError(...)` no automock NÃO roda o construtor real
 * (`message`/`code`/`retryAfterSeconds` saem vazios). Para simular um erro
 * real com esses campos preenchidos, troca o protótipo de um `Error` de
 * verdade para o do automock — `instanceof ApiFetchError` continua válido
 * em `page.tsx` (mesma referência de classe), mas os campos vêm do `Error`
 * real.
 */
function fakeApiFetchError(message: string, code?: string): Error {
  const error = new Error(message);
  Object.setPrototypeOf(error, api.ApiFetchError.prototype);
  Object.assign(error, { code, name: "ApiFetchError" });
  return error;
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

afterEach(() => {
  jest.useRealTimers();
});

describe("SincronizacoesPage — Completar histórico (job durável, Fase 4)", () => {
  it("shows first/last sale, synchronized intervals and the job status returned by the backend", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(within(panel).getByText("01/06/2026")).toBeInTheDocument();
    expect(within(panel).getByText("30/08/2026")).toBeInTheDocument();
    expect(within(panel).getByText(/processando histórico em segundo plano/i)).toBeInTheDocument();
  });

  it('clicking "Completar histórico" calls start exactly once — never a next-chunk loop', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({ job: null }),
    );
    (api.startBackfill as jest.Mock).mockResolvedValue(backfillStatus());

    const user = userEvent.setup();
    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    await user.click(
      within(panel).getByRole("button", { name: /completar histórico/i }),
    );

    await waitFor(() =>
      expect(api.startBackfill).toHaveBeenCalledWith("ml-1"),
    );
    expect(api.startBackfill).toHaveBeenCalledTimes(1);
    expect(api.runBackfillNextChunk).not.toHaveBeenCalled();
  });

  it('"Completar histórico de todas as lojas" only enqueues both accounts (calls start for each), never executes chunks itself', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1", nickname: "Meli 1" }),
      mlAccount({ id: "ml-2", nickname: "Meli 2" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({ job: null }),
    );
    (api.startBackfill as jest.Mock).mockImplementation((accountId: string) =>
      Promise.resolve(
        backfillStatus({ job: job({ id: `job-${accountId}` }) }),
      ),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);

    await screen.findByTestId("backfill-panel-Meli 1");
    await screen.findByTestId("backfill-panel-Meli 2");

    await user.click(
      screen.getByRole("button", {
        name: /completar histórico de todas as lojas/i,
      }),
    );

    await waitFor(() => {
      expect(api.startBackfill).toHaveBeenCalledWith("ml-1");
      expect(api.startBackfill).toHaveBeenCalledWith("ml-2");
    });
    expect(api.runBackfillNextChunk).not.toHaveBeenCalled();
  });

  it("never claims the true history start was reached when the defensive safety limit is hit", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({
        status: "SAFETY_LIMIT_REACHED",
        job: job({ status: "SAFETY_LIMIT_REACHED" }),
      }),
    );

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(
      within(panel).getByText(/histórico completo dentro do limite/i),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/isso não confirma/i)).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /histórico/i }),
    ).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /pausar/i })).not.toBeInTheDocument();
  });

  it('shows "Tentar novamente" and the sanitized error message when the job FAILED', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({
        job: job({ status: "FAILED", lastErrorCode: "PROVIDER_RATE_LIMITED" }),
      }),
    );

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(
      within(panel).getByRole("button", { name: /tentar novamente/i }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      /limitou as requisições/i,
    );
  });

  it("a status-fetch failure for one Mercado Livre account never crashes the page — only that account's panel shows the error, the other renders normally", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1", nickname: "Meli 1" }),
      mlAccount({ id: "ml-2", nickname: "Meli 2" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockImplementation(
      (accountId: string) =>
        accountId === "ml-1"
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(backfillStatus()),
    );

    render(<SincronizacoesPage />);

    const panel1 = await screen.findByTestId("backfill-panel-Meli 1");
    const panel2 = await screen.findByTestId("backfill-panel-Meli 2");
    expect(
      within(panel1).getByText(/não foi possível carregar/i),
    ).toBeInTheDocument();
    expect(within(panel2).getByText(/processando histórico em segundo plano/i)).toBeInTheDocument();
  });

  it("does not offer the backfill action before the account has ever been synced (NOT_STARTED)", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({
        status: "NOT_STARTED",
        oldestCoveredAt: null,
        firstOrderAt: null,
        lastOrderAt: null,
        synchronizedIntervals: [],
        lastProcessedChunk: null,
        job: null,
      }),
    );

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(
      within(panel).getByRole("button", { name: /completar histórico/i }),
    ).toBeDisabled();
    expect(within(panel).getByText(/sincronize esta conta/i)).toBeInTheDocument();
  });

  it("a double click on Start never fires the endpoint twice — the synchronous busy guard blocks the second click", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({ job: null }),
    );
    let resolveStart!: (value: BackfillStatusDto) => void;
    (api.startBackfill as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );

    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    const button = within(panel).getByRole("button", {
      name: /completar histórico/i,
    });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(api.startBackfill).toHaveBeenCalledTimes(1));
    resolveStart(backfillStatus());
    await waitFor(() => expect(button).not.toBeInTheDocument());
  });

  describe("pausar / continuar", () => {
    it('clicking "Pausar" calls pauseBackfill and reflects the returned status', async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());
      (api.pauseBackfill as jest.Mock).mockResolvedValue(
        backfillStatus({ job: job({ status: "PAUSED" }) }),
      );

      const user = userEvent.setup();
      render(<SincronizacoesPage />);
      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      await user.click(within(panel).getByRole("button", { name: /pausar/i }));

      await waitFor(() => expect(api.pauseBackfill).toHaveBeenCalledWith("ml-1"));
      expect(await within(panel).findByText(/histórico pausado.$/i)).toBeInTheDocument();
    });

    it('clicking "Continuar" calls resumeBackfill and reflects the returned status', async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({ job: job({ status: "PAUSED" }) }),
      );
      (api.resumeBackfill as jest.Mock).mockResolvedValue(
        backfillStatus({ job: job({ status: "QUEUED" }) }),
      );

      const user = userEvent.setup();
      render(<SincronizacoesPage />);
      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      await user.click(
        within(panel).getByRole("button", { name: /continuar/i }),
      );

      await waitFor(() =>
        expect(api.resumeBackfill).toHaveBeenCalledWith("ml-1"),
      );
      expect(await within(panel).findByText(/na fila/i)).toBeInTheDocument();
    });

    it("a resume failure on one account never crashes or blocks the other account's panel", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1", nickname: "Meli 1" }),
        mlAccount({ id: "ml-2", nickname: "Meli 2" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({ job: job({ status: "PAUSED" }) }),
      );
      (api.resumeBackfill as jest.Mock).mockImplementation(
        (accountId: string) =>
          accountId === "ml-1"
            ? Promise.reject(fakeApiFetchError("Falha ao retomar.", "SYNC_FAILED"))
            : Promise.resolve(backfillStatus({ job: job({ status: "QUEUED" }) })),
      );

      const user = userEvent.setup();
      render(<SincronizacoesPage />);
      const panel1 = await screen.findByTestId("backfill-panel-Meli 1");
      const panel2 = await screen.findByTestId("backfill-panel-Meli 2");

      await user.click(
        within(panel1).getByRole("button", { name: /continuar/i }),
      );
      await waitFor(() =>
        expect(within(panel1).getByRole("alert")).toBeInTheDocument(),
      );

      await user.click(
        within(panel2).getByRole("button", { name: /continuar/i }),
      );
      await waitFor(() =>
        expect(api.resumeBackfill).toHaveBeenCalledWith("ml-2"),
      );
      expect(within(panel2).queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("acompanhamento (polling leve, sem loop client-side)", () => {
    it("polls the status endpoint periodically while a job is active, and reflects new progress", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock)
        .mockResolvedValueOnce(backfillStatus({ job: job({ chunksProcessed: 1 }) }))
        .mockResolvedValue(backfillStatus({ job: job({ chunksProcessed: 5 }) }));

      render(<SincronizacoesPage />);
      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      expect(within(panel).getByText("1")).toBeInTheDocument();

      const callsBefore = (api.fetchBackfillStatus as jest.Mock).mock.calls.length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });

      await waitFor(() =>
        expect(
          (api.fetchBackfillStatus as jest.Mock).mock.calls.length,
        ).toBeGreaterThan(callsBefore),
      );
      expect(await within(panel).findByText("5")).toBeInTheDocument();
    });

    it("stops polling once the job reaches a terminal status (never polls forever)", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({ job: job({ status: "PAUSED" }) }),
      );

      render(<SincronizacoesPage />);
      await screen.findByTestId("backfill-panel-Meli 1");
      const callsAfterInitialLoad = (api.fetchBackfillStatus as jest.Mock).mock
        .calls.length;

      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
      });

      expect((api.fetchBackfillStatus as jest.Mock).mock.calls.length).toBe(
        callsAfterInitialLoad,
      );
    });

    it("unmounting the page only stops polling — it never sends any request to cancel or pause the job", async () => {
      jest.useFakeTimers();
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());

      const { unmount } = render(<SincronizacoesPage />);
      await screen.findByTestId("backfill-panel-Meli 1");
      const callsBeforeUnmount = (api.fetchBackfillStatus as jest.Mock).mock
        .calls.length;

      unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
      });

      expect((api.fetchBackfillStatus as jest.Mock).mock.calls.length).toBe(
        callsBeforeUnmount,
      );
      expect(api.pauseBackfill).not.toHaveBeenCalled();
    });

    it("reopening the page (a fresh mount) immediately shows the job's current progress from the backend", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({ job: job({ status: "RETRY_WAIT", chunksProcessed: 8 }) }),
      );

      render(<SincronizacoesPage />);

      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      expect(
        within(panel).getByText(/aguardando nova tentativa/i),
      ).toBeInTheDocument();
      expect(within(panel).getByText("8")).toBeInTheDocument();
    });
  });

  describe("clareza de status (worker habilitado/desabilitado)", () => {
    it("QUEUED + worker habilitado: diz que o histórico será processado em segundo plano e mostra o aviso de 'pode fechar esta página'", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({
          job: job({ status: "QUEUED" }),
          workerEnabled: true,
        }),
      );

      render(<SincronizacoesPage />);

      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      expect(
        within(panel).getByText(
          "Na fila — o histórico será processado em segundo plano.",
        ),
      ).toBeInTheDocument();
      expect(
        within(panel).getByText(/pode fechar esta/i),
      ).toBeInTheDocument();
    });

    it("QUEUED + worker desabilitado: nunca afirma que está processando, e omite o aviso de 'pode fechar esta página'", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({
          job: job({ status: "QUEUED" }),
          workerEnabled: false,
        }),
      );

      render(<SincronizacoesPage />);

      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      expect(
        within(panel).getByText(
          "Aguardando — o processamento do histórico está desativado neste ambiente.",
        ),
      ).toBeInTheDocument();
      expect(within(panel).queryByText(/segundo plano/i)).not.toBeInTheDocument();
      expect(within(panel).queryByText(/pode fechar esta/i)).not.toBeInTheDocument();
    });

    it("RUNNING sempre diz 'Processando histórico em segundo plano.' — worker ativo processando de fato", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({
          job: job({ status: "RUNNING" }),
          workerEnabled: true,
        }),
      );

      render(<SincronizacoesPage />);

      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      expect(
        within(panel).getByText("Processando histórico em segundo plano."),
      ).toBeInTheDocument();
    });

    it("PAUSED diz 'Histórico pausado.' independente do worker estar habilitado", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
        backfillStatus({
          job: job({ status: "PAUSED" }),
          workerEnabled: false,
        }),
      );

      render(<SincronizacoesPage />);

      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      expect(
        within(panel).getByText("Histórico pausado."),
      ).toBeInTheDocument();
    });

    it("mostra o rótulo 'Período já consultado' com a explicação de que inclui períodos sem venda encontrada", async () => {
      (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
        mlAccount({ id: "ml-1" }),
      ]);
      (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());

      render(<SincronizacoesPage />);

      const panel = await screen.findByTestId("backfill-panel-Meli 1");
      expect(
        within(panel).getByText("Período já consultado"),
      ).toBeInTheDocument();
      expect(within(panel).queryByText("Intervalos sincronizados")).not.toBeInTheDocument();
      expect(
        within(panel).getByText(
          "Inclui períodos consultados com sucesso, mesmo quando nenhuma venda foi encontrada.",
        ),
      ).toBeInTheDocument();
    });
  });
});
