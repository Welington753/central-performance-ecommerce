import { ApiFetchError, syncMercadoLivreOrders } from "./api";

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
