// Mesmo padrão de automock documentado em sincronizacoes-sync-all.test.tsx.
jest.mock("../src/lib/api");

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SincronizacoesPage from "@/app/(protegido)/sincronizacoes/page";
import * as api from "@/lib/api";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { BackfillStatusDto } from "@/types/marketplace-backfill";

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
    ...overrides,
  };
}

/**
 * `jest.mock("../src/lib/api")` automocka a classe `ApiFetchError` —
 * `new api.ApiFetchError(...)` no automock NÃO roda o construtor real
 * (`message`/`code`/`retryAfterSeconds` saem vazios). Para simular um erro
 * real com esses campos preenchidos (necessário para os testes de 429 e de
 * mensagem sanitizada), troca o protótipo de um `Error` de verdade para o
 * do automock — `instanceof ApiFetchError` continua válido em `page.tsx`
 * (mesma referência de classe), mas os campos vêm do `Error` real.
 */
function fakeApiFetchError(
  message: string,
  code?: string,
  retryAfterSeconds?: number,
): Error {
  const error = new Error(message);
  Object.setPrototypeOf(error, api.ApiFetchError.prototype);
  Object.assign(error, { code, retryAfterSeconds, name: "ApiFetchError" });
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

describe("SincronizacoesPage — Completar histórico (Fase 4)", () => {
  it("shows first/last sale, synchronized intervals and status for a connected Mercado Livre account", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(within(panel).getByText("01/06/2026")).toBeInTheDocument();
    expect(within(panel).getByText("30/08/2026")).toBeInTheDocument();
    expect(within(panel).getByText("Parcial")).toBeInTheDocument();
  });

  it('clicking "Continuar histórico" calls next-chunk repeatedly until hasMoreHistory=false, never stopping on an empty chunk in between', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());
    (api.runBackfillNextChunk as jest.Mock)
      .mockResolvedValueOnce({
        hasMoreHistory: true,
        oldestCoveredAt: "2026-05-01",
        ordersFetched: 0, // bloco vazio — NUNCA encerra sozinho
      })
      .mockResolvedValueOnce({
        hasMoreHistory: true,
        oldestCoveredAt: "2026-04-01",
        ordersFetched: 4,
      })
      .mockResolvedValueOnce({
        hasMoreHistory: false,
        oldestCoveredAt: "2026-03-01",
        ordersFetched: 0,
      });

    const user = userEvent.setup();
    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    await user.click(
      within(panel).getByRole("button", { name: /continuar histórico/i }),
    );

    await waitFor(() =>
      expect(api.runBackfillNextChunk).toHaveBeenCalledTimes(3),
    );
    expect(api.fetchBackfillStatus).toHaveBeenCalledTimes(2); // carga inicial + após o loop
  });

  it("processes multiple Mercado Livre accounts sequentially via 'Completar histórico de todas as lojas', never concurrently", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1", nickname: "Meli 1" }),
      mlAccount({ id: "ml-2", nickname: "Meli 2" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());

    const callOrder: string[] = [];
    (api.runBackfillNextChunk as jest.Mock).mockImplementation(
      async (accountId: string) => {
        callOrder.push(accountId);
        return {
          hasMoreHistory: false,
          oldestCoveredAt: "2026-01-01",
          ordersFetched: 0,
        };
      },
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

    await waitFor(() =>
      expect(api.runBackfillNextChunk).toHaveBeenCalledTimes(2),
    );
    expect(callOrder).toEqual(["ml-1", "ml-2"]);
  });

  it("never claims the true history start was reached when the defensive safety limit is hit", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({ status: "SAFETY_LIMIT_REACHED" }),
    );

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(
      within(panel).getByText(/histórico completo dentro do limite/i),
    ).toBeInTheDocument();
    expect(within(panel).getByText(/não é uma confirmação/i)).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: /histórico/i }),
    ).not.toBeInTheDocument();
  });

  it('shows "Tentar novamente" and the transient error code when the last run failed', async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({ status: "ERROR", lastRunErrorCode: "PROVIDER_UNAVAILABLE" }),
    );

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(
      within(panel).getByRole("button", { name: /tentar novamente/i }),
    ).toBeInTheDocument();
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
    expect(within(panel2).getByText("Parcial")).toBeInTheDocument();
  });

  it("does not offer the backfill action before the account has ever been synced (NOT_STARTED)", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(
      backfillStatus({ status: "NOT_STARTED", oldestCoveredAt: null, firstOrderAt: null, lastOrderAt: null, synchronizedIntervals: [], lastProcessedChunk: null }),
    );

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    expect(
      within(panel).queryByRole("button", { name: /histórico/i }),
    ).not.toBeInTheDocument();
    expect(within(panel).getByText(/sincronize esta conta/i)).toBeInTheDocument();
  });

  it("clicking the individual button calls the endpoint exactly once (for one chunk) with the correct accountId, shows immediate loading feedback and disables the button", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());

    let resolveChunk!: (value: unknown) => void;
    (api.runBackfillNextChunk as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveChunk = resolve;
      }),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    const button = within(panel).getByRole("button", {
      name: /continuar histórico/i,
    });

    await user.click(button);

    expect(button).toBeDisabled();
    expect(within(panel).getByRole("status")).toHaveTextContent(
      /iniciando histórico/i,
    );

    resolveChunk({
      hasMoreHistory: false,
      oldestCoveredAt: "2026-04-01",
      ordersFetched: 2,
    });

    await waitFor(() => expect(button).not.toBeDisabled());
    expect(api.runBackfillNextChunk).toHaveBeenCalledTimes(1);
    expect(api.runBackfillNextChunk).toHaveBeenCalledWith("ml-1");
  });

  it("a double click on the same button never fires the endpoint twice — the synchronous busy guard blocks the second click", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());
    (api.runBackfillNextChunk as jest.Mock).mockResolvedValue({
      hasMoreHistory: false,
      oldestCoveredAt: "2026-04-01",
      ordersFetched: 0,
    });

    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    const button = within(panel).getByRole("button", {
      name: /continuar histórico/i,
    });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() =>
      expect(api.runBackfillNextChunk).toHaveBeenCalledTimes(1),
    );
  });

  it("success updates the status and the last processed chunk after the loop finishes", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock)
      .mockResolvedValueOnce(backfillStatus({ lastProcessedChunk: null }))
      .mockResolvedValueOnce(
        backfillStatus({
          lastProcessedChunk: { from: "2026-04-01", to: "2026-05-01", ordersFetched: 7 },
        }),
      );
    (api.runBackfillNextChunk as jest.Mock).mockResolvedValue({
      hasMoreHistory: false,
      oldestCoveredAt: "2026-04-01",
      ordersFetched: 7,
    });

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    await user.click(
      within(panel).getByRole("button", { name: /completar histórico/i }),
    );

    await waitFor(() =>
      expect(within(panel).getByText(/01\/04\/2026 a 01\/05\/2026/)).toBeInTheDocument(),
    );
  });

  it("an exhausted-retry failure is shown on screen, never swallowed silently", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());
    // code "RATE_LIMITED" + retryAfterSeconds minúsculo só encurta o
    // backoff interno entre tentativas (nunca 22s reais de espera aqui) —
    // não muda o cenário testado: falha persistente que esgota as
    // tentativas e aparece na tela.
    (api.runBackfillNextChunk as jest.Mock).mockRejectedValue(
      fakeApiFetchError(
        "Não foi possível iniciar o histórico.",
        "RATE_LIMITED",
        0.001,
      ),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    await user.click(
      within(panel).getByRole("button", { name: /continuar histórico/i }),
    );

    await waitFor(() =>
      expect(within(panel).getByRole("alert")).toHaveTextContent(
        /não foi possível iniciar o histórico/i,
      ),
    );
  }, 10000);

  it("a next-chunk failure on one account never crashes or blocks the other account's panel", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1", nickname: "Meli 1" }),
      mlAccount({ id: "ml-2", nickname: "Meli 2" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());
    (api.runBackfillNextChunk as jest.Mock).mockImplementation(
      (accountId: string) =>
        accountId === "ml-1"
          ? Promise.reject(
              // RATE_LIMITED + retryAfterSeconds minúsculo só encurta o
              // backoff interno entre tentativas neste teste.
              fakeApiFetchError(
                "Não foi possível iniciar o histórico.",
                "RATE_LIMITED",
                0.001,
              ),
            )
          : Promise.resolve({
              hasMoreHistory: false,
              oldestCoveredAt: "2026-04-01",
              ordersFetched: 1,
            }),
    );

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel1 = await screen.findByTestId("backfill-panel-Meli 1");
    const panel2 = await screen.findByTestId("backfill-panel-Meli 2");

    await user.click(
      within(panel1).getByRole("button", { name: /continuar histórico/i }),
    );
    await waitFor(() =>
      expect(within(panel1).getByRole("alert")).toBeInTheDocument(),
    );

    await user.click(
      within(panel2).getByRole("button", { name: /continuar histórico/i }),
    );
    await waitFor(() =>
      expect(api.runBackfillNextChunk).toHaveBeenCalledWith("ml-2"),
    );
    expect(within(panel2).queryByRole("alert")).not.toBeInTheDocument();
  }, 10000);

  it("respects Retry-After on a 429 before retrying, and eventually succeeds", async () => {
    (api.fetchMarketplaceAccounts as jest.Mock).mockResolvedValue([
      mlAccount({ id: "ml-1" }),
    ]);
    (api.fetchBackfillStatus as jest.Mock).mockResolvedValue(backfillStatus());
    (api.runBackfillNextChunk as jest.Mock)
      .mockRejectedValueOnce(
        fakeApiFetchError(
          "Limite de chamadas atingido. Nova tentativa em breve.",
          "RATE_LIMITED",
          0.001, // segundos — minúsculo só para o teste não esperar de verdade
        ),
      )
      .mockResolvedValueOnce({
        hasMoreHistory: false,
        oldestCoveredAt: "2026-04-01",
        ordersFetched: 3,
      });

    const user = userEvent.setup();
    render(<SincronizacoesPage />);
    const panel = await screen.findByTestId("backfill-panel-Meli 1");
    await user.click(
      within(panel).getByRole("button", { name: /continuar histórico/i }),
    );

    await waitFor(() =>
      expect(api.runBackfillNextChunk).toHaveBeenCalledTimes(2),
    );
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
  });
});
