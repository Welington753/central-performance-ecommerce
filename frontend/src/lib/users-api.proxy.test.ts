/**
 * Mesmo padrão de `customers-api.proxy.test.ts`: prova que, com base URL
 * vazia (same-origin, produção Render Free), todas as operações de usuários
 * são encaminhadas ao backend pelos `rewrites()` de `next.config.ts`, que
 * `/usuarios` continua sendo página do próprio Next (nunca proxied) e que
 * `changeOwnPassword` continua coberto pelo rewrite `/auth/:path*`.
 */
import type * as NextConfigModule from "../../next.config";
import type * as UsersApiModule from "./users-api";

type Rewrite = { source: string; destination: string };

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalProxyUrl = process.env.BACKEND_PROXY_URL;
const originalFetch = global.fetch;

const USER_ID = "11111111-1111-4111-8111-111111111111";

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      permissions: [],
      presets: {},
      temporaryPassword: "x",
      success: true,
    }),
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
  api: typeof UsersApiModule;
  rewrites: Rewrite[];
}> {
  jest.resetModules();
  delete process.env.NEXT_PUBLIC_API_URL;
  process.env.BACKEND_PROXY_URL = "http://backend-test:3000";
  const config: typeof NextConfigModule = await import("../../next.config");
  const rewrites = ((await config.default.rewrites?.()) ?? []) as Rewrite[];
  const api: typeof UsersApiModule = await import("./users-api");
  return { api, rewrites };
}

async function callAllOperations(api: typeof UsersApiModule) {
  await api.listUsers();
  await api.getPermissionsCatalog();
  await api.getUser(USER_ID);
  await api.setUserStatus(USER_ID, false);
  await api.resetUserPassword(USER_ID);
  await api.getUserAudit(USER_ID);
  return api.changeOwnPassword("atual12345678", "novaSenha12345678");
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.resetModules();
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  if (originalProxyUrl === undefined) delete process.env.BACKEND_PROXY_URL;
  else process.env.BACKEND_PROXY_URL = originalProxyUrl;
});

describe("users-api — chamadas same-origin chegam ao backend pelo proxy", () => {
  it("todas as operações de usuários usam apiFetch e caminhos cobertos pelos rewrites", async () => {
    const fetchMock = jest.fn(async () => okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
    const { api, rewrites } = await loadModules();

    await callAllOperations(api);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const urls = calls.map(([url]) => url);
    expect(urls.map((url) => url.split("?")[0])).toEqual([
      "/users",
      "/users/permissions-catalog",
      `/users/${USER_ID}`,
      `/users/${USER_ID}/status`,
      `/users/${USER_ID}/reset-password`,
      `/users/${USER_ID}/audit`,
      "/auth/change-password",
    ]);
    // Nenhuma URL relativa ficaria no domínio do frontend (404 do Next).
    expect(urls.filter((url) => !isProxied(url, rewrites))).toEqual([]);
    // /usuarios nunca é uma dessas URLs — continua página do próprio Next.
    expect(urls).not.toContain("/usuarios");
    // Mecanismo compartilhado preservado: cookies de sessão sempre enviados.
    for (const [, init] of calls) expect(init.credentials).toBe("include");
  });

  it("401 em Usuários renova a sessão pelo fluxo compartilhado e repete a chamada", async () => {
    const statuses = [401, 200, 200];
    const fetchMock = jest.fn(async () => {
      const status = statuses.shift() ?? 200;
      return { ...okResponse(), ok: status < 400, status } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { api } = await loadModules();

    await api.getPermissionsCatalog();

    const urls = (fetchMock.mock.calls as unknown as Array<[string]>).map(
      ([url]) => url,
    );
    expect(urls).toEqual([
      "/users/permissions-catalog",
      "/auth/refresh",
      "/users/permissions-catalog",
    ]);
  });

  it("/usuarios não está entre os prefixos com rewrite (continua página do Next)", async () => {
    const { rewrites } = await loadModules();
    expect(isProxied("/usuarios", rewrites)).toBe(false);
  });
});
