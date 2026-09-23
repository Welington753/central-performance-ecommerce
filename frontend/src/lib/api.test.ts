import * as fs from "fs";
import * as path from "path";
import {
  ApiFetchError,
  apiFetch,
  fetchBackfillStatus,
  syncMercadoLivreOrders,
} from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("syncMercadoLivreOrders", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("extrai o código sanitizado do corpo de erro do backend ({ message: CODE }) para o campo .code", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(409, {
        statusCode: 409,
        message: "TOKEN_EXPIRED",
        error: "Conflict",
      }),
    );

    const error = await syncMercadoLivreOrders("acc-1").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiFetchError);
    expect((error as ApiFetchError).code).toBe("TOKEN_EXPIRED");
    expect((error as ApiFetchError).message).toBe(
      "Não foi possível sincronizar agora. Tente novamente.",
    );
  });

  it("nunca lança ao encontrar um corpo de erro sem JSON válido — .code fica undefined, mensagem genérica preservada", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new Error("not json")),
    } as unknown as Response);

    const error = await syncMercadoLivreOrders("acc-1").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiFetchError);
    expect((error as ApiFetchError).code).toBeUndefined();
  });

  it("resolve normalmente em uma resposta de sucesso, sem tocar em ApiFetchError", async () => {
    const summary = { status: "SUCCESS", ordersFetched: 0 };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, summary));

    await expect(syncMercadoLivreOrders("acc-1")).resolves.toEqual(summary);
  });
});

describe("fetchBackfillStatus (normalização — correção de regressão)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("passa adiante uma resposta já completa sem alterá-la", async () => {
    const full = {
      status: "IN_PROGRESS",
      oldestCoveredAt: "2026-07-04",
      firstOrderAt: "2026-07-04",
      lastOrderAt: "2026-09-04",
      synchronizedIntervals: [{ from: "2026-07-04", to: "2026-09-04" }],
      lastProcessedChunk: null,
      lastRunErrorCode: null,
      job: null,
      workerEnabled: true,
    };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, full));

    await expect(fetchBackfillStatus("acc-1")).resolves.toEqual(full);
  });

  it("normaliza synchronizedIntervals ausente para [] em vez de deixar undefined (contrato antigo/backend não reiniciado)", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        oldestCoveredAt: "2026-07-04",
        historyComplete: false,
      }),
    );

    const status = await fetchBackfillStatus("acc-1");

    expect(status.synchronizedIntervals).toEqual([]);
    expect(status.status).toBe("IN_PROGRESS");
  });

  it("normaliza uma resposta totalmente vazia sem lançar — nenhum campo obrigatório fica undefined", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    const status = await fetchBackfillStatus("acc-1");

    expect(status).toEqual({
      status: "NOT_STARTED",
      oldestCoveredAt: null,
      firstOrderAt: null,
      lastOrderAt: null,
      synchronizedIntervals: [],
      lastProcessedChunk: null,
      lastRunErrorCode: null,
      job: null,
      workerEnabled: false,
    });
  });

  it("preserva synchronizedIntervals quando já vem como array vazio", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        status: "NOT_STARTED",
        oldestCoveredAt: null,
        firstOrderAt: null,
        lastOrderAt: null,
        synchronizedIntervals: [],
        lastProcessedChunk: null,
        lastRunErrorCode: null,
      }),
    );

    await expect(
      fetchBackfillStatus("acc-1").then((s) => s.synchronizedIntervals),
    ).resolves.toEqual([]);
  });
});

describe("API_BASE_URL — same-origin (Checkpoint CP2K-6B-2E)", () => {
  const originalNextPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalNextPublicApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalNextPublicApiUrl;
    }
    global.fetch = originalFetch;
    jest.resetModules();
  });

  /**
   * `API_BASE_URL` é calculada uma única vez no escopo do módulo (espelha
   * `NEXT_PUBLIC_API_URL`, embutida em build time) — cada cenário precisa
   * resetar o cache de módulos e reimportar `apiFetch` com a env já
   * definida, simulando um novo build.
   */
  async function loadApiFetch(): Promise<typeof import("./api").apiFetch> {
    jest.resetModules();
    const mod = await import("./api");
    return mod.apiFetch;
  }

  it("sem NEXT_PUBLIC_API_URL definido, produz caminho relativo correto (same-origin)", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const apiFetch = await loadApiFetch();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/auth/login", { method: "POST" });

    expect(global.fetch).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("com NEXT_PUBLIC_API_URL vazia (string vazia), produz caminho relativo correto (same-origin explícito)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "";
    const apiFetch = await loadApiFetch();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/auth/login");

    expect(global.fetch).toHaveBeenCalledWith("/auth/login", expect.anything());
  });

  it("com NEXT_PUBLIC_API_URL absoluta, continua funcionando (uso local/desenvolvimento)", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";
    const apiFetch = await loadApiFetch();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/auth/login");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/auth/login",
      expect.anything(),
    );
  });

  it("normaliza barra final de NEXT_PUBLIC_API_URL, nunca produz barra dupla", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";
    const apiFetch = await loadApiFetch();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/auth/login");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example.com/auth/login",
      expect.anything(),
    );
  });

  it("nunca produz o literal 'undefined' no início da URL, mesmo sem NEXT_PUBLIC_API_URL", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const apiFetch = await loadApiFetch();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/auth/login");

    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).not.toMatch(/^undefined/);
    expect(calledUrl).toBe("/auth/login");
  });

  it("código-fonte não contém nenhum fallback hardcoded para localhost (garante ausência no build Render)", () => {
    const source = fs.readFileSync(path.join(__dirname, "api.ts"), "utf8");
    expect(source).not.toMatch(/localhost/i);
  });
});

