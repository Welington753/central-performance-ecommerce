/**
 * Vocabulário CANÔNICO de classificação logística (Fase 4, "Mercado Livre
 * Full") — genérico entre marketplaces, mas hoje só populado pelo conector
 * do Mercado Livre. Nunca reaproveita `fulfillmentChannel`
 * (`AMAZON`/`MERCHANT`, exclusivo da Amazon — ver `marketplace-order.entity.ts`).
 */
export const LOGISTICS_MARKETPLACE_FULFILLED = 'MARKETPLACE_FULFILLED';
export const LOGISTICS_SELLER_FULFILLED = 'SELLER_FULFILLED';
export const LOGISTICS_UNKNOWN = 'UNKNOWN';

export type LogisticsClassification =
  | typeof LOGISTICS_MARKETPLACE_FULFILLED
  | typeof LOGISTICS_SELLER_FULFILLED
  | typeof LOGISTICS_UNKNOWN;
