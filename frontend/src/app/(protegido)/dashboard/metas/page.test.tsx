import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import MetasPage from "./page";
import type { MonthlyRevenueGoalProgressDto } from "@/types/monthly-revenue-goal";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

// Caminho relativo real (não o alias `@/*`) — mesma ressalva de
// `dashboard/page.test.tsx`: `jest.mock`/`jest.requireActual` resolvem fora
// do pipeline do Next que entende o alias.
jest.mock("../../../../lib/goals-api", () => {
  const actual = jest.requireActual("../../../../lib/goals-api");
  return {
    ...actual,
    fetchMonthlyGoalProgress: jest.fn(),
    upsertMonthlyGoal: jest.fn(),
  };
});
jest.mock("../../../../lib/api", () => {
  const actual = jest.requireActual("../../../../lib/api");
  return { ...actual, apiFetch: jest.fn() };
});

const goalsApi = jest.requireMock("../../../../lib/goals-api") as {
  fetchMonthlyGoalProgress: jest.Mock;
  upsertMonthlyGoal: jest.Mock;
};
const api = jest.requireMock("../../../../lib/api") as { apiFetch: jest.Mock };

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockCurrentUser(overrides: { isAdmin?: boolean } = {}) {
  api.apiFetch.mockImplementation(async (path: string) => {
    if (path === "/auth/me") {
      return jsonResponse({
        name: "Ana",
        email: "ana@example.com",
        isAdmin: overrides.isAdmin ?? false,
      });
    }
    return jsonResponse({}, 404);
  });
}

function progressDto(
  overrides: Partial<MonthlyRevenueGoalProgressDto> = {},
): MonthlyRevenueGoalProgressDto {
  return {
    year: 2026,
    month: 9,
    currencyId: "BRL",
    goal: { configured: true, targetAmount: "600000.00" },
    live: {
      eligibleRevenue: "320000.00",
      achievementPercentage: 53.3,
      remainingAmount: "280000.00",
    },
    closedDays: {
      cutoffDate: "2026-09-14",
      daysCompleted: 14,
      daysInMonth: 30,
      revenue: "280000.00",
      currentDailyAverage: "20000.00",
      expectedRevenue: "280000.00",
      projectedRevenue: "600000.00",
      requiredDailyRevenue: "20000.00",
    },
    refunds: {
      partiallyRefundedOrders: 0,
      partiallyRefundedGrossAmount: "0.00",
      coverage: "COMPLETE",
    },
    dailyPace: [
      { day: 1, date: "2026-09-01", targetCumulative: "20000.00", realizedCumulative: "18000.00" },
      { day: 2, date: "2026-09-02", targetCumulative: "40000.00", realizedCumulative: null },
    ],
    ...overrides,
  };
}

function mockSearchParams(params: Record<string, string> = {}) {
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams(params));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const routerPush = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ push: routerPush });
  (usePathname as jest.Mock).mockReturnValue("/dashboard/metas");
  mockSearchParams({ year: "2026", month: "9" });
  mockCurrentUser();
});