/**
 * Fila de respostas por URL — cada chamada a uma URL consome a próxima
 * entrada da fila (a última entrada é reutilizada se a URL for chamada mais
 * vezes que entradas existentes). Uma entrada `Error` rejeita a chamada
 * (falha de rede), simulando o `catch` de `fetch`.
 */
function sequenceFetch(
  map: Record<string, Array<Response | Error>>,
): jest.Mock {
  const counts: Record<string, number> = {};
  return jest.fn((url: string) => {
    const list = map[url];
    if (!list) {
      return Promise.reject(new Error(`URL não mockada neste teste: ${url}`));
    }
    const index = counts[url] ?? 0;
    counts[url] = index + 1;
    const entry = list[Math.min(index, list.length - 1)];
    return entry instanceof Error
      ? Promise.reject(entry)
      : Promise.resolve(entry);
  });
}

describe("apiFetch — refresh automático em 401 (single-flight)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("401 em rota protegida dispara um único refresh e repete a chamada original exatamente uma vez", async () => {
    global.fetch = sequenceFetch({
      "/marketplace-accounts": [
        jsonResponse(401, {}),
        jsonResponse(200, [{ id: "acc-1" }]),
      ],
      "/auth/refresh": [jsonResponse(200, { user: {} })],
    });

    const response = await apiFetch("/marketplace-accounts");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "acc-1" }]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("quando /auth/refresh retorna 401 explícito, propaga o 401 original sem repetir a chamada (sessão realmente expirada)", async () => {
    global.fetch = sequenceFetch({
      "/marketplace-accounts": [jsonResponse(401, {})],
      "/auth/refresh": [jsonResponse(401, {})],
    });

    const response = await apiFetch("/marketplace-accounts");

    expect(response.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("quando /auth/refresh falha por rede, lança ApiFetchError('REFRESH_UNAVAILABLE') — nunca resolve como sessão expirada", async () => {
    global.fetch = sequenceFetch({
      "/marketplace-accounts": [jsonResponse(401, {})],
      "/auth/refresh": [new TypeError("network down")],
    });

    const error = await apiFetch("/marketplace-accounts").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiFetchError);
    expect((error as ApiFetchError).code).toBe("REFRESH_UNAVAILABLE");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("quando /auth/refresh responde 503, classifica como falha temporária — nunca sessão expirada", async () => {
    global.fetch = sequenceFetch({
      "/marketplace-accounts": [jsonResponse(401, {})],
      "/auth/refresh": [jsonResponse(503, {})],
    });

    const error = await apiFetch("/marketplace-accounts").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiFetchError);
    expect((error as ApiFetchError).code).toBe("REFRESH_UNAVAILABLE");
  });

  it("duas chamadas concorrentes que recebem 401 disparam apenas uma chamada a /auth/refresh", async () => {
    global.fetch = sequenceFetch({
      "/marketplace-accounts": [
        jsonResponse(401, {}),
        jsonResponse(200, ["a"]),
      ],
      "/sync-runs": [jsonResponse(401, {}), jsonResponse(200, ["b"])],
      "/auth/refresh": [jsonResponse(200, {})],
    });

    const [r1, r2] = await Promise.all([
      apiFetch("/marketplace-accounts"),
      apiFetch("/sync-runs"),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const refreshCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[0] === "/auth/refresh",
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it.each(["/auth/login", "/auth/refresh", "/auth/logout", "/health"])(
    "%s nunca dispara refresh mesmo recebendo 401",
    async (exemptPath) => {
      global.fetch = sequenceFetch({ [exemptPath]: [jsonResponse(401, {})] });

      const response = await apiFetch(exemptPath, { method: "POST" });

      expect(response.status).toBe(401);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("não repete indefinidamente: se a repetição pós-refresh também vier 401, retorna esse 401 sem novo refresh", async () => {
    global.fetch = sequenceFetch({
      "/marketplace-accounts": [jsonResponse(401, {}), jsonResponse(401, {})],
      "/auth/refresh": [jsonResponse(200, {})],
    });

    const response = await apiFetch("/marketplace-accounts");

    expect(response.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("apiFetch — timeout controlado (AbortController)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it("aborta a requisição ao esgotar o timeout e lança ApiFetchError (falha temporária, nunca 401)", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      },
    ) as typeof fetch;

    const pending = apiFetch("/marketplace-accounts", {}, 1000);
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiFetchError);
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("não aborta antes do timeout configurado — resposta rápida resolve normalmente", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { ok: true }));

    const pending = apiFetch("/marketplace-accounts", {}, 5000);
    await jest.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it("nunca ignora silenciosamente um AbortSignal fornecido pelo chamador — abortá-lo também aborta a requisição", async () => {
    global.fetch = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      },
    ) as typeof fetch;

    const callerController = new AbortController();
    const pending = apiFetch(
      "/marketplace-accounts",
      { signal: callerController.signal },
      30_000,
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiFetchError);
    callerController.abort();
    await assertion;
  });

  it("se o AbortSignal do chamador já vier abortado, a requisição nunca chega a ser enviada como bem-sucedida", async () => {
    global.fetch = jest.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        // Mesmo contrato do `fetch` real: um `signal` já abortado rejeita
        // imediatamente, sem esperar um evento `abort` que já disparou antes
        // deste listener existir.
        if (init?.signal?.aborted) {
          return Promise.reject(
            new DOMException("The operation was aborted.", "AbortError"),
          );
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        });
      },
    ) as typeof fetch;

    const callerController = new AbortController();
    callerController.abort();

    const pending = apiFetch(
      "/marketplace-accounts",
      { signal: callerController.signal },
      30_000,
    );

    await expect(pending).rejects.toBeInstanceOf(ApiFetchError);
  });
});
