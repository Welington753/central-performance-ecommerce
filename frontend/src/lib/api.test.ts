import * as fs from "fs";
import * as path from "path";
import {
  ApiFetchError,
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
