import {
  shopeeOrderDetailValidationIssue,
  withShopeeOrderIndex,
  type ShopeeOrderDetailValidationIssue,
  type ShopeeOrderDetailValidationIssueCode,
} from './shopee-order-detail-validation-issue';

/**
 * Vocabulário fechado de `order_status` (Checkpoint CP2K-2) - extraído da
 * documentação oficial (`v2.order.get_order_list`, único ponto onde a
 * Shopee enumera todos os valores). Um valor fora desta lista é sempre
 * `invalid_response`, nunca repassado cru.
 */
export type ShopeeOrderStatus =
  | 'UNPAID'
  | 'READY_TO_SHIP'
  | 'PROCESSED'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'IN_CANCEL'
  | 'CANCELLED'
  | 'INVOICE_PENDING';

const ORDER_STATUS_VALUES: ReadonlySet<string> = new Set<ShopeeOrderStatus>([
  'UNPAID',
  'READY_TO_SHIP',
  'PROCESSED',
  'SHIPPED',
  'COMPLETED',
  'IN_CANCEL',
  'CANCELLED',
  'INVOICE_PENDING',
]);

export interface ShopeeOrderDetailItem {
  itemId: string;
  itemName: string;
  itemSku: string | null;
  modelId: string;
  modelName: string | null;
  modelSku: string | null;
  quantity: number;
  originalPrice: number;
  discountedPrice: number;
}

export interface ShopeeOrderDetailOrder {
  orderSn: string;
  region: string;
  currency: string;
  orderStatus: ShopeeOrderStatus;
  /** `null` quando `total_amount` está ausente (documentado: só retorna após pagamento confirmado) - nunca um fallback calculado. */
  totalAmount: number | null;
  createTime: number;
  /** `null` quando `update_time` está ausente. */
  updateTime: number | null;
  /** `null` quando `fulfillment_flag` está ausente (campo opcional). */
  fulfillmentFlag: string | null;
  items: ShopeeOrderDetailItem[];
}

export interface ShopeeOrderDetailResult {
  orders: ShopeeOrderDetailOrder[];
  requestId: string;
}

export type ShopeeOrderDetailValidation =
  | { valid: true; result: ShopeeOrderDetailResult }
  | { valid: false; issue: ShopeeOrderDetailValidationIssue };

type OrderValidation =
  | { valid: true; order: ShopeeOrderDetailOrder }
  | { valid: false; issue: ShopeeOrderDetailValidationIssue };

type ItemValidation =
  | { valid: true; item: ShopeeOrderDetailItem }
  | { valid: false; issue: ShopeeOrderDetailValidationIssue };

/** Rejeição com diagnóstico fechado — `value` só deriva `actualType`, nunca é retido. */
function reject(
  code: ShopeeOrderDetailValidationIssueCode,
  value: unknown,
): { valid: false; issue: ShopeeOrderDetailValidationIssue } {
  return { valid: false, issue: shopeeOrderDetailValidationIssue(code, value) };
}

const MAX_ORDER_SN_LENGTH = 64;
const MAX_REGION_LENGTH = 8;
const CURRENCY_LENGTH = 3;
const MAX_ITEM_NAME_LENGTH = 512;
const MAX_SKU_LENGTH = 128;
const MAX_FULFILLMENT_FLAG_LENGTH = 64;
/**
 * Checkpoint CP2K-3B-R2: mesmo ajuste de `shopee-order-list-response.ts` -
 * formato real usa `:` como separador; string vazia, caracteres de controle
 * e tamanho acima de 128 continuam rejeitados.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Valor monetário: finito, não negativo (nunca aritmética aqui, só validação). */
function isValidMoneyValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** String vazia normalizada para `null`; qualquer outro tipo é inválido. */
function normalizeNullableString(
  value: unknown,
  maxLength: number,
): { valid: true; value: string | null } | { valid: false } {
  if (typeof value !== 'string' || value.length > maxLength) {
    return { valid: false };
  }
  return { valid: true, value: value.length === 0 ? null : value };
}

