export type ShopeeEnvironment = 'SANDBOX' | 'PRODUCTION';

interface ShopeeEndpointSet {
  apiHost: string;
  /**
   * Host de autorização (tela de login/consentimento da loja), por
   * ambiente. `null` quando não confirmado na documentação oficial
   * disponível nesta fase — NUNCA inventado. Hoje isso é exatamente o caso
   * do Sandbox Brasil: a documentação consultada confirma o host de API
   * Sandbox, mas não confirma um host de autorização Sandbox Brasil
   * separado do host de produção (`https://open.shopee.com.br/auth`).
   * Qualquer código que precise desta URL deve tratar `null` como "ainda
   * não implementado", nunca usar a URL de produção como substituto.
   */
  authorizationHost: string | null;
}

/**
 * Endpoints oficiais por ambiente (Checkpoint CP2A) — allowlist interna
 * fechada, nunca uma URL livre configurável por variável de ambiente.
 * `SHOPEE_API_BASE_URL` propositalmente NÃO existe em `.env.example`: o
 * host de API é sempre resolvido a partir de `SHOPEE_ENVIRONMENT`, nunca de
 * uma URL arbitrária (mesma razão de `amazon-sp-api-endpoint.allowlist.ts`
 * — protege contra SSRF via configuração adulterada).
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
    authorizationHost: null,
  },
};

export function isShopeeEnvironment(value: string): value is ShopeeEnvironment {
  return value === 'SANDBOX' || value === 'PRODUCTION';
}
