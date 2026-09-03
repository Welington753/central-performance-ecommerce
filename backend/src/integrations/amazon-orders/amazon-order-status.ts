import {
  CANCELLED_ORDER_STATUS,
  PAID_ORDER_STATUS,
  PENDING_ORDER_STATUS,
  UNFULFILLABLE_ORDER_STATUS,
  type CanonicalOrderStatus,
} from '../marketplace-orders/order-status';

/**
 * Vocabulário fechado de `fulfillment.fulfillmentStatus` da Amazon Orders
 * API `v2026-01-01` (Checkpoint 4-B, "Mapeamento de status").
 */
export const AMAZON_ORDER_STATUSES = [
  'UNSHIPPED',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'CANCELLED',
  'PENDING',
  'PENDING_AVAILABILITY',
  'UNFULFILLABLE',
  // Guia oficial de migração `orders_2026-01-01` (Checkpoint 4-B-R1,
  // "Correção 8") — nota fiscal ainda não confirmada; nunca é venda paga
  // nem cancelamento, então normaliza para `pending` como os outros dois
  // estados de espera.
  'INVOICE_UNCONFIRMED',
] as const;

export type AmazonOrderStatus = (typeof AMAZON_ORDER_STATUSES)[number];

export function isKnownAmazonOrderStatus(
  value: unknown,
): value is AmazonOrderStatus {
  return (
    typeof value === 'string' &&
    (AMAZON_ORDER_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Mapeamento canônico exigido pelo Checkpoint 4-B: só `paid` entra em
 * faturamento/pedidos pagos, só `cancelled` entra no KPI de cancelamento.
 * `PENDING`/`PENDING_AVAILABILITY` NUNCA viram venda paga;
 * `UNFULFILLABLE` NUNCA vira cancelamento automaticamente — cada um recebe
 * seu próprio status canônico distinto.
 */
export function mapAmazonOrderStatusToCanonical(
  status: AmazonOrderStatus,
): CanonicalOrderStatus {
  switch (status) {
    case 'UNSHIPPED':
    case 'PARTIALLY_SHIPPED':
    case 'SHIPPED':
      return PAID_ORDER_STATUS;
    case 'CANCELLED':
      return CANCELLED_ORDER_STATUS;
    case 'PENDING':
    case 'PENDING_AVAILABILITY':
    case 'INVOICE_UNCONFIRMED':
      return PENDING_ORDER_STATUS;
    case 'UNFULFILLABLE':
      return UNFULFILLABLE_ORDER_STATUS;
  }
}
