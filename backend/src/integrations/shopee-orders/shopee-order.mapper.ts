import type {
  MappedOrderItemRecord,
  MappedOrderRecord,
} from '../marketplace-orders/mapped-order-record';
import { LOGISTICS_UNKNOWN } from '../marketplace-orders/logistics-classification';
import {
  CANCELLED_ORDER_STATUS,
  PAID_ORDER_STATUS,
  PENDING_ORDER_STATUS,
  type CanonicalOrderStatus,
} from '../marketplace-orders/order-status';
import type {
  ShopeeOrderDetailItem,
  ShopeeOrderDetailOrder,
  ShopeeOrderStatus,
} from './shopee-order-detail-response';

export type { MappedOrderItemRecord, MappedOrderRecord };

/**
 * Motivo fechado de erro de mapeamento (Checkpoint CP2K-3A/R1) — a mensagem
 * da exceção É o código, nunca inclui `order_sn`/payload/qualquer dado do
 * pedido (mesmo padrão de `AmazonOrderQuarantinedError`).
 */
export type ShopeeOrderMappingErrorReason =
  'MISSING_TOTAL_AMOUNT' | 'INVALID_TIMESTAMP' | 'UNKNOWN_ORDER_STATUS';

/**
 * Pedido rejeitado pelo mapper — nunca persistido, nunca um valor
 * inventado/zerado no lugar do dado ausente.
 */
export class ShopeeOrderMappingError extends Error {
  constructor(public readonly reason: ShopeeOrderMappingErrorReason) {
    super(reason);
  }
}

/**
 * Mapeamento canônico fechado de `order_status` (Checkpoint CP2K-3A-R1) —
 * decisão interna de produto, não uma equivalência documentada pela Shopee.
 * Confirmado contra o vocabulário real de `order-status.ts` e o mapper
 * Amazon (`amazon-order-status.ts`): mesmos três valores
 * `paid`/`cancelled`/`pending` usados pelos filtros de KPI
 * (`marketplace-analytics.service.ts`).
 *
 * - `UNPAID`/`INVOICE_PENDING`/`IN_CANCEL` → `pending`: nenhum dos três é
 *   financeiramente concluído — `IN_CANCEL` ainda pode reverter, os outros
 *   dois nunca chegaram a ser pagos.
 * - `READY_TO_SHIP`/`PROCESSED`/`SHIPPED`/`TO_CONFIRM_RECEIVE`/`COMPLETED` →
 *   `paid`: pagamento já confirmado (só entram nesses estados após isso),
 *   independente do estágio logístico. `TO_CONFIRM_RECEIVE` é o estado
 *   posterior ao envio em que o comprador ainda não confirmou o recebimento —
 *   financeiramente equivalente a `SHIPPED`, nunca a `pending`.
 * - `CANCELLED` → `cancelled`: cancelamento CONFIRMADO pelo provedor (nunca
 *   `IN_CANCEL`, que ainda está em andamento).
 *
 * `Record` (não `switch`) garante, em tempo de compilação, que todo valor de
 * `ShopeeOrderStatus` tem uma entrada — um valor fora do vocabulário fechado
 * (só possível via type assertion externa, nunca a partir do parser) falha
 * fechado com `UNKNOWN_ORDER_STATUS`, nunca um fallback silencioso.
 */
const SHOPEE_STATUS_TO_CANONICAL: Record<
  ShopeeOrderStatus,
  CanonicalOrderStatus
> = {
  UNPAID: PENDING_ORDER_STATUS,
  INVOICE_PENDING: PENDING_ORDER_STATUS,
  IN_CANCEL: PENDING_ORDER_STATUS,
  READY_TO_SHIP: PAID_ORDER_STATUS,
  PROCESSED: PAID_ORDER_STATUS,
  SHIPPED: PAID_ORDER_STATUS,
  TO_CONFIRM_RECEIVE: PAID_ORDER_STATUS,
  COMPLETED: PAID_ORDER_STATUS,
  CANCELLED: CANCELLED_ORDER_STATUS,
};

function mapShopeeOrderStatusToCanonical(
  status: ShopeeOrderStatus,
): CanonicalOrderStatus {
  const canonical = SHOPEE_STATUS_TO_CANONICAL[status];
  if (canonical === undefined) {
    throw new ShopeeOrderMappingError('UNKNOWN_ORDER_STATUS');
  }
  return canonical;
}

