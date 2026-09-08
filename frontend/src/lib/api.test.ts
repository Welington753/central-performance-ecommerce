import { ApiFetchError, fetchBackfillStatus, syncMercadoLivreOrders } from "./api";

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
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(409, { statusCode: 409, message: "TOKEN_EXPIRED", error: "Conflict" }),
      );

    const error = await syncMercadoLivreOrders("acc-1").catch((e: unknown) => e);

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

    const error = await syncMercadoLivreOrders("acc-1").catch((e: unknown) => e);

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
    };
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, full));

    await expect(fetchBackfillStatus("acc-1")).resolves.toEqual(full);
  });

  it("normaliza synchronizedIntervals ausente para [] em vez de deixar undefined (contrato antigo/backend não reiniciado)", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse(200, { oldestCoveredAt: "2026-07-04", historyComplete: false }),
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