function validateItem(raw: unknown): ItemValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return reject('ITEM_NOT_OBJECT', raw);
  }
  const item = raw as Record<string, unknown>;

  // `item_id` é sempre > 0 na Shopee (nunca o sentinela "0" de "sem
  // variação" - esse é exclusivo de `model_id`).
  if (!isPositiveSafeInteger(item.item_id)) {
    return reject('ITEM_ID_INVALID', item.item_id);
  }
  const itemId = String(item.item_id);

  if (
    typeof item.item_name !== 'string' ||
    item.item_name.length === 0 ||
    item.item_name.length > MAX_ITEM_NAME_LENGTH
  ) {
    return reject('ITEM_NAME_INVALID', item.item_name);
  }
  const itemName = item.item_name;

  const itemSkuResult = normalizeNullableString(item.item_sku, MAX_SKU_LENGTH);
  if (!itemSkuResult.valid) return reject('ITEM_SKU_INVALID', item.item_sku);

  // `model_id` pode ser 0 (documentado: sentinela de "sem variação") -
  // nunca decidido/traduzido para `null` neste checkpoint.
  if (!isNonNegativeSafeInteger(item.model_id)) {
    return reject('MODEL_ID_INVALID', item.model_id);
  }
  const modelId = String(item.model_id);

  const modelNameResult = normalizeNullableString(
    item.model_name,
    MAX_ITEM_NAME_LENGTH,
  );
  if (!modelNameResult.valid) {
    return reject('MODEL_NAME_INVALID', item.model_name);
  }

  const modelSkuResult = normalizeNullableString(
    item.model_sku,
    MAX_SKU_LENGTH,
  );
  if (!modelSkuResult.valid) return reject('MODEL_SKU_INVALID', item.model_sku);

  if (
    typeof item.model_quantity_purchased !== 'number' ||
    !Number.isInteger(item.model_quantity_purchased) ||
    item.model_quantity_purchased <= 0
  ) {
    return reject(
      'MODEL_QUANTITY_PURCHASED_INVALID',
      item.model_quantity_purchased,
    );
  }
  const quantity = item.model_quantity_purchased;

  if (!isValidMoneyValue(item.model_original_price)) {
    return reject('MODEL_ORIGINAL_PRICE_INVALID', item.model_original_price);
  }
  if (!isValidMoneyValue(item.model_discounted_price)) {
    return reject(
      'MODEL_DISCOUNTED_PRICE_INVALID',
      item.model_discounted_price,
    );
  }

  return {
    valid: true,
    item: {
      itemId,
      itemName,
      itemSku: itemSkuResult.value,
      modelId,
      modelName: modelNameResult.value,
      modelSku: modelSkuResult.value,
      quantity,
      originalPrice: item.model_original_price,
      discountedPrice: item.model_discounted_price,
    },
  };
}

function validateOrder(raw: unknown): OrderValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return reject('ORDER_NOT_OBJECT', raw);
  }
  const order = raw as Record<string, unknown>;

  const orderSn = order.order_sn;
  if (
    typeof orderSn !== 'string' ||
    orderSn.length === 0 ||
    orderSn.length > MAX_ORDER_SN_LENGTH
  ) {
    return reject('ORDER_SN_INVALID', orderSn);
  }

  const region = order.region;
  if (
    typeof region !== 'string' ||
    region.length === 0 ||
    region.length > MAX_REGION_LENGTH
  ) {
    return reject('REGION_INVALID', region);
  }

  const currency = order.currency;
  if (typeof currency !== 'string' || currency.length !== CURRENCY_LENGTH) {
    return reject('CURRENCY_INVALID', currency);
  }

  const orderStatus = order.order_status;
  if (
    typeof orderStatus !== 'string' ||
    !ORDER_STATUS_VALUES.has(orderStatus)
  ) {
    return reject('ORDER_STATUS_INVALID', orderStatus);
  }

  let totalAmount: number | null = null;
  if ('total_amount' in order) {
    if (!isValidMoneyValue(order.total_amount)) {
      return reject('TOTAL_AMOUNT_INVALID', order.total_amount);
    }
    totalAmount = order.total_amount;
  }

  if (!isPositiveSafeInteger(order.create_time)) {
    return reject('CREATE_TIME_INVALID', order.create_time);
  }
  const createTime = order.create_time;

  let updateTime: number | null = null;
  if ('update_time' in order) {
    if (!isPositiveSafeInteger(order.update_time)) {
      return reject('UPDATE_TIME_INVALID', order.update_time);
    }
    updateTime = order.update_time;
  }

  let fulfillmentFlag: string | null = null;
  if ('fulfillment_flag' in order) {
    const result = normalizeNullableString(
      order.fulfillment_flag,
      MAX_FULFILLMENT_FLAG_LENGTH,
    );
    if (!result.valid) {
      return reject('FULFILLMENT_FLAG_INVALID', order.fulfillment_flag);
    }
    fulfillmentFlag = result.value;
  }

  const itemListRaw = order.item_list;
  if (!Array.isArray(itemListRaw)) {
    return reject('ITEM_LIST_NOT_ARRAY', itemListRaw);
  }
  const items: ShopeeOrderDetailItem[] = [];
  for (const rawItem of itemListRaw) {
    const itemResult = validateItem(rawItem);
    if (!itemResult.valid) return itemResult;
    items.push(itemResult.item);
  }

  return {
    valid: true,
    order: {
      orderSn,
      region,
      currency,
      orderStatus: orderStatus as ShopeeOrderStatus,
      totalAmount,
      createTime,
      updateTime,
      fulfillmentFlag,
      items,
    },
  };
}

