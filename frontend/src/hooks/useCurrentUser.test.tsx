import { act, render, screen } from "@testing-library/react";
import {
  CurrentUserProvider,
  hasAnyPermission,
  hasPermission,
  useCurrentUser,
  type CurrentUser,
} from "./useCurrentUser";

// Caminho relativo real (não o alias `@/*`) — mesmo padrão de `useAuthGuard.test.tsx`.
jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };

function response(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const VALID_USER_BODY = {
  id: "u1",
  name: "Fulana",
  email: "fulana@example.com",
  active: true,
  isAdmin: false,
  role: "ANALYST",
  permissions: ["dashboard.view"],
  accountScope: { mode: "ALL" },
  mustChangePassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function Probe() {
  const { user, status, refresh } = useCurrentUser();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user-name">{user ? user.name : "null"}</span>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <CurrentUserProvider>
      <Probe />
    </CurrentUserProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("CurrentUserProvider — fail-closed", () => {
  it("200 com corpo válido -> status ready com o usuário", async () => {
    api.apiFetch.mockResolvedValue(response(200, VALID_USER_BODY));

    renderProbe();
    expect(screen.getByTestId("status").textContent).toBe("checking");

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("user-name").textContent).toBe("Fulana");
  });

  it("200 com corpo incompleto nunca vira ready — erro seguro sem retry automático", async () => {
    jest.useFakeTimers();
    api.apiFetch.mockResolvedValue(response(200, { name: "Sem permissions" }));

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("fatal_error");
    expect(screen.getByTestId("user-name").textContent).toBe("null");

    // Nunca agenda retry sozinho para um contrato errado — sem chamada extra
    // mesmo depois do maior delay de backoff.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
  });

  it("status HTTP não transitório (ex.: 400) -> fatal_error, sem retry automático", async () => {
    jest.useFakeTimers();
    api.apiFetch.mockResolvedValue(response(400));

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("fatal_error");

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
  });

  it("refresh() sai de fatal_error e recupera para ready", async () => {
    api.apiFetch
      .mockResolvedValueOnce(response(200, { name: "Sem permissions" }))
      .mockResolvedValueOnce(response(200, VALID_USER_BODY));

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("status").textContent).toBe("fatal_error");

    await act(async () => {
      screen.getByRole("button", { name: "refresh" }).click();
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("ready");
  });

  it("401 -> unauthenticated e redireciona para /login, nunca ready", async () => {
    api.apiFetch.mockResolvedValue(response(401));

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("unauthenticated");
    // O hook nunca navega sozinho — quem decide ir para /login a partir de
    // `status==="unauthenticated"` é o consumidor (ex.:
    // `MustChangePasswordGate`), que tem seu próprio `useRouter()`.
    expect(screen.getByTestId("user-name").textContent).toBe("null");
  });

  it("403 -> forbidden, nunca tratado como logout", async () => {
    api.apiFetch.mockResolvedValue(response(403));

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("forbidden");
  });

  it.each([502, 503, 504])(
    "%i preserva a sessão — reconnecting, nunca ready nem redireciona",
    async (status) => {
      api.apiFetch.mockResolvedValue(response(status));

      renderProbe();
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("status").textContent).toBe("reconnecting");
    },
  );

  it("falha de rede/timeout -> reconnecting, nunca ready", async () => {
    api.apiFetch.mockRejectedValue(new Error("network"));

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("reconnecting");
  });

  it("recupera para ready após backoff, sem acumular timers", async () => {
    jest.useFakeTimers();
    api.apiFetch
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response(200, VALID_USER_BODY));

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("status").textContent).toBe("reconnecting");
    expect(api.apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(api.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("cancela o timer pendente no unmount", async () => {
    jest.useFakeTimers();
    api.apiFetch.mockRejectedValue(new Error("network"));

    const { unmount } = renderProbe();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);

    unmount();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
  });

  it("refresh() reexecuta a busca e atualiza o usuário sem reload", async () => {
    api.apiFetch
      .mockResolvedValueOnce(response(200, VALID_USER_BODY))
      .mockResolvedValueOnce(
        response(200, { ...VALID_USER_BODY, name: "Fulana Atualizada" }),
      );

    renderProbe();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("user-name").textContent).toBe("Fulana");

    await act(async () => {
      screen.getByRole("button", { name: "refresh" }).click();
      await Promise.resolve();
    });

    expect(screen.getByTestId("user-name").textContent).toBe(
      "Fulana Atualizada",
    );
    expect(api.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("com um Provider acima, dois consumidores nunca duplicam o fetch (mesmo estado compartilhado)", async () => {
    api.apiFetch.mockResolvedValue(response(200, VALID_USER_BODY));

    function SecondConsumer() {
      const { user } = useCurrentUser();
      return <span data-testid="second-consumer">{user ? user.name : "null"}</span>;
    }

    render(
      <CurrentUserProvider>
        <Probe />
        <SecondConsumer />
      </CurrentUserProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("user-name").textContent).toBe("Fulana");
    expect(screen.getByTestId("second-consumer").textContent).toBe("Fulana");
    expect(api.apiFetch).toHaveBeenCalledTimes(1);
  });

  it("sem um Provider acima, cai no fallback standalone (própria busca independente)", async () => {
    api.apiFetch.mockResolvedValue(response(200, VALID_USER_BODY));

    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("user-name").textContent).toBe("Fulana");
  });
});

describe("hasPermission / hasAnyPermission — fail-closed", () => {
  const baseUser: CurrentUser = {
    id: "u1",
    name: "Fulana",
    email: "fulana@example.com",
    isAdmin: false,
    role: "ANALYST",
    permissions: ["dashboard.view", "customers.view"],
    accountScope: { mode: "ALL" },
    mustChangePassword: false,
  };

  it("hasPermission: usuário nulo nunca concede", () => {
    expect(hasPermission(null, "dashboard.view")).toBe(false);
  });

  it("hasPermission: permissão presente/ausente", () => {
    expect(hasPermission(baseUser, "dashboard.view")).toBe(true);
    expect(hasPermission(baseUser, "users.manage")).toBe(false);
  });

  it("hasAnyPermission: usuário nulo nunca concede", () => {
    expect(hasAnyPermission(null, ["dashboard.view"])).toBe(false);
  });

  it("hasAnyPermission: concede se ao menos uma bater", () => {
    expect(hasAnyPermission(baseUser, ["users.manage", "customers.view"])).toBe(
      true,
    );
    expect(hasAnyPermission(baseUser, ["users.manage", "users.view"])).toBe(
      false,
    );
  });
});