describe("MetasPage", () => {
  it("shows a loading state while the progress request is in flight", async () => {
    mockCurrentUser();
    const pending = deferred<MonthlyRevenueGoalProgressDto>();
    goalsApi.fetchMonthlyGoalProgress.mockReturnValueOnce(pending.promise);

    render(<MetasPage />);

    expect(screen.getByRole("status", { name: /carregando/i })).toBeInTheDocument();
    pending.resolve(progressDto());
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: /carregando/i })).not.toBeInTheDocument(),
    );
  });

  it("shows an error with retry on failure, and recovers on retry", async () => {
    goalsApi.fetchMonthlyGoalProgress.mockRejectedValueOnce(new Error("boom"));
    render(<MetasPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    goalsApi.fetchMonthlyGoalProgress.mockResolvedValueOnce(progressDto());
    await userEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));

    await waitFor(() =>
      expect(screen.getByText(/faturamento realizado/i)).toBeInTheDocument(),
    );
  });

  it("shows the no-goal state without inventing a targetAmount, and offers the admin action only to admins", async () => {
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(
      progressDto({ goal: { configured: false, targetAmount: null } }),
    );
    render(<MetasPage />);

    await waitFor(() =>
      expect(screen.getByText(/nenhuma meta cadastrada/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /cadastrar meta/i })).not.toBeInTheDocument();
  });

  it("shows the admin action for an admin user", async () => {
    mockCurrentUser({ isAdmin: true });
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(progressDto());
    render(<MetasPage />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /alterar meta/i })).toBeInTheDocument(),
    );
  });

  it("an admin can submit the goal form, which saves and refreshes the progress", async () => {
    mockCurrentUser({ isAdmin: true });
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(progressDto());
    goalsApi.upsertMonthlyGoal.mockResolvedValueOnce({
      year: 2026,
      month: 9,
      currencyId: "BRL",
      targetAmount: "700000.00",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
    });

    render(<MetasPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /alterar meta/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: /alterar meta/i }));

    const input = screen.getByLabelText(/valor da meta/i);
    await userEvent.clear(input);
    await userEvent.type(input, "700000");
    await userEvent.click(screen.getByRole("button", { name: /^salvar meta$/i }));

    await waitFor(() =>
      expect(goalsApi.upsertMonthlyGoal).toHaveBeenCalledWith({
        year: 2026,
        month: 9,
        currencyId: "BRL",
        targetAmount: 700000,
      }),
    );
    // Fecha o modal e recarrega o progresso após salvar.
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(goalsApi.fetchMonthlyGoalProgress).toHaveBeenCalledTimes(2);
  });

  it("a non-admin user never sees the goal edit action, even with a configured goal", async () => {
    mockCurrentUser({ isAdmin: false });
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(progressDto());
    render(<MetasPage />);
    await waitFor(() => expect(screen.getByText(/faturamento realizado/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /alterar meta/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cadastrar meta/i })).not.toBeInTheDocument();
  });

  it("shows a 401/403 error without a retry button, pointing the user to log in again", async () => {
    const { UnauthorizedGoalApiError } = jest.requireActual("../../../../lib/goals-api");
    goalsApi.fetchMonthlyGoalProgress.mockRejectedValueOnce(
      new UnauthorizedGoalApiError("Sessão expirada. Entre novamente."),
    );
    render(<MetasPage />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/sessão expirada/i)).toBeInTheDocument();
    expect(screen.getByText(/faça login novamente/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /tentar novamente/i }),
    ).not.toBeInTheDocument();
  });

  it("never renders an UNAVAILABLE (null) KPI as if it were zero", async () => {
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(
      progressDto({
        closedDays: {
          cutoffDate: "2026-08-31",
          daysCompleted: 0,
          daysInMonth: 30,
          revenue: "0.00",
          currentDailyAverage: null,
          expectedRevenue: "0.00",
          projectedRevenue: null,
          requiredDailyRevenue: "20000.00",
        },
      }),
    );
    render(<MetasPage />);

    // currentDailyAverage/projectedRevenue são `null` (UNAVAILABLE) — devem
    // aparecer como "Indisponível", nunca como "R$ 0,00" fingindo medido.
    // expectedRevenue="0.00" é um ZERO VÁLIDO (dia 1 do mês, regra E) e deve
    // continuar aparecendo como valor normal — não é o caso testado aqui.
    await waitFor(() =>
      expect(screen.getAllByText("Indisponível").length).toBeGreaterThanOrEqual(2),
    );
  });

  it("shows the partially_refunded coverage warning", async () => {
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(
      progressDto({
        refunds: {
          partiallyRefundedOrders: 3,
          partiallyRefundedGrossAmount: "538.27",
          coverage: "PARTIAL",
        },
      }),
    );
    render(<MetasPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/3 pedido\(s\) parcialmente reembolsado/i),
      ).toBeInTheDocument(),
    );
  });

  it("never shows the refund warning when coverage is COMPLETE", async () => {
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(progressDto());
    render(<MetasPage />);
    await waitFor(() => expect(screen.getByText(/faturamento realizado/i)).toBeInTheDocument());
    expect(screen.queryByText(/parcialmente reembolsado/i)).not.toBeInTheDocument();
  });

  it("formats monetary values in pt-BR/BRL", async () => {
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(progressDto());
    render(<MetasPage />);
    await waitFor(() => expect(screen.getByText("R$ 320.000,00")).toBeInTheDocument());
  });

  it("renders the pace chart with target/realized lines from dailyPace", async () => {
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValue(progressDto());
    render(<MetasPage />);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /realizado acumulado/i })).toBeInTheDocument(),
    );
  });

  it("discards a slower, older response when the month changes quickly — never mixes data from two months", async () => {
    const septemberPending = deferred<MonthlyRevenueGoalProgressDto>();
    goalsApi.fetchMonthlyGoalProgress.mockReturnValueOnce(septemberPending.promise);
    const { rerender } = render(<MetasPage />);
    await waitFor(() => expect(goalsApi.fetchMonthlyGoalProgress).toHaveBeenCalledWith(2026, 9));

    // Troca de mês antes da resposta de setembro chegar.
    mockSearchParams({ year: "2026", month: "10" });
    goalsApi.fetchMonthlyGoalProgress.mockResolvedValueOnce(
      progressDto({ year: 2026, month: 10, live: { eligibleRevenue: "999.00", achievementPercentage: null, remainingAmount: null } }),
    );
    rerender(<MetasPage />);
    await waitFor(() => expect(screen.getByText("R$ 999,00")).toBeInTheDocument());

    // A resposta atrasada de setembro chega DEPOIS — nunca deve sobrescrever outubro.
    septemberPending.resolve(progressDto({ year: 2026, month: 9 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("R$ 999,00")).toBeInTheDocument();
  });
});
