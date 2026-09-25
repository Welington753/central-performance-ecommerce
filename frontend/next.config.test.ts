/**
 * Checkpoint CP2K-6B-2E — prova (RED antes da implementação, GREEN depois)
 * de que o proxy same-origin existe e se comporta corretamente.
 *
 * Contexto do RED: antes deste checkpoint, `next.config.ts` não define
 * `rewrites()` — logo `GET /health` e `POST /auth/login` feitos contra a
 * origem do frontend nunca alcançavam o backend (404 do próprio Next, sem
 * nenhum encaminhamento). O desenho anterior dependia de
 * `NEXT_PUBLIC_API_URL` apontar diretamente para a origem do backend (URL
 * absoluta, embutida no bundle do navegador) — no Render Free isso seria
 * uma chamada cross-site entre dois subdomínios distintos de `onrender.com`
 * (domínio na Public Suffix List: cada `*.onrender.com` é seu próprio
 * registrable domain). Cookies `SameSite=Lax` (nunca alterado para `None`
 * neste checkpoint) não são enviados em fetch/XHR cross-site — só em
 * navegação top-level — então qualquer chamada autenticada feita assim
 * falharia silenciosamente com 401, mesmo com login bem-sucedido.
 */
import type * as NextConfigModule from "./next.config";
import type { NextConfig } from "next";

const originalBackendProxyUrl = process.env.BACKEND_PROXY_URL;

/**
 * `next.config.ts` lê `process.env.BACKEND_PROXY_URL` uma única vez, no
 * escopo do módulo — isso é intencional (espelha o comportamento real do
 * Next.js, que só avalia `next.config` no build/boot, não a cada request).
 * Por isso cada teste precisa resetar o cache de módulos e reimportar,
 * simulando um novo build/boot com a variável já definida.
 */
async function loadConfig(): Promise<NextConfig> {
  jest.resetModules();
  const mod: typeof NextConfigModule = await import("./next.config");
  return mod.default;
}

type Rewrite = { source: string; destination: string };

async function getRewrites(config: NextConfig): Promise<Rewrite[]> {
  const result = await config.rewrites?.();
  return (result ?? []) as Rewrite[];
}

afterEach(() => {
  jest.resetModules();
  if (originalBackendProxyUrl === undefined) {
    delete process.env.BACKEND_PROXY_URL;
  } else {
    process.env.BACKEND_PROXY_URL = originalBackendProxyUrl;
  }
});

describe("next.config rewrites — proxy same-origin (Checkpoint CP2K-6B-2E)", () => {
  it("preserva output: standalone", async () => {
    delete process.env.BACKEND_PROXY_URL;
    const nextConfig = await loadConfig();
    expect(nextConfig.output).toBe("standalone");
  });

  it("sem BACKEND_PROXY_URL definido, não gera nenhum rewrite (comportamento local atual preservado)", async () => {
    delete process.env.BACKEND_PROXY_URL;
    const nextConfig = await loadConfig();
    const rewrites = await getRewrites(nextConfig);
    expect(rewrites).toEqual([]);
  });

  it("com BACKEND_PROXY_URL definido, encaminha exatamente os 8 prefixos exigidos, sem capturar páginas do frontend", async () => {
    process.env.BACKEND_PROXY_URL = "http://backend-test:3000";
    const nextConfig = await loadConfig();
    const rewrites = await getRewrites(nextConfig);

    expect(rewrites).toEqual([
      {
        source: "/auth/:path*",
        destination: "http://backend-test:3000/auth/:path*",
      },
      { source: "/health", destination: "http://backend-test:3000/health" },
      { source: "/version", destination: "http://backend-test:3000/version" },
      {
        source: "/marketplace-accounts/:path*",
        destination: "http://backend-test:3000/marketplace-accounts/:path*",
      },
      {
        source: "/marketplace-analytics/:path*",
        destination: "http://backend-test:3000/marketplace-analytics/:path*",
      },
      {
        source: "/sync-runs",
        destination: "http://backend-test:3000/sync-runs",
      },
      {
        source: "/integrations/:path*",
        destination: "http://backend-test:3000/integrations/:path*",
      },
      {
        source: "/customers/:path*",
        destination: "http://backend-test:3000/customers/:path*",
      },
    ]);
  });

  it("normaliza barra final de BACKEND_PROXY_URL (evita barra dupla no destino)", async () => {
    process.env.BACKEND_PROXY_URL = "http://backend-test:3000/";
    const nextConfig = await loadConfig();
    const rewrites = await getRewrites(nextConfig);
    const health = rewrites?.find((r) => r.source === "/health");
    expect(health?.destination).toBe("http://backend-test:3000/health");
  });

  it("callback Shopee continua exatamente /integrations/shopee/callback (capturado por /integrations/:path*)", async () => {
    process.env.BACKEND_PROXY_URL = "http://backend-test:3000";
    const nextConfig = await loadConfig();
    const rewrites = await getRewrites(nextConfig);
    const integrations = rewrites?.find(
      (r) => r.source === "/integrations/:path*",
    );
    expect(integrations?.destination).toBe(
      "http://backend-test:3000/integrations/:path*",
    );
  });

  it("nunca gera um rewrite genérico /:path* que capturaria páginas do frontend (/integracoes, /login)", async () => {
    process.env.BACKEND_PROXY_URL = "http://backend-test:3000";
    const nextConfig = await loadConfig();
    const rewrites = await getRewrites(nextConfig);
    const sources = (rewrites ?? []).map((r) => r.source);
    expect(sources).not.toContain("/:path*");
    expect(sources).not.toContain("/integracoes");
    expect(sources).not.toContain("/login");
    expect(sources).not.toContain("/clientes");
    expect(sources).not.toContain("/clientes/:path*");
  });
});
