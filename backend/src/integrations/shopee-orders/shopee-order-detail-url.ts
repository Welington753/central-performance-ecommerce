import { assertAllowedShopApiHost } from '../shopee-oauth/shopee-shop-api-url';
import {
  SHOPEE_ENDPOINTS,
  ShopeeEnvironment,
} from '../shopee-oauth/shopee-endpoints';
import {
  SHOPEE_ORDER_DETAIL_PATH,
  SHOPEE_ORDER_DETAIL_RESPONSE_OPTIONAL_FIELDS,
} from './shopee-order-endpoints';

export interface ShopeeOrderDetailUrlParams {
  environment: ShopeeEnvironment;
  partnerId: string;
  timestampSeconds: number;
  accessToken: string;
  shopId: string;
  sign: string;
  orderSnList: string[];
}

/**
 * Monta a URL de `GET /api/v2/order/get_order_detail` (Checkpoint CP2K-2)
 * somente via `URL`/`URLSearchParams` - nunca concatenação de strings.
 * `response_optional_fields` é SEMPRE a constante fechada
 * `SHOPEE_ORDER_DETAIL_RESPONSE_OPTIONAL_FIELDS` - o parâmetro desta função
 * nem aceita esse valor do chamador (não existe na interface). Reaproveita
 * `assertAllowedShopApiHost` (mesma allowlist do CP2I/CP2K-1).
 */
export function buildShopeeOrderDetailUrl(
  params: ShopeeOrderDetailUrlParams,
): URL {
  const shopApiHost = SHOPEE_ENDPOINTS[params.environment].shopApiHost;
  const hostUrl = new URL(shopApiHost);
  assertAllowedShopApiHost(hostUrl);

  const url = new URL(SHOPEE_ORDER_DETAIL_PATH, hostUrl);
  url.search = '';
  url.searchParams.set('partner_id', params.partnerId);
  url.searchParams.set('timestamp', String(params.timestampSeconds));
  url.searchParams.set('access_token', params.accessToken);
  url.searchParams.set('shop_id', params.shopId);
  url.searchParams.set('sign', params.sign);
  url.searchParams.set('order_sn_list', params.orderSnList.join(','));
  url.searchParams.set(
    'response_optional_fields',
    SHOPEE_ORDER_DETAIL_RESPONSE_OPTIONAL_FIELDS,
  );
  return url;
}
