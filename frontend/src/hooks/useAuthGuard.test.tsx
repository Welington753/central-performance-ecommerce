import { act, renderHook } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { useAuthGuard } from "./useAuthGuard";

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

// Caminho relativo real (não o alias `@/*`) — mesmo padrão de
// `dashboard/metas/page.test.tsx` para `jest.mock` de `lib/api`.
jest.mock("../lib/api", () => ({
  apiFetch: jest.fn(),
}));

const api = jest.requireMock("../lib/api") as { apiFetch: jest.Mock };
const replace = jest.fn();

function response(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useRouter as jest.Mock).mockReturnValue({ replace });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useAuthGuard", () => {
  it("retorna authenticated quando /auth/me responde 200, sem redirecionar", async () => {
    api.apiFetch.mockResolvedValue(response(200));

    const { result } = renderHook(() => useAuthGuard());
    expect(result.current).toBe("checking");

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe("authenticated");
    expect(replace).not.toHaveBeenCalled();
    expect(api.apiFetch).toHaveBeenCalledWith("/auth/me", {
      method: "GET",
      cache: "no-store",
    });
  });

  it("redireciona para /login somente em 401 confirmado", async () => {
    api.apiFetch.mockResolvedValue(response(401));

    const { result } = renderHook(() => useAuthGuard());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe("unauthenticated");
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("403 mostra estado de acesso negado, sem redirecionar", async () => {
    api.apiFetch.mockResolvedValue(response(403));

    const { result } = renderHook(() => useAuthGuard());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe("forbidden");
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([502, 503, 504])(
    "%i preserva a sessão — não redireciona, entra em 'reconectando'",
    async (status) => {
      api.apiFetch.mockResolvedValue(response(status));

      const { result } = renderHook(() => useAuthGuard());
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current).toBe("reconnecting");
      expect(replace).not.toHaveBeenCalled();
    },
  );

  it("falha de rede/timeout preserva a sessão — não redireciona, entra em 'reconectando'", async () => {
    api.apiFetch.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useAuthGuard());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBe("reconnecting");
    expect(replace).not.toHaveBeenCalled();
  });

  it("tenta de novo com backoff após falha temporária e se recupera para authenticated", async () => {
    jest.useFakeTimers();
    api.apiFetch
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response(200));

    const { result } = renderHook(() => useAuthGuard());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe("reconnecting");
    expect(api.apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    expect(result.current).toBe("authenticated");
    expect(api.apiFetch).toHaveBeenCalledTimes(2);
  });

  it("mantém só um timer ativo — uma tentativa por intervalo de backoff, nunca acumula", async () => {
    jest.useFakeTimers();
    api.apiFetch.mockRejectedValue(new Error("network"));

    renderHook(() => useAuthGuard());
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(api.apiFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(4000);
    });
    expect(api.apiFetch).toHaveBeenCalledTimes(3);
  });

  it("cancela o timer pendente no unmount — nenhuma chamada extra depois de desmontar", async () => {
    jest.useFakeTimers();
    api.apiFetch.mockRejectedValue(new Error("network"));

    const { unmount } = renderHook(() => useAuthGuard());
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

  it("tenta imediatamente ao receber foco durante 'reconectando', sem esperar o backoff", async () => {
    jest.useFakeTimers();
    api.apiFetch
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response(200));

    const { result } = renderHook(() => useAuthGuard());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe("reconnecting");
    expect(api.apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(api.apiFetch).toHaveBeenCalledTimes(2);
    expect(result.current).toBe("authenticated");
  });

  it("depois de recuperar de um 502/503/504, restaura authenticated normalmente", async () => {
    jest.useFakeTimers();
    api.apiFetch
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200));

    const { result } = renderHook(() => useAuthGuard());
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe("reconnecting");

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(result.current).toBe("authenticated");
  });
});
