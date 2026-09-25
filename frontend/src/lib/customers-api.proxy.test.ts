/**
 * Em produção (Render Free) `NEXT_PUBLIC_API_URL` fica vazia de propósito:
 * `apiFetch` gera caminhos relativos e só os prefixos listados nos
 * `rewrites()` de `next.config.ts` chegam ao backend — o resto cai no
 * próprio Next e volta 404. Este teste registra as URLs REAIS de todas as
 * operações de Clientes e exige que cada uma seja encaminhada ao backend.
 */
import type * as NextConfigModule from "../../next.config";
import type * as CustomersApiModule from "./customers-api";
import type { CustomersFilters } from "@/types/customers";

type Rewrite = { source: string; destination: string };

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalProxyUrl = process.env.BACKEND_PROXY_URL;
const originalFetch = global.fetch;

const FILTERS: CustomersFilters = {
  marketplace: "ALL",
  accountId: "",
  allTime: true,
  from: "2026-01-01",
  to: "2026-01-31",
  customerType: "ALL",
  search: "",
  product: "",
  onlyWithEmail: false,
  onlyWithRecipientPhone: false,
};

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "Content-Disposition": 'attachment; filename="clientes-2026.xlsx"',
    }),
    json: async () => ({}),
    blob: async () => new Blob(["xlsx"]),
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

async function loadModules(): Promise<{
  api: typeof CustomersApiModule;
  rewrites: Rewrite[];
}> {
  jest.resetModules();
  delete process.env.NEXT_PUBLIC_API_URL;
  process.env.BACKEND_PROXY_URL = "http://backend-test:3000";
  const config: typeof NextConfigModule = await import("../../next.config");
  const rewrites = ((await config.default.rewrites?.()) ?? []) as Rewrite[];
  const api: typeof CustomersApiModule = await import("./customers-api");
  return { api, rewrites };
}

async function callAllOperations(api: typeof CustomersApiModule) {
  await api.fetchCustomersSummary(FILTERS, 1, 25);
  await api.fetchBuyerEnrichmentStatus();
  await api.startBuyerEnrichment();
  await api.startBuyerEnrichment(ACCOUNT_ID);
  await api.changeBuyerEnrichment(ACCOUNT_ID, "pause");
  await api.changeBuyerEnrichment(ACCOUNT_ID, "resume");
  return api.downloadCustomersExport(FILTERS, true);
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.resetModules();
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  if (originalProxyUrl === undefined) delete process.env.BACKEND_PROXY_URL;
  else process.env.BACKEND_PROXY_URL = originalProxyUrl;
});

describe("customers-api — chamadas same-origin chegam ao backend pelo proxy", () => {
  it("todas as operações de Clientes usam apiFetch e caminhos cobertos pelos rewrites", async () => {
    const fetchMock = jest.fn(async () => okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
    const { api, rewrites } = await loadModules();

    const exported = await callAllOperations(api);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const urls = calls.map(([url]) => url);
    expect(urls.map((url) => url.split("?")[0])).toEqual([
      "/customers/summary",
      "/customers/enrichment/status",
      "/customers/enrichment/start",
      "/customers/enrichment/start",
      `/customers/enrichment/${ACCOUNT_ID}/pause`,
      `/customers/enrichment/${ACCOUNT_ID}/resume`,
      "/customers/export.xlsx",
    ]);
    // Nenhuma URL relativa ficaria no domínio do frontend (404 do Next).
    expect(urls.filter((url) => !isProxied(url, rewrites))).toEqual([]);
    // Mecanismo compartilhado preservado: cookies de sessão sempre enviados.
    for (const [, init] of calls) expect(init.credentials).toBe("include");
    // Download continua Blob + nome vindo do Content-Disposition.
    expect(exported.filename).toBe("clientes-2026.xlsx");
    expect(exported.blob).toBeInstanceOf(Blob);
  });

  it("401 em Clientes renova a sessão pelo fluxo compartilhado e repete a chamada", async () => {
    const statuses = [401, 200, 200];
    const fetchMock = jest.fn(async () => {
      const status = statuses.shift() ?? 200;
      return { ...okResponse(), ok: status < 400, status } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { api } = await loadModules();

    await api.fetchBuyerEnrichmentStatus();

    const urls = (fetchMock.mock.calls as unknown as Array<[string]>).map(
      ([url]) => url,
    );
    expect(urls).toEqual([
      "/customers/enrichment/status",
      "/auth/refresh",
      "/customers/enrichment/status",
    ]);
  });
});
