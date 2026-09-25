import { isKnownOrderStatus } from './mercado-livre-order-status';

export interface RawMercadoLivreOrderItem {
  itemId: string;
  variationId: string | null;
  sellerSku: string | null;
  title: string;
  quantity: number;
  unitPrice: string;
  currencyId: string;
  /**
   * `order_items[].sale_fee` (CP2K-7D, campo financeiro confirmado) —
   * comissão do Mercado Livre por item, como string monetária determinística
   * (mesma conversão de `unitPrice`). `null` quando ausente, `null` quando
   * presente mas de tipo inválido (política de campo opcional — nunca
   * rejeita o pedido inteiro por causa de um campo financeiro auxiliar).
   */
  saleFee: string | null;
}

/**
 * `order.payments[]` (CP2K-7D, campos financeiros confirmados via sondagem
 * real da API — ver CP2K-7C) — cada campo já convertido para string
 * monetária determinística na fronteira de validação (nunca aritmética de
 * ponto flutuante depois disso). `status` ausente/inválido vira `'unknown'`
 * — nunca `'approved'` por padrão, para nunca contaminar silenciosamente a
 * agregação do mapper (só payments `'approved'` são elegíveis).
 */
export interface RawMercadoLivrePayment {
  status: string;
  marketplaceFee: string | null;
  shippingCost: string | null;
  taxesAmount: string | null;
  couponAmount: string | null;
  transactionAmountRefunded: string | null;
}

/**
 * `order.buyer` (função "Clientes") — allowlist: só `id`, `nickname`,
 * `first_name`, `last_name`. Nenhum e-mail/telefone/documento/endereço é
 * lido, mesmo que presente no corpo. Campo auxiliar: ausente ou inválido
 * vira `null`, nunca rejeita o pedido.
 */
export interface RawMercadoLivreBuyer {
  id: string;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface RawMercadoLivreOrder {
  externalOrderId: string;
  status: string;
  currencyId: string;
  totalAmount: string;
  packId: string | null;
  dateCreated: string;
  dateClosed: string | null;
  lastUpdated: string | null;
  /**
   * `shipping.id` (Fase 4, "Full") — o pedido em si nunca traz o modo
   * logístico; só o identificador do envio, usado pelo serviço de
   * sincronização para consultar `GET /shipments/{id}` (campo
   * `logistic_type`, único jeito oficial de distinguir Full). `null` quando
   * o pedido não tem envio associado (ex.: retirada em loja/pagamento
   * combinado) — nunca inventado.
   */
  shippingId: string | null;
  /**
   * `payments[]` (CP2K-7D) — nunca faz a página/pedido ser rejeitado por
   * causa de um payment malformado: entradas que não são objeto são
   * silenciosamente ignoradas (mesma política de campo auxiliar/opcional das
   * demais extensões financeiras); ausente vira array vazio.
   */
  payments: RawMercadoLivrePayment[];
  buyer: RawMercadoLivreBuyer | null;
  items: RawMercadoLivreOrderItem[];
}

export interface OrdersSearchPaging {
  total: number;
  offset: number;
  limit: number;
}

export type OrdersSearchResponseValidation =
  | { valid: true; paging: OrdersSearchPaging; orders: RawMercadoLivreOrder[] }
  | { valid: false };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Um valor monetário do Mercado Livre chega como `number` no JSON (ex.:
 * `199.9`). Convertido para string de forma determinística aqui, na
 * fronteira de validação — nunca aritmética de ponto flutuante depois disso
 * (`money.util.ts` só opera sobre strings/`bigint`).
 */
function moneyToDecimalString(value: unknown): string | null {
  if (!isFiniteNumber(value)) return null;
  return value.toFixed(2);
}

function validatePaging(value: unknown): OrdersSearchPaging | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (
    !isFiniteNumber(raw.total) ||
    !isFiniteNumber(raw.offset) ||
    !isFiniteNumber(raw.limit)
  ) {
    return null;
  }
  return { total: raw.total, offset: raw.offset, limit: raw.limit };
}

function validateItemEntry(value: unknown): RawMercadoLivreOrderItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const item = raw.item;
  if (typeof item !== 'object' || item === null) return null;
  const rawItem = item as Record<string, unknown>;

  const itemId = rawItem.id;
  const title = rawItem.title;
  const quantity = raw.quantity;
  const unitPrice = moneyToDecimalString(raw.unit_price);
  const currencyId = raw.currency_id;

  if (
    !(typeof itemId === 'string' || typeof itemId === 'number') ||
    !isNonEmptyString(title) ||
    !isFiniteNumber(quantity) ||
    unitPrice === null ||
    !isNonEmptyString(currencyId)
  ) {
    return null;
  }

  const variationId = rawItem.variation_id;
  const sellerSku = rawItem.seller_sku;

  return {
    itemId: String(itemId),
    variationId:
      typeof variationId === 'string' || typeof variationId === 'number'
        ? String(variationId)
        : null,
    sellerSku: isNonEmptyString(sellerSku) ? sellerSku : null,
    title,
    quantity,
    unitPrice,
    currencyId,
    saleFee: moneyToDecimalString(raw.sale_fee),
  };
}

