/**
 * Em produção (Render Free) `NEXT_PUBLIC_API_URL` fica vazia de propósito:
 * `apiFetch` gera caminhos relativos e só os prefixos listados nos
 * `rewrites()` de `next.config.ts` chegam ao backend — o resto cai no
 * próprio Next e volta 404. Este teste registra as URLs REAIS de todas as
 * operações de "Problemas" e exige que cada uma seja encaminhada ao backend
 * (e que a página `/problemas` continue sendo rota do frontend).
 */
import type * as NextConfigModule from "../../next.config";
import type * as ProblemsApiModule from "./problems-api";
import { EMPTY_PROBLEMS_FILTERS, type ProblemsFilters } from "@/types/problems";

type Rewrite = { source: string; destination: string };

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalProxyUrl = process.env.BACKEND_PROXY_URL;
const originalFetch = global.fetch;

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROBLEM_ID = "22222222-2222-4222-8222-222222222222";

const FILTERS: ProblemsFilters = {
  ...EMPTY_PROBLEMS_FILTERS,
  from: "2026-01-01",
  to: "2026-01-31",
  marketplace: "MERCADO_LIVRE",
  accountId: ACCOUNT_ID,
  status: "opened",
  reasonId: "R1",
  responsibility: "SELLER",
  reputationImpact: "affected",
  pendingAction: "true",
  actionDue: "overdue",
  orderId: " 2000123 ",
};

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({}),
  } as unknown as Response;
}

/** Mesma semântica do Next: `/x/:path*` casa `/x` e `/x/...`; senão, caminho exato. */
function isProxied(url: string, rewrites: Rewrite[]): boolean {
  const pathname = url.split("?")[0];
  return rewrites.some(({ source }) => {
    if (source.endsWith("/:path*")) {
      const prefix = source.slice(0, -"/:path*".length);
      return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }
    return pathname === source;
  });
}

async function loadModules(): Promise<{ api: typeof ProblemsApiModule; rewrites: Rewrite[] }> {
  jest.resetModules();
  delete process.env.NEXT_PUBLIC_API_URL;
  process.env.BACKEND_PROXY_URL = "http://backend-test:3000";
  const config: typeof NextConfigModule = await import("../../next.config");
  const rewrites = ((await config.default.rewrites?.()) ?? []) as Rewrite[];
  const api: typeof ProblemsApiModule = await import("./problems-api");
  return { api, rewrites };
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.resetModules();
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  if (originalProxyUrl === undefined) delete process.env.BACKEND_PROXY_URL;
  else process.env.BACKEND_PROXY_URL = originalProxyUrl;
});

