export type ShopeeEnvironment = 'SANDBOX' | 'PRODUCTION';

interface ShopeeEndpointSet {
  apiHost: string;
  /**
   * Host de autorização (tela de login/consentimento da loja), por
   * ambiente. `null` quando não confirmado na documentação oficial
   * disponível nesta fase — NUNCA inventado. Qualquer código que precise
   * desta URL deve tratar `null` como "ainda não implementado", nunca usar a
   * URL de produção como substituto de um ambiente não confirmado.
   *
   * Checkpoint CP2D: hosts de autorização Brasil (Sandbox e Produção) agora
   * CONFIRMADOS e registrados nesta allowlist — `open.sandbox.test-stable.
   * shopee.com.br` é um host distinto de `openplatform.sandbox.test-stable.
   * shopee.sg` (API Sandbox, sem alteração): a tela de autorização Sandbox
   * Brasil tem domínio próprio, nunca compartilha host com a API.
   */
  authorizationHost: string | null;
}

/**
 * Endpoints oficiais por ambiente (Checkpoint CP2A, hosts de autorização
 * Brasil confirmados no CP2D) — allowlist interna fechada, nunca uma URL
 * livre configurável por variável de ambiente. `SHOPEE_API_BASE_URL`
 * propositalmente NÃO existe em `.env.example`: o host de API é sempre
 * resolvido a partir de `SHOPEE_ENVIRONMENT`, nunca de uma URL arbitrária
 * (mesma razão de `amazon-sp-api-endpoint.allowlist.ts` — protege contra
 * SSRF via configuração adulterada). `buildShopeeAuthorizationUrl`
 * (`shopee-build-authorization-url.ts`) revalida `authorizationHost` contra
 * esta MESMA allowlist antes de montar qualquer URL — nunca aceita um host
 * arbitrário vindo de configuração ou requisição.
 */
export const SHOPEE_TOKEN_PATH = '/api/v2/auth/token/get';
export const SHOPEE_REFRESH_TOKEN_PATH = '/api/v2/auth/access_token/get';

export const SHOPEE_ENDPOINTS: Record<ShopeeEnvironment, ShopeeEndpointSet> = {
  PRODUCTION: {
    apiHost: 'https://partner.shopeemobile.com',
    authorizationHost: 'https://open.shopee.com.br/auth',
  },
  SANDBOX: {
    apiHost: 'https://openplatform.sandbox.test-stable.shopee.sg',
    authorizationHost: 'https://open.sandbox.test-stable.shopee.com.br/auth',
  },
};

export function isShopeeEnvironment(value: string): value is ShopeeEnvironment {
  return value === 'SANDBOX' || value === 'PRODUCTION';
}