/**
 * Validador puro de uma resposta DESCONHECIDA de
 * `GET /api/v2/order/get_order_detail` (Checkpoint CP2K-2). Allowlist
 * estrita: extrai SOMENTE os campos do contrato acima - `buyer_user_id`,
 * `buyer_username`, `buyer_cpf_id`, `recipient_address`, `dropshipper`,
 * `dropshipper_phone`, `virtual_contact_number`, `package_query_number`,
 * `pharmacist_name`, `prescription_images`, `prescription_reject_reason`,
 * `buyer_proof_of_collection`, `message_to_seller` e qualquer campo
 * desconhecido são sempre ignorados, mesmo que presentes no corpo bruto.
 *
 * Integridade do lote (Checkpoint CP2K-2): o conjunto de `order_sn`
 * devolvido deve ser EXATAMENTE igual ao solicitado (`requestedOrderSnList`)
 * - nenhum `order_sn` extra, nenhum duplicado, nenhum faltando. A
 * documentação oficial não afirma explicitamente que respostas parciais são
 * válidas, então qualquer divergência falha fechado como `invalid_response`.
 */
export function validateShopeeOrderDetailResponseBody(
  body: unknown,
  requestedOrderSnList: string[],
): ShopeeOrderDetailValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return reject('ROOT_NOT_OBJECT', body);
  }
  const raw = body as Record<string, unknown>;

  const error = raw.error;
  if (typeof error !== 'string') return reject('ERROR_NOT_STRING', error);
  if (typeof raw.message !== 'string') {
    return reject('MESSAGE_NOT_STRING', raw.message);
  }
  if (error.length > 0) return reject('ERROR_NOT_EMPTY', error);

  const requestId = raw.request_id;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return reject('REQUEST_ID_INVALID', requestId);
  }

  const response = raw.response;
  if (
    typeof response !== 'object' ||
    response === null ||
    Array.isArray(response)
  ) {
    return reject('RESPONSE_NOT_OBJECT', response);
  }
  const responseRaw = response as Record<string, unknown>;

  const orderListRaw = responseRaw.order_list;
  if (!Array.isArray(orderListRaw)) {
    return reject('ORDER_LIST_NOT_ARRAY', orderListRaw);
  }

  // Tamanho deve bater EXATAMENTE com o solicitado - cobre "mais que 50"/
  // "mais que o pedido" e é pré-condição necessária (não suficiente sozinha)
  // para a checagem de conjunto abaixo.
  if (orderListRaw.length !== requestedOrderSnList.length) {
    return reject('ORDER_LIST_LENGTH_MISMATCH', orderListRaw);
  }

  const requestedSet = new Set(requestedOrderSnList);
  const seenOrderSn = new Set<string>();
  const orders: ShopeeOrderDetailOrder[] = [];

  for (let orderIndex = 0; orderIndex < orderListRaw.length; orderIndex += 1) {
    const orderResult = validateOrder(orderListRaw[orderIndex]);
    if (!orderResult.valid) {
      return {
        valid: false,
        issue: withShopeeOrderIndex(orderResult.issue, orderIndex),
      };
    }

    const { orderSn } = orderResult.order;
    if (!requestedSet.has(orderSn)) {
      return {
        valid: false,
        issue: shopeeOrderDetailValidationIssue(
          'ORDER_SN_NOT_REQUESTED',
          orderSn,
          orderIndex,
        ),
      };
    }
    if (seenOrderSn.has(orderSn)) {
      return {
        valid: false,
        issue: shopeeOrderDetailValidationIssue(
          'ORDER_SN_DUPLICATED',
          orderSn,
          orderIndex,
        ),
      };
    }
    seenOrderSn.add(orderSn);

    orders.push(orderResult.order);
  }

  return { valid: true, result: { orders, requestId } };
}