describe("problems-api — chamadas same-origin chegam ao backend pelo proxy", () => {
  it("todas as operações usam apiFetch, credentials include e caminhos cobertos pelos rewrites", async () => {
    const fetchMock = jest.fn(async () => okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
    const { api, rewrites } = await loadModules();

    await api.fetchProblemsSummary(FILTERS);
    await api.fetchProblemsReasons(FILTERS);
    await api.fetchProblems(FILTERS, { page: 2, pageSize: 25, sortBy: "dateCreated", sortDir: "desc" });
    await api.fetchProblemDetail(PROBLEM_ID);
    await api.updateProblemResponsibility(PROBLEM_ID, { responsibility: "SELLER", reason: "motivo" });
    await api.fetchProblemsSyncStatus();
    await api.changeProblemsSync(ACCOUNT_ID, "start");
    await api.changeProblemsSync(ACCOUNT_ID, "pause");
    await api.changeProblemsSync(ACCOUNT_ID, "resume");

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const urls = calls.map(([url]) => url);
    expect(urls.map((url) => url.split("?")[0])).toEqual([
      "/problems/summary",
      "/problems/reasons",
      "/problems",
      `/problems/${PROBLEM_ID}`,
      `/problems/${PROBLEM_ID}/responsibility`,
      "/problems/sync/status",
      `/problems/sync/accounts/${ACCOUNT_ID}/start`,
      `/problems/sync/accounts/${ACCOUNT_ID}/pause`,
      `/problems/sync/accounts/${ACCOUNT_ID}/resume`,
    ]);
    // Nenhuma URL relativa ficaria no domínio do frontend (404 do Next).
    expect(urls.filter((url) => !isProxied(url, rewrites))).toEqual([]);
    for (const [, init] of calls) expect(init.credentials).toBe("include");
    // Métodos das mutações.
    expect(calls[4][1].method).toBe("PATCH");
    expect(calls.slice(6).map(([, init]) => init.method)).toEqual(["POST", "POST", "POST"]);
  });

  it("a página /problemas NUNCA é encaminhada ao backend (continua rota do frontend)", async () => {
    const { rewrites } = await loadModules();
    expect(isProxied("/problemas", rewrites)).toBe(false);
    expect(isProxied("/problemas/qualquer", rewrites)).toBe(false);
    expect(isProxied("/problems", rewrites)).toBe(true);
  });

  it("filtros viram parâmetros só quando preenchidos; pedido é aparado; paginação e ordenação seguem a allowlist", async () => {
    const fetchMock = jest.fn(async () => okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
    const { api } = await loadModules();

    await api.fetchProblems(FILTERS, { page: 3, pageSize: 25, sortBy: "nextActionDueDate", sortDir: "asc" });
    await api.fetchProblems(EMPTY_PROBLEMS_FILTERS, { page: 1, pageSize: 25, sortBy: "dateCreated", sortDir: "desc" });

    const [[full], [empty]] = fetchMock.mock.calls as unknown as Array<[string]>;
    const params = new URL(full, "http://x").searchParams;
    expect(Object.fromEntries(params)).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      marketplace: "MERCADO_LIVRE",
      accountId: ACCOUNT_ID,
      status: "opened",
      reasonId: "R1",
      responsibility: "SELLER",
      reputationImpact: "affected",
      pendingAction: "true",
      actionDue: "overdue",
      orderId: "2000123",
      page: "3",
      pageSize: "25",
      sortBy: "nextActionDueDate",
      sortDir: "asc",
    });
    expect(Object.fromEntries(new URL(empty, "http://x").searchParams)).toEqual({
      page: "1",
      pageSize: "25",
      sortBy: "dateCreated",
      sortDir: "desc",
    });
  });

  it("401 em leitura renova a sessão e repete; em mutação NUNCA repete automaticamente", async () => {
    const statuses = [401, 200];
    const fetchMock = jest.fn(async () => {
      const status = statuses.shift() ?? 200;
      return { ...okResponse(), ok: status < 400, status } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { api } = await loadModules();

    await api.fetchProblemsSummary(EMPTY_PROBLEMS_FILTERS);
    const readUrls = (fetchMock.mock.calls as unknown as Array<[string]>).map(([url]) => url);
    expect(readUrls).toEqual(["/problems/summary", "/auth/refresh", "/problems/summary"]);

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => ({ ...okResponse(), ok: false, status: 401 }) as Response);
    await expect(api.changeProblemsSync(ACCOUNT_ID, "start")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("403 e 404 viram erros tipados com mensagem em português (sem revelar existência)", async () => {
    const { api } = await loadModules();
    global.fetch = jest.fn(async () => ({ ...okResponse(), ok: false, status: 403 }) as Response) as unknown as typeof fetch;
    await expect(api.fetchProblemsSummary(EMPTY_PROBLEMS_FILTERS)).rejects.toBeInstanceOf(api.ProblemsForbiddenError);
    global.fetch = jest.fn(async () => ({ ...okResponse(), ok: false, status: 404 }) as Response) as unknown as typeof fetch;
    await expect(api.fetchProblemDetail(PROBLEM_ID)).rejects.toBeInstanceOf(api.ProblemNotFoundError);
  });
});
