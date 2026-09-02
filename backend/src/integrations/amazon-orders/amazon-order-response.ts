import {
  isKnownAmazonOrderStatus,
  type AmazonOrderStatus,
} from './amazon-order-status';
import { validateAmazonMoney, type ValidatedMoney } from './amazon-money.util';

/**
 * Item de pedido já validado — allowlist fechada (Checkpoint 4-B), nunca um
 * spread do objeto bruto. `unitPrice`/`itemProceeds` continuam como `Money`
 * validado (ou `null`); a resolução de qual usar (e a quarentena de pedido
 * pago sem preço válido) é responsabilidade de `amazon-order.mapper.ts`,
 * não deste parser.
 */
export interface RawAmazonOrderItem {
  orderItemId: string;
  quantityOrdered: number;
  asin: string | null;
  sellerSku: string | null;
  title: string;
  unitPrice: ValidatedMoney | null;
  itemProceeds: ValidatedMoney | null;
}

export interface RawAmazonOrder {
  orderId: string;
  createdTime: string;
  lastUpdatedTime: string;
  marketplaceId: string;
  fulfillmentStatus: AmazonOrderStatus;
  fulfilledBy: 'AMAZON' | 'MERCHANT' | null;
  grandTotal: ValidatedMoney | null;
  items: RawAmazonOrderItem[];
}

export interface OrdersSearchPagination {
  nextToken: string | null;
}

export type OrdersSearchValidation =
  | {
      valid: true;
      orders: RawAmazonOrder[];
      pagination: OrdersSearchPagination;
    }
  | { valid: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validateFulfilledBy(value: unknown): 'AMAZON' | 'MERCHANT' | null {
  return value === 'AMAZON' || value === 'MERCHANT' ? value : null;
}

/**
 * Item pronto — `null` quando um campo de IDENTIDADE (id/quantidade/título)
 * é inválido, o que reprova o PEDIDO inteiro (não dá para persistir um item
 * sem identidade estável). Preço ausente/inválido NÃO reprova aqui —
 * decidido depois pelo mapper, conforme o status canônico do pedido.
 */
function validateOrderItem(raw: unknown): RawAmazonOrderItem | null {
  if (!isRecord(raw)) return null;

  const orderItemId = raw.orderItemId;
  const quantityOrdered = raw.quantityOrdered;
  const product = isRecord(raw.product) ? raw.product : null;

  if (!isNonEmptyString(orderItemId)) return null;
  if (
    typeof quantityOrdered !== 'number' ||
    !Number.isSafeInteger(quantityOrdered) ||
    quantityOrdered <= 0
  ) {
    return null;
  }
  if (product === null || !isNonEmptyString(product.title)) return null;

  const asin =
    typeof product.asin === 'string' && product.asin.length > 0
      ? product.asin
      : null;
  const sellerSku =
    typeof product.sellerSku === 'string' && product.sellerSku.length > 0
      ? product.sellerSku
      : null;

  const price = isRecord(product.price) ? product.price : null;
  const unitPrice = price ? validateAmazonMoney(price.unitPrice) : null;

  const itemProceeds = extractItemProceeds(raw.proceeds);

  return {
    orderItemId,
    quantityOrdered,
    asin,
    sellerSku,
    title: product.title,
    unitPrice,
    itemProceeds,
  };
}

/**
 * `orderItems[].proceeds`: array de entradas `{ type, amount }` — só a
 * entrada `type === 'ITEM'` é o fallback financeiro permitido (Checkpoint
 * 4-B, "se necessário, usar somente breakdown de proceeds com type=ITEM").
 * Nunca soma múltiplas entradas (evita contar frete/taxa como faturamento
 * do item).
 */
function extractItemProceeds(raw: unknown): ValidatedMoney | null {
  if (!Array.isArray(raw)) return null;
  const entries = raw as unknown[];
  const itemEntry = entries.find(
    (entry) => isRecord(entry) && entry.type === 'ITEM',
  );
  if (!isRecord(itemEntry)) return null;
  return validateAmazonMoney(itemEntry.amount);
}

function validateOrder(raw: unknown): RawAmazonOrder | null {
  if (!isRecord(raw)) return null;

  const orderId = raw.orderId;
  const createdTime = raw.createdTime;
  const lastUpdatedTime = raw.lastUpdatedTime;
  const salesChannel = isRecord(raw.salesChannel) ? raw.salesChannel : null;
  const fulfillment = isRecord(raw.fulfillment) ? raw.fulfillment : null;

  if (!isNonEmptyString(orderId)) return null;
  if (!isValidIsoDateString(createdTime)) return null;
  if (!isValidIsoDateString(lastUpdatedTime)) return null;
  if (salesChannel === null || !isNonEmptyString(salesChannel.marketplaceId)) {
    return null;
  }
  if (
    fulfillment === null ||
    !isKnownAmazonOrderStatus(fulfillment.fulfillmentStatus)
  ) {
    return null;
  }

  const proceeds = isRecord(raw.proceeds) ? raw.proceeds : null;
  const grandTotal = proceeds ? validateAmazonMoney(proceeds.grandTotal) : null;

  const rawItems = Array.isArray(raw.orderItems) ? raw.orderItems : null;
  if (rawItems === null) return null;

  const items: RawAmazonOrderItem[] = [];
  for (const rawItem of rawItems) {
    const item = validateOrderItem(rawItem);
    if (item === null) return null;
    items.push(item);
  }

  return {
    orderId,
    createdTime,
    lastUpdatedTime,
    marketplaceId: salesChannel.marketplaceId,
    fulfillmentStatus: fulfillment.fulfillmentStatus,
    fulfilledBy: validateFulfilledBy(fulfillment.fulfilledBy),
    grandTotal,
    items,
  };
}

/**
 * Validação fechada da resposta de `GET /orders/2026-01-01/orders`
 * (Checkpoint 4-B) — allowlist estrita, nunca copia campo desconhecido da
 * resposta bruta para o resultado. Um único pedido estruturalmente inválido
 * reprova a página inteira (`valid: false`) — nunca persiste parcialmente
 * uma página corrompida; a invalidez FINANCEIRA de um pedido específico
 * (preço/total ausente) é decidida depois, no mapper.
 */
export function validateOrdersSearchResponseBody(
  body: unknown,
): OrdersSearchValidation {
  if (!isRecord(body)) return { valid: false };
  if (!Array.isArray(body.orders)) return { valid: false };

  const orders: RawAmazonOrder[] = [];
  for (const rawOrder of body.orders) {
    const order = validateOrder(rawOrder);
    if (order === null) return { valid: false };
    orders.push(order);
  }

  const pagination = isRecord(body.pagination) ? body.pagination : {};
  const nextToken =
    typeof pagination.nextToken === 'string' && pagination.nextToken.length > 0
      ? pagination.nextToken
      : null;

  return { valid: true, orders, pagination: { nextToken } };
}
