/**
 * Valores oficiais de `order.status` (Mercado Livre — Gerenciamento de
 * Vendas): confirmed, payment_required, payment_in_process, partially_paid,
 * paid, partially_refunded, pending_cancel, cancelled, invalid. Confirmado
 * via busca sobre a documentação oficial (developers.mercadolivre.com.br —
 * o fetch direto da página retornou 403/Cloudflare; o conteúdo foi obtido
 * através do índice de busca sobre o mesmo domínio oficial, nunca de blog ou
 * exemplo de terceiros).
 */
export const MERCADO_LIVRE_ORDER_STATUSES = [
  'confirmed',
  'payment_required',
  'payment_in_process',
  'partially_paid',
  'paid',
  'partially_refunded',
  'pending_cancel',
  'cancelled',
  'invalid',
] as const;

export type MercadoLivreOrderStatus =
  (typeof MERCADO_LIVRE_ORDER_STATUSES)[number];

/**
 * `PAID_ORDER_STATUS`/`CANCELLED_ORDER_STATUS` (usados por toda agregação
 * de KPI) foram extraídos para `marketplace-orders/order-status.ts`
 * (Checkpoint 4-B, "Commit 1") — genéricos, sem nenhuma dependência do
 * Mercado Livre. Por coincidência de nomenclatura, dois dos valores brutos
 * de `MERCADO_LIVRE_ORDER_STATUSES` acima (`paid`/`cancelled`) já SÃO os
 * canônicos; os demais nunca entram em nenhum filtro de KPI.
 */
export function isKnownOrderStatus(
  value: unknown,
): value is MercadoLivreOrderStatus {
  return (
    typeof value === 'string' &&
    (MERCADO_LIVRE_ORDER_STATUSES as readonly string[]).includes(value)
  );
}
