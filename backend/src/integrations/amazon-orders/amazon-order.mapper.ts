import type {
  MappedOrderItemRecord,
  MappedOrderRecord,
} from '../marketplace-orders/mapped-order-record';
import { PAID_ORDER_STATUS } from '../marketplace-orders/order-status';
import {
  centsToDecimalAmount,
  decimalAmountToCents,
} from './amazon-money.util';
import { mapAmazonOrderStatusToCanonical } from './amazon-order-status';
import type {
  RawAmazonOrder,
  RawAmazonOrderItem,
} from './amazon-order-response';

/**
 * Vocabulário fechado de motivo de quarentena (Checkpoint 4-B-R1,
 * "Mapeamento financeiro") — a mensagem da exceção É o código, nunca inclui
 * payload bruto do pedido.
 */
export type AmazonOrderQuarantineReason =
  | 'MARKETPLACE_NOT_ALLOWED'
  | 'MISSING_GRAND_TOTAL'
  | 'MISSING_CURRENCY'
  | 'MISSING_ITEM_PROCEEDS'
  | 'ITEM_SUBTOTAL_NOT_DIVISIBLE'
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
 *   - o pedido está PAGO mas algum item não tem `proceeds[type=ITEM].subtotal`
 *     válido (Checkpoint 4-B-R1 — `product.price.unitPrice` NUNCA substitui
 *     silenciosamente o dado financeiro de PROCEEDS);
 *   - o pedido está PAGO e o subtotal do item não é divisível de forma exata
 *     (em centavos) pela quantidade — nunca arredonda silenciosamente;
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
    const currency = (item.itemSubtotal ?? item.unitPrice)?.currencyCode;
    if (currency !== undefined) return currency;
  }
  return null;
}

/**
 * Identidade do ANÚNCIO Amazon (Checkpoint 4-B-R1, "Correção 5") —
 * `orderItemId` identifica só uma LINHA de um pedido, nunca o anúncio: duas
 * vendas do mesmo ASIN/SKU em pedidos diferentes têm `orderItemId`s
 * distintos, mas precisam consolidar no mesmo `topListings`. Prioridade:
 * ASIN (`externalItemId`) + SKU como parte determinística da variação
 * (`variationId`); sem ASIN, um fallback determinístico baseado só no SKU;
 * `orderItemId` é usado apenas como último recurso, quando nem ASIN nem SKU
 * estão presentes.
 */
function resolveListingIdentity(item: RawAmazonOrderItem): {
  externalItemId: string;
  variationId: string | null;
} {
  if (item.asin !== null) {
    return { externalItemId: item.asin, variationId: item.sellerSku };
  }
  if (item.sellerSku !== null) {
    return { externalItemId: `SKU:${item.sellerSku}`, variationId: null };
  }
  return { externalItemId: item.orderItemId, variationId: null };
}

function mapAmazonOrderItem(
  orderId: string,
  item: RawAmazonOrderItem,
  isPaid: boolean,
  orderCurrency: string,
): MappedOrderItemRecord {
  return isPaid
    ? mapPaidOrderItem(orderId, item, orderCurrency)
    : mapNonPaidOrderItem(orderId, item, orderCurrency);
}

/**
 * Pedido PAGO: a única fonte de faturamento realizado permitida é o
 * `subtotal` do breakdown `proceeds[type=ITEM]` (Checkpoint 4-B-R1,
 * "Correção 4") — `product.price.unitPrice` nunca substitui isso, mesmo
 * quando presente e divergente (só serve para diagnóstico fora deste
 * mapper). O subtotal é o valor da LINHA INTEIRA; o preço unitário
 * persistido só existe quando a divisão por `quantityOrdered` é EXATA em
 * centavos — nunca arredonda.
 */
function mapPaidOrderItem(
  orderId: string,
  item: RawAmazonOrderItem,
  orderCurrency: string,
): MappedOrderItemRecord {
  if (item.itemSubtotal === null) {
    throw new AmazonOrderQuarantinedError(orderId, 'MISSING_ITEM_PROCEEDS');
  }
  if (item.itemSubtotal.currencyCode !== orderCurrency) {
    throw new AmazonOrderQuarantinedError(orderId, 'CURRENCY_MISMATCH');
  }

  const subtotalCents = decimalAmountToCents(item.itemSubtotal.amount);
  const quantity = BigInt(item.quantityOrdered);
  if (subtotalCents % quantity !== 0n) {
    throw new AmazonOrderQuarantinedError(
      orderId,
      'ITEM_SUBTOTAL_NOT_DIVISIBLE',
    );
  }
  const unitCents = subtotalCents / quantity;

  return {
    ...resolveListingIdentity(item),
    sellerSku: item.sellerSku,
    title: item.title,
    quantity: item.quantityOrdered,
    unitPrice: centsToDecimalAmount(unitCents),
    currencyId: item.itemSubtotal.currencyCode,
  };
}

/**
 * Pedido NÃO pago (`pending`/`cancelled`/`unfulfillable`): nunca afeta
 * nenhum KPI de faturamento (todos filtram `status = 'paid'`), então tolera
 * ausência de preço com um "0.00" de preenchimento. Usa
 * `product.price.unitPrice` (já é, por definição, um valor POR UNIDADE) —
 * nunca o `itemSubtotal` (valor da linha inteira) diretamente num campo de
 * preço unitário, mesmo aqui.
 */
function mapNonPaidOrderItem(
  orderId: string,
  item: RawAmazonOrderItem,
  orderCurrency: string,
): MappedOrderItemRecord {
  const listing = resolveListingIdentity(item);
  const base = {
    ...listing,
    sellerSku: item.sellerSku,
    title: item.title,
    quantity: item.quantityOrdered,
  };

  if (item.unitPrice === null) {
    return { ...base, unitPrice: '0.00', currencyId: orderCurrency };
  }
  if (item.unitPrice.currencyCode !== orderCurrency) {
    throw new AmazonOrderQuarantinedError(orderId, 'CURRENCY_MISMATCH');
  }
  return {
    ...base,
    unitPrice: item.unitPrice.amount,
    currencyId: item.unitPrice.currencyCode,
  };
}
