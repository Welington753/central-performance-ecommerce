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

/** Path fechado de `v2.order.get_order_detail` (Checkpoint CP2K-2) - mesmo host da Shop API, ver comentário acima. */
export const SHOPEE_ORDER_DETAIL_PATH = '/api/v2/order/get_order_detail';

/**
 * `response_optional_fields` fechado e fixo (Checkpoint CP2K-2) - o cliente
 * NUNCA aceita este valor do chamador; sempre exatamente estes três campos,
 * nenhum campo pessoal (`buyer_user_id`, `recipient_address`, etc. nunca são
 * solicitados). `total_amount`/`item_list`/`fulfillment_flag` são os únicos
 * campos opcionais necessários para o mapper de um checkpoint futuro.
 */
export const SHOPEE_ORDER_DETAIL_RESPONSE_OPTIONAL_FIELDS =
  'total_amount,item_list,fulfillment_flag';