/**
 * `epochSeconds` já foi validado pelo parser como inteiro seguro
 * (`Number.isSafeInteger`), mas isso NÃO garante um `Date` válido — o
 * intervalo aceito por `Date` (±100.000.000 dias, ~±8,64e15 ms a partir da
 * época) é bem menor que `Number.MAX_SAFE_INTEGER` segundos. Um valor fora
 * desse intervalo produziria silenciosamente um `Invalid Date` sem isto —
 * falha fechado com `ShopeeOrderMappingError`, nunca persiste uma data
 * inválida (mesmo padrão de `InvalidOrderDateError`, Mercado Livre).
 */
function toValidDate(epochSeconds: number): Date {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    throw new ShopeeOrderMappingError('INVALID_TIMESTAMP');
  }
  return date;
}

/**
 * Conversão para a string decimal de `numeric(14,2)` exigida pelas colunas
 * `total_amount`/`unit_price` (`1788000000000-mercado-livre-orders.ts`) —
 * MESMA técnica de `moneyToDecimalString` (Mercado Livre):
 * `Number.prototype.toFixed(2)`. Isto ARREDONDA (não é "sem aritmética")
 * quando o valor de origem tem mais de 2 casas decimais — comportamento já
 * comprovado nos mappers existentes, não uma regra nova criada só para
 * Shopee. O valor de entrada já foi validado como finito e não negativo pelo
 * parser (`shopee-order-detail-response.ts`); esta função nunca soma nem
 * deriva um valor a partir de outro, só formata o que já veio pronto do
 * provedor.
 */
function toDecimalAmount(value: number): string {
  return value.toFixed(2);
}

/**
 * Mapeia o resultado sanitizado de `getOrderDetail` (Checkpoint CP2K-2) para
 * o registro genérico de persistência (Checkpoint CP2K-3A/R1). Entrada é
 * SOMENTE o tipo já validado pelo parser — nunca payload bruto, nunca
 * spread do objeto recebido.
 *
 * Política de status: `status` recebe o valor CANÔNICO (`paid`/`cancelled`/
 * `pending`, ver `SHOPEE_STATUS_TO_CANONICAL` acima — decisão interna de
 * produto, já que a documentação da Shopee não define equivalência alguma).
 * `sourceStatus` sempre preserva o valor bruto exato de `orderStatus`,
 * nunca traduzido.
 *
 * `totalAmount` só é retornado pela Shopee após o pagamento confirmado
 * (documentação oficial) — ausente, lança `ShopeeOrderMappingError`, nunca
 * `0`/soma dos itens/valor inventado.
 */
export function mapShopeeOrder(
  marketplaceAccountId: string,
  raw: ShopeeOrderDetailOrder,
): MappedOrderRecord {
  if (raw.totalAmount === null) {
    throw new ShopeeOrderMappingError('MISSING_TOTAL_AMOUNT');
  }

  return {
    marketplaceAccountId,
    externalOrderId: raw.orderSn,
    status: mapShopeeOrderStatusToCanonical(raw.orderStatus),
    currencyId: raw.currency,
    totalAmount: toDecimalAmount(raw.totalAmount),
    packId: null,
    dateCreated: toValidDate(raw.createTime),
    // Ausência de `updateTime` usa `createTime` como fallback temporal
    // seguro (nunca `null`/`now()` inventado) — pedido nunca atualizado
    // desde a criação é, por definição, tão recente quanto ela.
    marketplaceLastUpdated: toValidDate(raw.updateTime ?? raw.createTime),
    dateClosed: null,
    sourceStatus: raw.orderStatus,
    fulfillmentChannel: raw.fulfillmentFlag,
    externalMarketplaceId: null,
    logisticsClassification: LOGISTICS_UNKNOWN,
    logisticsType: null,
    items: raw.items.map((item) => mapShopeeOrderItem(item, raw.currency)),
  };
}

function mapShopeeOrderItem(
  item: ShopeeOrderDetailItem,
  orderCurrencyId: string,
): MappedOrderItemRecord {
  return {
    externalItemId: item.itemId,
    // `modelId === '0'` é o sentinela documentado de "sem variação" — nunca
    // uma variação real.
    variationId: item.modelId === '0' ? null : item.modelId,
    sellerSku: resolveSellerSku(item),
    title: item.itemName,
    quantity: item.quantity,
    // `discountedPrice`: preço efetivamente cobrado pelo comprador.
    // `originalPrice` nunca é persistido neste schema.
    unitPrice: toDecimalAmount(item.discountedPrice),
    currencyId: orderCurrencyId,
  };
}

/** `modelSku` tem prioridade; ausente/vazio cai para `itemSku`; ambos ausentes → `null`. */
function resolveSellerSku(item: ShopeeOrderDetailItem): string | null {
  if (item.modelSku !== null && item.modelSku.length > 0) {
    return item.modelSku;
  }
  if (item.itemSku !== null && item.itemSku.length > 0) {
    return item.itemSku;
  }
  return null;
}
