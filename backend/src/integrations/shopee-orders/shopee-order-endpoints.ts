/**
 * Path fechado de `v2.order.get_order_list` (Checkpoint CP2K-1), extraído da
 * documentação oficial local (CP2K-DOC). O host NUNCA vem daqui - é sempre
 * resolvido a partir de `SHOPEE_ENDPOINTS[environment].shopApiHost`
 * (`../shopee-oauth/shopee-endpoints.ts`), o MESMO host já confirmado para a
 * Shop API (`get_shop_info`, Checkpoint CP2I): Sandbox
 * `openplatform.sandbox.test-stable.shopee.sg`, Produção Brasil
 * `openplatform.shopee.com.br` - nenhuma mudança de host foi necessária.
 */
export const SHOPEE_ORDER_LIST_PATH = '/api/v2/order/get_order_list';
