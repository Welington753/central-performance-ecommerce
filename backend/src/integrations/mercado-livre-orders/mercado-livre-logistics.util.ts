import {
  LOGISTICS_MARKETPLACE_FULFILLED,
  LOGISTICS_SELLER_FULFILLED,
  LOGISTICS_UNKNOWN,
  type LogisticsClassification,
} from '../marketplace-orders/logistics-classification';

/**
 * Único ponto de mapeamento `logistic_type` (Mercado Envios) → classificação
 * CANÔNICA. `fulfillment` é o único valor que corresponde a "Full" — o
 * Mercado Livre armazena/despacha. `self_service` é o Mercado Envios Flex
 * (o próprio vendedor entrega) e NUNCA deve ser tratado como Full, apesar de
 * também ser uma modalidade "gerenciada" pela plataforma. Qualquer valor não
 * reconhecido cai em `UNKNOWN` — nunca inferido como `SELLER_FULFILLED`.
 */
export function classifyLogisticType(
  logisticType: string | null,
): LogisticsClassification {
  if (logisticType === 'fulfillment') return LOGISTICS_MARKETPLACE_FULFILLED;
  if (
    logisticType === 'drop_off' ||
    logisticType === 'cross_docking' ||
    logisticType === 'self_service' ||
    logisticType === 'xd_drop_off'
  ) {
    return LOGISTICS_SELLER_FULFILLED;
  }
  return LOGISTICS_UNKNOWN;
}
