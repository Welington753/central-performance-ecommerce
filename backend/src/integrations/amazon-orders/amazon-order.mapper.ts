import type {
  MappedOrderItemRecord,
  MappedOrderRecord,
} from '../marketplace-orders/mapped-order-record';
import { PAID_ORDER_STATUS } from '../marketplace-orders/order-status';
import type { ValidatedMoney } from './amazon-money.util';
import { mapAmazonOrderStatusToCanonical } from './amazon-order-status';
import type {
  RawAmazonOrder,
  RawAmazonOrderItem,
} from './amazon-order-response';

/**
 * Vocabulário fechado de motivo de quarentena (Checkpoint 4-B, "Mapeamento
 * financeiro") — a mensagem da exceção É o código, nunca inclui payload
 * bruto do pedido.
 */
export type AmazonOrderQuarantineReason =
  | 'MARKETPLACE_NOT_ALLOWED'
  | 'MISSING_GRAND_TOTAL'
  | 'MISSING_CURRENCY'
  | 'MISSING_ITEM_PRICE'
  | 'CURRENCY_MISMATCH';

/**
 * Pedido rejeitado/quarentenado — nunca persistido. `orderId` é preservado
 * só para o chamador poder contar/logar de forma sanitizada (nunca o
 * payload bruto do pedido).
 */
export class AmazonOrderQuarantinedError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly reason: AmazonOrderQuarantineReason,
  ) {
    super(reason);
  }
}

/**
 * Mapeia um pedido Amazon já validado estruturalmente
 * (`amazon-order-response.ts`) para o registro genérico de persistência.
 * Lança `AmazonOrderQuarantinedError` (nunca retorna um valor parcial ou
 * inventado) quando:
 *   - o `marketplaceId` do pedido não está na allowlist configurada da
 *     conta;
 *   - o pedido está PAGO mas não tem `grandTotal` válido — nunca vira zero;
 *   - o pedido está PAGO mas algum item não tem preço resolvível (nem
 *     `product.price.unitPrice`, nem breakdown `proceeds[type=ITEM]`);
 *   - a moeda de algum item diverge da moeda do pedido;
 *   - não há NENHUMA moeda determinável para o pedido (nem grandTotal, nem
 *     qualquer item com preço).
 * Pedidos não pagos (`pending`/`cancelled`/`unfulfillable`) toleram
 * ausência de preço — nunca afeta nenhum KPI atual (todos filtram por
 * `status = 'paid'`), então um valor "0.00" de preenchimento é seguro ali.
 */
export function mapAmazonOrder(
  marketplaceAccountId: string,
  raw: RawAmazonOrder,
  allowedMarketplaceIds: readonly string[],
): MappedOrderRecord {
  if (!allowedMarketplaceIds.includes(raw.marketplaceId)) {
    throw new AmazonOrderQuarantinedError(
      raw.orderId,
      'MARKETPLACE_NOT_ALLOWED',
    );
  }

  const canonicalStatus = mapAmazonOrderStatusToCanonical(
    raw.fulfillmentStatus,
  );
  const isPaid = canonicalStatus === PAID_ORDER_STATUS;

  if (raw.grandTotal === null && isPaid) {
    throw new AmazonOrderQuarantinedError(raw.orderId, 'MISSING_GRAND_TOTAL');
  }

  const orderCurrency = resolveOrderCurrency(raw);
  if (orderCurrency === null) {
    throw new AmazonOrderQuarantinedError(raw.orderId, 'MISSING_CURRENCY');
  }

  const items = raw.items.map((item) =>
    mapAmazonOrderItem(raw.orderId, item, isPaid, orderCurrency),
  );

  return {
    marketplaceAccountId,
    externalOrderId: raw.orderId,
    status: canonicalStatus,
    currencyId: orderCurrency,
    totalAmount: raw.grandTotal?.amount ?? '0.00',
    packId: null,
    dateCreated: new Date(raw.createdTime),
    dateClosed: null,
    marketplaceLastUpdated: new Date(raw.lastUpdatedTime),
    sourceStatus: raw.fulfillmentStatus,
    fulfillmentChannel: raw.fulfilledBy,
    externalMarketplaceId: raw.marketplaceId,
    items,
  };
}

function resolveOrderCurrency(raw: RawAmazonOrder): string | null {
  if (raw.grandTotal !== null) return raw.grandTotal.currencyCode;
  for (const item of raw.items) {
    const price = resolveItemPrice(item);
    if (price !== null) return price.currencyCode;
  }
  return null;
}

/**
 * `product.price.unitPrice` é priorizado; o breakdown `proceeds[type=ITEM]`
 * só é usado como fallback quando o preço direto não é válido (Checkpoint
 * 4-B, "priorizar... se necessário, usar somente breakdown").
 */
function resolveItemPrice(item: RawAmazonOrderItem): ValidatedMoney | null {
  return item.unitPrice ?? item.itemProceeds ?? null;
}

function mapAmazonOrderItem(
  orderId: string,
  item: RawAmazonOrderItem,
  isPaid: boolean,
  orderCurrency: string,
): MappedOrderItemRecord {
  const resolved = resolveItemPrice(item);

  if (resolved === null) {
    if (isPaid) {
      throw new AmazonOrderQuarantinedError(orderId, 'MISSING_ITEM_PRICE');
    }
    return {
      externalItemId: item.orderItemId,
      variationId: null,
      sellerSku: item.sellerSku,
      title: item.title,
      quantity: item.quantityOrdered,
      unitPrice: '0.00',
      currencyId: orderCurrency,
    };
  }

  if (resolved.currencyCode !== orderCurrency) {
    throw new AmazonOrderQuarantinedError(orderId, 'CURRENCY_MISMATCH');
  }

  return {
    externalItemId: item.orderItemId,
    variationId: null,
    sellerSku: item.sellerSku,
    title: item.title,
    quantity: item.quantityOrdered,
    unitPrice: resolved.amount,
    currencyId: resolved.currencyCode,
  };
}
