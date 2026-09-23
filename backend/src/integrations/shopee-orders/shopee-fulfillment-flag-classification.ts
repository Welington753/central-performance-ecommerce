import {
  LOGISTICS_MARKETPLACE_FULFILLED,
  LOGISTICS_SELLER_FULFILLED,
  LOGISTICS_UNKNOWN,
  type LogisticsClassification,
} from '../marketplace-orders/logistics-classification';

/**
 * Único ponto de mapeamento `fulfillment_flag` (Shopee) → classificação
 * CANÔNICA (auditoria de produção confirmou só dois valores em uso:
 * `fulfilled_by_shopee`/`fulfilled_by_local_seller`). Comparação
 * normalizada por `trim`/`lowercase` apenas — nunca `contains`/
 * `startsWith`/heurística de transportadora, warehouse, canal logístico ou
 * nome do pedido. Qualquer valor ausente ou fora do vocabulário fechado cai
 * em `UNKNOWN`, nunca inferido como `SELLER_FULFILLED` (mesma política de
 * `classifyLogisticType`, Mercado Livre).
 */
export function classifyShopeeFulfillmentFlag(
  fulfillmentFlag: string | null,
): LogisticsClassification {
  if (fulfillmentFlag === null) return LOGISTICS_UNKNOWN;
  const normalized = fulfillmentFlag.trim().toLowerCase();
  if (normalized === 'fulfilled_by_shopee') {
    return LOGISTICS_MARKETPLACE_FULFILLED;
  }
  if (normalized === 'fulfilled_by_local_seller') {
    return LOGISTICS_SELLER_FULFILLED;
  }
  return LOGISTICS_UNKNOWN;
}
