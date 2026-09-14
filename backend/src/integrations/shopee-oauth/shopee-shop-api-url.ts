import {
  SHOPEE_ENDPOINTS,
  SHOPEE_SHOP_INFO_PATH,
  ShopeeEnvironment,
} from './shopee-endpoints';

export interface ShopeeShopInfoUrlParams {
  environment: ShopeeEnvironment;
  partnerId: string;
  timestampSeconds: number;
  accessToken: string;
  shopId: string;
  sign: string;
}

export class ShopeeShopApiUrlBuildError extends Error {}

/**
 * Allowlist derivada diretamente de `shopee-endpoints.ts` — mesmo padrão de
 * `ALLOWED_AUTHORIZATION_HOSTS` em `shopee-build-authorization-url.ts`. Nunca
 * uma cópia manual que possa divergir da fonte única.
 */
const ALLOWED_SHOP_API_ORIGINS: ReadonlySet<string> = new Set(
  Object.values(SHOPEE_ENDPOINTS).map((endpoint) => endpoint.shopApiHost),
);

/**
 * Defesa em profundidade (Checkpoint CP2I): mesmo que `shopApiHost` só possa
 * vir hoje do mapa fechado `SHOPEE_ENDPOINTS` (nunca de input externo), esta
 * checagem compara protocol + hostname + porta + pathname de forma EXATA
 * contra a allowlist — protege contra um host adulterado por um bug futuro
 * (subdomínio parecido, credenciais embutidas, path/fragmento inesperado,
 * porta diferente) antes que ele chegue a ser usado para montar uma
 * requisição real.
 */
export function assertAllowedShopApiHost(hostUrl: URL): void {
  if (hostUrl.username !== '' || hostUrl.password !== '') {
    throw new ShopeeShopApiUrlBuildError('SHOPEE_SHOP_API_HOST_NOT_ALLOWED');
  }
  if (hostUrl.search !== '' || hostUrl.hash !== '') {
    throw new ShopeeShopApiUrlBuildError('SHOPEE_SHOP_API_HOST_NOT_ALLOWED');
  }
  if (hostUrl.pathname !== '/' && hostUrl.pathname !== '') {
    throw new ShopeeShopApiUrlBuildError('SHOPEE_SHOP_API_HOST_NOT_ALLOWED');
  }

  const origin = `${hostUrl.protocol}//${hostUrl.host}`;
  if (!ALLOWED_SHOP_API_ORIGINS.has(origin)) {
    throw new ShopeeShopApiUrlBuildError('SHOPEE_SHOP_API_HOST_NOT_ALLOWED');
  }
}

/**
 * Monta a URL de `GET /api/v2/shop/get_shop_info` (Checkpoint CP2I) somente
 * via `URL`/`URLSearchParams` — nunca concatenação de strings. `environment`
 * é o único grau de liberdade sobre o host: ele é usado para indexar
 * `SHOPEE_ENDPOINTS`, nunca para construir um host livre. O path é sempre a
 * constante fechada `SHOPEE_SHOP_INFO_PATH`, nunca recebido por parâmetro.
 */
export function buildShopeeShopInfoUrl(params: ShopeeShopInfoUrlParams): URL {
  const shopApiHost = SHOPEE_ENDPOINTS[params.environment].shopApiHost;
  const hostUrl = new URL(shopApiHost);
  assertAllowedShopApiHost(hostUrl);

  const url = new URL(SHOPEE_SHOP_INFO_PATH, hostUrl);
  url.search = '';
  url.searchParams.set('partner_id', params.partnerId);
  url.searchParams.set('timestamp', String(params.timestampSeconds));
  url.searchParams.set('access_token', params.accessToken);
  url.searchParams.set('shop_id', params.shopId);
  url.searchParams.set('sign', params.sign);
  return url;
}
