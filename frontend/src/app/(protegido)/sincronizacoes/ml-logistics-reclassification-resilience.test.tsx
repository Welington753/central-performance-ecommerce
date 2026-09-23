import { act, render, screen, waitFor, within } from "@testing-library/react";
import { useRouter } from "next/navigation";
import SincronizacoesPage from "./page";
import { ApiFetchError } from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";
import type { AmazonSetupStatusDto } from "@/types/amazon-connection";
import type { BackfillStatusDto } from "@/types/marketplace-backfill";
import type { MlLogisticsReclassificationAccountStatusDto } from "@/types/ml-logistics-reclassification";

/**
 * Suíte dedicada (arquivo separado de `page.test.tsx`) — cobre a
 * resiliência do polling da correção Full do Mercado Livre a cold
 * start/rede (nunca disparar start/pause/resume durante uma falha
 * temporária) e a distinção entre falha temporária e 401 real.
 *
 * Mocka `fetchMlLogisticsReclassificationStatus` diretamente (em vez de
 * `apiFetch`) — essa função é definida no MESMO módulo de `apiFetch` e o
 * fecho léxico do JS resolve a chamada interna para o `apiFetch` real, não
 * para o mock do módulo; mockar a função exportada usada pela página evita
 * essa armadilha e isola exatamente o que este teste quer provar (o
 * comportamento de polling/backoff da própria página).
 */
jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("../../../lib/api", () => {
  const actual = jest.requireActual("../../../lib/api");
  return {
    ...actual,
    apiFetch: jest.fn(),
    fetchMarketplaceAccounts: jest.fn(),
    fetchAmazonSetupStatus: jest.fn(),
    fetchBackfillStatus: jest.fn(),
    fetchMlLogisticsReclassificationStatus: jest.fn(),
    startMlLogisticsReclassification: jest.fn(),
    pauseMlLogisticsReclassification: jest.fn(),
    resumeMlLogisticsReclassification: jest.fn(),
  };
});

const api = jest.requireMock("../../../lib/api") as {
  apiFetch: jest.Mock;
  fetchMarketplaceAccounts: jest.Mock;
  fetchAmazonSetupStatus: jest.Mock;
  fetchBackfillStatus: jest.Mock;
  fetchMlLogisticsReclassificationStatus: jest.Mock;
  startMlLogisticsReclassification: jest.Mock;
  pauseMlLogisticsReclassification: jest.Mock;
  resumeMlLogisticsReclassification: jest.Mock;
};

const replace = jest.fn();

function account(
  overrides: Partial<MarketplaceAccountDto> = {},
): MarketplaceAccountDto {
  return {
    id: "ml-1",
    marketplace: "MERCADO_LIVRE",
    externalSellerId: "123",
    nickname: "Mercado Livre 1",
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
    canVerify: true,
    canSynchronize: true,
  };
}

function backfillStatus(): BackfillStatusDto {
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
  };
}

function mlReclassStatus(
  overrides: Partial<MlLogisticsReclassificationAccountStatusDto> = {},
): MlLogisticsReclassificationAccountStatusDto {
  return {
    accountId: "ml-1",
    nickname: null,
    status: "RUNNING",
    initialUnknownCount: 10,
    remainingUnknownCount: 5,
    resolvedFullCount: 3,
    resolvedNotFullCount: 2,
    callsMadeCount: 5,
    lastActivityAt: null,
    nextAttemptAt: null,
    lastErrorCode: null,
    pauseRequested: false,
    workerEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ replace, push: jest.fn() });
  api.apiFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
  } as Response);
  api.fetchAmazonSetupStatus.mockResolvedValue(amazonSetupStatus());
  api.fetchBackfillStatus.mockResolvedValue(backfillStatus());
  api.fetchMarketplaceAccounts.mockResolvedValue([account()]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SincronizacoesPage — correção Full do ML resiliente a cold start/401 real", () => {
  it("falha temporária (rede/cold start) no polling nunca dispara start/pause/resume — se recupera sozinho depois", async () => {
    jest.useFakeTimers();

    api.fetchMlLogisticsReclassificationStatus
      .mockResolvedValueOnce(mlReclassStatus())
      .mockRejectedValueOnce(new ApiFetchError("falha de rede (cold start)"))
      .mockResolvedValueOnce(
        mlReclassStatus({ status: "COMPLETED", remainingUnknownCount: 0 }),
      );

    render(<SincronizacoesPage />);

    const panel = await screen.findByTestId(
      "ml-logistics-reclassification-panel-Mercado Livre 1",
    );
    expect(
      within(panel).getByText("Corrigindo histórico..."),
    ).toBeInTheDocument();

    // Ciclo normal do polling (4s) dispara a 2ª consulta, que falha por
    // rede/cold start — nunca deve tocar start/pause/resume.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });
    expect(
      screen.getByText(/Conexão temporariamente indisponível/i),
    ).toBeInTheDocument();

    // Backoff (4s) até a 3ª consulta, que recupera.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });
    await waitFor(() =>
      expect(
        screen.queryByText(/Conexão temporariamente indisponível/i),
      ).not.toBeInTheDocument(),
    );
    expect(within(panel).getByText("Concluído")).toBeInTheDocument();

    expect(api.startMlLogisticsReclassification).not.toHaveBeenCalled();
    expect(api.pauseMlLogisticsReclassification).not.toHaveBeenCalled();
    expect(api.resumeMlLogisticsReclassification).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("401 real (confirmado pelo backend) durante o polling redireciona ao login e para de tentar", async () => {
    jest.useFakeTimers();

    api.fetchMlLogisticsReclassificationStatus
      .mockResolvedValueOnce(mlReclassStatus())
      .mockRejectedValueOnce(
        new ApiFetchError("Sessão expirada. Entre novamente.", "UNAUTHENTICATED"),
      );

    render(<SincronizacoesPage />);

    await screen.findByTestId(
      "ml-logistics-reclassification-panel-Mercado Livre 1",
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(api.startMlLogisticsReclassification).not.toHaveBeenCalled();
    expect(api.resumeMlLogisticsReclassification).not.toHaveBeenCalled();
  });
});
