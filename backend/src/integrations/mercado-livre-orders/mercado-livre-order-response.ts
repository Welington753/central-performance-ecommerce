import { isKnownOrderStatus } from './mercado-livre-order-status';

export interface RawMercadoLivreOrderItem {
  itemId: string;
  variationId: string | null;
  sellerSku: string | null;
  title: string;
  quantity: number;
  unitPrice: string;
  currencyId: string;
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
  };
}

function validateOrderEntry(value: unknown): RawMercadoLivreOrder | null {
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

  return {
    externalOrderId: String(externalOrderId),
    status,
    currencyId,
    totalAmount,
    packId: isNonEmptyString(packId) ? packId : null,
    dateCreated,
    dateClosed: isNonEmptyString(dateClosed) ? dateClosed : null,
    lastUpdated: isNonEmptyString(lastUpdated) ? lastUpdated : null,
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
