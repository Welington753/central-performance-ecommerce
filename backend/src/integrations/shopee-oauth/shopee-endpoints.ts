export type ShopeeEnvironment = 'SANDBOX' | 'PRODUCTION';

interface ShopeeEndpointSet {
  apiHost: string;
  /**
   * Host da Shop API (Checkpoint CP2I) — DISTINTO de `apiHost` em produção.
   * `apiHost` (`partner.shopeemobile.com`) é usado exclusivamente pelo
   * cliente de token (`ShopeeHttpClient`, endpoints `/auth/token/get` e
   * `/auth/access_token/get`) e NUNCA foi alterado aqui — nenhuma alteração
   * ampla/silenciosa de host de fluxo já existente. A documentação oficial
   * confirmada para a Shop API (ex.: `/api/v2/shop/get_shop_info`) usa hosts
   * diferentes por ambiente:
   *   - Sandbox: mesmo host de `apiHost` (`openplatform.sandbox.test-stable.shopee.sg`);
   *   - Produção Brasil: `openplatform.shopee.com.br` (não
   *     `partner.shopeemobile.com`).
   * Qualquer cliente da Shop API (`ShopeeShopApiClient`) deve resolver o host
   * exclusivamente a partir deste campo, nunca de `apiHost`.
   */
  shopApiHost: string;
  /**
   * Host de autorização (tela de login/consentimento da loja), por
   * ambiente. `null` quando não confirmado na documentação oficial
   * disponível nesta fase — NUNCA inventado. Qualquer código que precise
   * desta URL deve tratar `null` como "ainda não implementado", nunca usar a
   * URL de produção como substituto de um ambiente não confirmado.
   *
   * Checkpoint CP2D: hosts de autorização Brasil (Sandbox e Produção) agora
   * CONFIRMADOS e registrados nesta allowlist — este host de autorização é
   * distinto de `openplatform.sandbox.test-stable.shopee.sg` (API Sandbox,
   * sem alteração): a tela de autorização Sandbox tem domínio próprio,
   * nunca compartilha host com a API.
   *
   * Checkpoint CP2F-R1 (correção): `open.sandbox.test-stable.shopee.com.br`
   * NUNCA resolveu em DNS real (NXDOMAIN confirmado) — o host `.com.br`
   * para Sandbox nunca existiu de fato na infraestrutura da Shopee. O
   * fluxo real de autorização Sandbox (confirmado no Console da Shopee,
   * login + autorização completos) usa o host global
   * `open.sandbox.test-stable.shopee.com` (sem `.br`). Produção
   * (`open.shopee.com.br`) permanece inalterada — só o Sandbox tinha o
   * host `.com.br` inválido.
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

/** Path fechado da Shop API `v2.shop.get_shop_info` (Checkpoint CP2I). */
export const SHOPEE_SHOP_INFO_PATH = '/api/v2/shop/get_shop_info';

export const SHOPEE_ENDPOINTS: Record<ShopeeEnvironment, ShopeeEndpointSet> = {
  PRODUCTION: {
    apiHost: 'https://partner.shopeemobile.com',
    shopApiHost: 'https://openplatform.shopee.com.br',
    authorizationHost: 'https://open.shopee.com.br/auth',
  },
  SANDBOX: {
    apiHost: 'https://openplatform.sandbox.test-stable.shopee.sg',
    shopApiHost: 'https://openplatform.sandbox.test-stable.shopee.sg',
    authorizationHost: 'https://open.sandbox.test-stable.shopee.com/auth',
  },
};

export function isShopeeEnvironment(value: string): value is ShopeeEnvironment {
  return value === 'SANDBOX' || value === 'PRODUCTION';
}
