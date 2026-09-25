import type { NextConfig } from "next";

/**
 * Checkpoint CP2K-6B-2E — proxy same-origin para ambientes (como o Render
 * Free) onde frontend e backend ficam em subdomínios distintos de um
 * domínio público compartilhado (`onrender.com`, presente na Public Suffix
 * List): sem isso, o navegador veria as duas origens como cross-site, e
 * cookies `SameSite=Lax` (nunca alterados para `None` aqui) não seriam
 * enviados em chamadas fetch/XHR entre elas.
 *
 * `BACKEND_PROXY_URL` só existe no lado do servidor (build time — o Next
 * grava os rewrites no manifesto de rotas durante `next build`, não os
 * reavalia a cada boot do `server.js` standalone) e nunca é exposta ao
 * navegador — diferente de `NEXT_PUBLIC_API_URL`, nunca é embutida no
 * bundle do cliente.
 */
const backendProxyUrl = process.env.BACKEND_PROXY_URL?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Checkpoint CP2K-6B-2A: build de produção em container — gera
  // `.next/standalone` com só as dependências realmente usadas em runtime
  // (trace automático), evitando copiar `node_modules` inteiro para a
  // imagem final. Não afeta `next dev`/`next start` local (só muda o que
  // `next build` produz a mais).
  output: "standalone",

  // Sem BACKEND_PROXY_URL definido: nenhum rewrite — comportamento local
  // atual preservado (frontend fala direto com o backend via
  // NEXT_PUBLIC_API_URL, como sempre foi). Lista fechada de prefixos —
  // nunca um "/:path*" genérico, que capturaria páginas do próprio Next
  // (/login, /integracoes, /dashboard, /sincronizacoes).
  async rewrites() {
    if (!backendProxyUrl) {
      return [];
    }
    return [
      { source: "/auth/:path*", destination: `${backendProxyUrl}/auth/:path*` },
      { source: "/health", destination: `${backendProxyUrl}/health` },
      { source: "/version", destination: `${backendProxyUrl}/version` },
      {
        source: "/marketplace-accounts/:path*",
        destination: `${backendProxyUrl}/marketplace-accounts/:path*`,
      },
      {
        source: "/marketplace-analytics/:path*",
        destination: `${backendProxyUrl}/marketplace-analytics/:path*`,
      },
      { source: "/sync-runs", destination: `${backendProxyUrl}/sync-runs` },
      {
        source: "/integrations/:path*",
        destination: `${backendProxyUrl}/integrations/:path*`,
      },
      // API da função "Clientes" — a página do frontend é `/clientes`, sem colisão.
      {
        source: "/customers/:path*",
        destination: `${backendProxyUrl}/customers/:path*`,
      },
    ];
  },
};

export default nextConfig;
