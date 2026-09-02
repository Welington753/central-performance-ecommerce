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
 * Único status que representa uma venda paga para fins de KPI nesta
 * primeira versão (design da Fase 3, §"Definições dos KPIs").
 */
export const PAID_ORDER_STATUS: MercadoLivreOrderStatus = 'paid';

/**
 * Status usado para a contagem de cancelamentos (Checkpoint 2, "Pedidos
 * cancelados"/"Taxa de cancelamento") — nunca entra em faturamento/unidades.
 */
export const CANCELLED_ORDER_STATUS: MercadoLivreOrderStatus = 'cancelled';

export function isKnownOrderStatus(
  value: unknown,
): value is MercadoLivreOrderStatus {
  return (
    typeof value === 'string' &&
    (MERCADO_LIVRE_ORDER_STATUSES as readonly string[]).includes(value)
  );
}