/**
 * Campo financeiro opcional/auxiliar de um payment: ausente, `null`
 * explícito, ou tipo inválido — todos viram `null` (mesma política dos
 * demais campos opcionais deste validador, ex.: `variation_id`/`seller_sku`
 * acima) — nunca rejeita o payment nem o pedido.
 */
function paymentMoneyField(value: unknown): string | null {
  return moneyToDecimalString(value);
}

/**
 * Um payment que não é objeto é descartado silenciosamente (nunca rejeita o
 * pedido — ver doc de `RawMercadoLivrePayment`). `status` ausente/inválido
 * vira `'unknown'`, nunca `'approved'` — só isso já garante que o mapper
 * nunca teria um payment sem status reconhecido contando como elegível.
 */
function validatePaymentEntry(value: unknown): RawMercadoLivrePayment | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  return {
    status: isNonEmptyString(raw.status) ? raw.status : 'unknown',
    marketplaceFee: paymentMoneyField(raw.marketplace_fee),
    shippingCost: paymentMoneyField(raw.shipping_cost),
    taxesAmount: paymentMoneyField(raw.taxes_amount),
    couponAmount: paymentMoneyField(raw.coupon_amount),
    transactionAmountRefunded: paymentMoneyField(
      raw.transaction_amount_refunded,
    ),
  };
}

const MAX_BUYER_TEXT_LENGTH = 255;

function optionalBuyerText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_BUYER_TEXT_LENGTH
    ? trimmed
    : null;
}

function validateBuyer(value: unknown): RawMercadoLivreBuyer | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id =
    typeof raw.id === 'number' && Number.isSafeInteger(raw.id) && raw.id > 0
      ? String(raw.id)
      : optionalBuyerText(raw.id);
  if (id === null) return null;
  return {
    id,
    nickname: optionalBuyerText(raw.nickname),
    firstName: optionalBuyerText(raw.first_name),
    lastName: optionalBuyerText(raw.last_name),
  };
}

/**
 * Exportada para reúso pelo fallback de recuperação de `shipping.id` via
 * `GET /orders/{id}` (correção da auditoria Full, revisão crítica —
 * `mercado-livre-order-detail.client.ts`): o corpo de um pedido individual
 * tem exatamente este formato, então a mesma validação já testada (nunca
 * uma segunda implementação divergente) decide se a resposta é aceita.
 */
export function validateOrderEntry(
  value: unknown,
): RawMercadoLivreOrder | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;

  const externalOrderId = raw.id;
  const status = raw.status;
  const currencyId = raw.currency_id;
  const totalAmount = moneyToDecimalString(raw.total_amount);
  const dateCreated = raw.date_created;
  const rawItems = raw.order_items;

  if (
    !(
      typeof externalOrderId === 'string' || typeof externalOrderId === 'number'
    ) ||
    !isKnownOrderStatus(status) ||
    !isNonEmptyString(currencyId) ||
    totalAmount === null ||
    !isNonEmptyString(dateCreated) ||
    !Array.isArray(rawItems)
  ) {
    return null;
  }

  const items: RawMercadoLivreOrderItem[] = [];
  for (const rawItem of rawItems) {
    const item = validateItemEntry(rawItem);
    if (!item) return null;
    items.push(item);
  }

  const dateClosed = raw.date_closed;
  const lastUpdated = raw.last_updated;
  const packId = raw.pack_id;
  const shipping = raw.shipping;
  const shippingId =
    typeof shipping === 'object' && shipping !== null
      ? (shipping as Record<string, unknown>).id
      : undefined;

  const rawPayments = raw.payments;
  const payments: RawMercadoLivrePayment[] = [];
  if (Array.isArray(rawPayments)) {
    for (const rawPayment of rawPayments) {
      const payment = validatePaymentEntry(rawPayment);
      if (payment) payments.push(payment);
    }
  }

  return {
    externalOrderId: String(externalOrderId),
    status,
    currencyId,
    totalAmount,
    packId: isNonEmptyString(packId) ? packId : null,
    dateCreated,
    dateClosed: isNonEmptyString(dateClosed) ? dateClosed : null,
    lastUpdated: isNonEmptyString(lastUpdated) ? lastUpdated : null,
    shippingId:
      typeof shippingId === 'string' || typeof shippingId === 'number'
        ? String(shippingId)
        : null,
    payments,
    buyer: validateBuyer(raw.buyer),
    items,
  };
}

/**
 * Valida em runtime o corpo de `GET /orders/search` (design da Fase 3).
 * Qualquer desvio estrutural — `paging` ausente/malformado, `results` que
 * não é array, ou UM pedido sequer fora do formato esperado — torna a
 * página inteira inválida (`valid: false`), nunca persiste parcialmente uma
 * página que pode estar corrompida.
 */
export function validateOrdersSearchResponseBody(
  body: unknown,
): OrdersSearchResponseValidation {
  if (typeof body !== 'object' || body === null) return { valid: false };
  const raw = body as Record<string, unknown>;

  const paging = validatePaging(raw.paging);
  if (!paging) return { valid: false };

  const results = raw.results;
  if (!Array.isArray(results)) return { valid: false };

  const orders: RawMercadoLivreOrder[] = [];
  for (const result of results) {
    const order = validateOrderEntry(result);
    if (!order) return { valid: false };
    orders.push(order);
  }

  return { valid: true, paging, orders };
}
