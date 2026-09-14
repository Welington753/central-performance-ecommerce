import { assertAllowedShopApiHost } from '../shopee-oauth/shopee-shop-api-url';
import {
  SHOPEE_ENDPOINTS,
  ShopeeEnvironment,
} from '../shopee-oauth/shopee-endpoints';
import { SHOPEE_ORDER_LIST_PATH } from './shopee-order-endpoints';
import { ShopeeOrderListTimeRangeField } from './shopee-order-list-input';

export interface ShopeeOrderListUrlParams {
  environment: ShopeeEnvironment;
  partnerId: string;
  timestampSeconds: number;
  accessToken: string;
  shopId: string;
  sign: string;
  timeRangeField: ShopeeOrderListTimeRangeField;
  timeFrom: number;
  timeTo: number;
  pageSize: number;
  /** `null` omite o parâmetro `cursor` da URL (primeira página). */
  cursor: string | null;
}

/**
 * Monta a URL de `GET /api/v2/order/get_order_list` (Checkpoint CP2K-1)
 * somente via `URL`/`URLSearchParams` - nunca concatenação de strings.
 * `environment` é o único grau de liberdade sobre o host: indexa
 * `SHOPEE_ENDPOINTS`, nunca constrói um host livre. O path é sempre a
 * constante fechada `SHOPEE_ORDER_LIST_PATH`, nunca recebido por parâmetro.
 *
 * Reaproveita `assertAllowedShopApiHost` (`../shopee-oauth/shopee-shop-api-url.ts`)
 * - a MESMA allowlist já exaustivamente provada contra host adulterado/
 * domínio parecido/truque de sufixo para o cliente de `get_shop_info`
 * (Checkpoint CP2I). Nenhuma cópia própria, nenhuma checagem enfraquecida.
 */
export function buildShopeeOrderListUrl(params: ShopeeOrderListUrlParams): URL {
  const shopApiHost = SHOPEE_ENDPOINTS[params.environment].shopApiHost;
  const hostUrl = new URL(shopApiHost);
  assertAllowedShopApiHost(hostUrl);

  const url = new URL(SHOPEE_ORDER_LIST_PATH, hostUrl);
  url.search = '';
  url.searchParams.set('partner_id', params.partnerId);
  url.searchParams.set('timestamp', String(params.timestampSeconds));
  url.searchParams.set('access_token', params.accessToken);
  url.searchParams.set('shop_id', params.shopId);
  url.searchParams.set('sign', params.sign);
  url.searchParams.set('time_range_field', params.timeRangeField);
  url.searchParams.set('time_from', String(params.timeFrom));
  url.searchParams.set('time_to', String(params.timeTo));
  url.searchParams.set('page_size', String(params.pageSize));
  if (params.cursor !== null) {
    url.searchParams.set('cursor', params.cursor);
  }
  return url;
}
