/**
 * Vocabulário CANÔNICO de status de pedido, comum a todos os marketplaces
 * (`marketplace_orders.status`) — usado por toda agregação de KPI genérica
 * (`marketplace-analytics`) e pela KPI legada do Mercado Livre.
 *
 * O Mercado Livre grava seu próprio status bruto (`paid`, `cancelled`,
 * `confirmed`, `payment_required` etc. — ver `mercado-livre-orders/
 * mercado-livre-order-status.ts`) diretamente nesta coluna: por coincidência
 * de nomenclatura, dois desses valores brutos já SÃO os canônicos `paid`/
 * `cancelled` abaixo, e todos os demais (`confirmed`, `payment_required`...)
 * simplesmente não entram em nenhum dos dois filtros — o que já era o
 * comportamento correto antes desta extração (nunca contam como pago nem
 * como cancelado). Outros marketplaces (Amazon — ver `amazon-orders/
 * amazon-order-status.mapper.ts`) mapeiam seu próprio status bruto
 * EXPLICITAMENTE para um destes quatro valores antes de persistir.
 */
export const PAID_ORDER_STATUS = 'paid';
export const CANCELLED_ORDER_STATUS = 'cancelled';
export const PENDING_ORDER_STATUS = 'pending';
export const UNFULFILLABLE_ORDER_STATUS = 'unfulfillable';
/**
 * Status bruto real do Mercado Livre (auditoria "contrato de dados",
 * Checkpoint BI) — pedido pago com estorno PARCIAL confirmado pelo
 * provedor. Nunca contado como `paid` (o valor bruto não reflete mais o
 * que foi efetivamente recebido) nem como `cancelled` (a venda não foi
 * desfeita por completo). Reconhecido explicitamente no vocabulário
 * canônico para que passe a ser visível como lacuna de cobertura
 * (`refundCoverage`) em vez de desaparecer silenciosamente de toda
 * agregação, como acontecia antes desta correção.
 */
export const PARTIALLY_REFUNDED_ORDER_STATUS = 'partially_refunded';

export type CanonicalOrderStatus =
  | typeof PAID_ORDER_STATUS
  | typeof CANCELLED_ORDER_STATUS
  | typeof PENDING_ORDER_STATUS
  | typeof UNFULFILLABLE_ORDER_STATUS
  | typeof PARTIALLY_REFUNDED_ORDER_STATUS;
