import { renderHook, waitFor } from "@testing-library/react";
import { useAuthGuard } from "@/hooks/useAuthGuard";

const replaceMock = jest.fn();
// Objeto estável: o router real do Next.js mantém a mesma referência entre
// renders. Recriar um objeto novo a cada chamada de useRouter() quebraria o
// array de dependências do useEffect em useAuthGuard (efeito re-executaria a
// cada render).
const routerMock = {
  push: jest.fn(),
  replace: replaceMock,
};

jest.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

describe("useAuthGuard", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    (global.fetch as jest.Mock | undefined) = jest.fn();
  });

  it("começa em estado 'checking'", () => {
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuthGuard());

    expect(result.current).toBe("checking");
  });

  it("fica 'authenticated' e não redireciona quando /auth/me responde 200", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "user-1" }),
    });

    const { result } = renderHook(() => useAuthGuard());

    await waitFor(() => expect(result.current).toBe("authenticated"));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redireciona para /login quando /auth/me responde com erro (401)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized" }),
    });

    const { result } = renderHook(() => useAuthGuard());

    await waitFor(() => expect(result.current).toBe("unauthenticated"));
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });

  it("redireciona para /login quando a chamada falha por rede (backend indisponível)", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("fetch failed: ECONNREFUSED"),
    );

    const { result } = renderHook(() => useAuthGuard());

    await waitFor(() => expect(result.current).toBe("unauthenticated"));
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });
});
