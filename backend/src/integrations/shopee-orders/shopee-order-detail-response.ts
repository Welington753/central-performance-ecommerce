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
  { valid: true; result: ShopeeOrderDetailResult } | { valid: false };

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

function validateItem(
  raw: unknown,
): { valid: true; item: ShopeeOrderDetailItem } | { valid: false } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false };
  }
  const item = raw as Record<string, unknown>;

  // `item_id` é sempre > 0 na Shopee (nunca o sentinela "0" de "sem
  // variação" - esse é exclusivo de `model_id`).
  if (!isPositiveSafeInteger(item.item_id)) return { valid: false };
  const itemId = String(item.item_id);

  if (typeof item.item_name !== 'string' || item.item_name.length === 0) {
    return { valid: false };
  }
  if (item.item_name.length > MAX_ITEM_NAME_LENGTH) return { valid: false };
  const itemName = item.item_name;

  const itemSkuResult = normalizeNullableString(item.item_sku, MAX_SKU_LENGTH);
  if (!itemSkuResult.valid) return { valid: false };

  // `model_id` pode ser 0 (documentado: sentinela de "sem variação") -
  // nunca decidido/traduzido para `null` neste checkpoint.
  if (!isNonNegativeSafeInteger(item.model_id)) return { valid: false };
  const modelId = String(item.model_id);

  const modelNameResult = normalizeNullableString(
    item.model_name,
    MAX_ITEM_NAME_LENGTH,
  );
  if (!modelNameResult.valid) return { valid: false };

  const modelSkuResult = normalizeNullableString(
    item.model_sku,
    MAX_SKU_LENGTH,
  );
  if (!modelSkuResult.valid) return { valid: false };

  if (
    typeof item.model_quantity_purchased !== 'number' ||
    !Number.isInteger(item.model_quantity_purchased) ||
    item.model_quantity_purchased <= 0
  ) {
    return { valid: false };
  }
  const quantity = item.model_quantity_purchased;

  if (!isValidMoneyValue(item.model_original_price)) return { valid: false };
  if (!isValidMoneyValue(item.model_discounted_price)) return { valid: false };

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

function validateOrder(
  raw: unknown,
): { valid: true; order: ShopeeOrderDetailOrder } | { valid: false } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false };
  }
  const order = raw as Record<string, unknown>;

  const orderSn = order.order_sn;
  if (
    typeof orderSn !== 'string' ||
    orderSn.length === 0 ||
    orderSn.length > MAX_ORDER_SN_LENGTH
  ) {
    return { valid: false };
  }

  const region = order.region;
  if (
    typeof region !== 'string' ||
    region.length === 0 ||
    region.length > MAX_REGION_LENGTH
  ) {
    return { valid: false };
  }

  const currency = order.currency;
  if (typeof currency !== 'string' || currency.length !== CURRENCY_LENGTH) {
    return { valid: false };
  }

  const orderStatus = order.order_status;
  if (
    typeof orderStatus !== 'string' ||
    !ORDER_STATUS_VALUES.has(orderStatus)
  ) {
    return { valid: false };
  }

  let totalAmount: number | null = null;
  if ('total_amount' in order) {
    if (!isValidMoneyValue(order.total_amount)) return { valid: false };
    totalAmount = order.total_amount;
  }

  if (!isPositiveSafeInteger(order.create_time)) return { valid: false };
  const createTime = order.create_time;

  let updateTime: number | null = null;
  if ('update_time' in order) {
    if (!isPositiveSafeInteger(order.update_time)) return { valid: false };
    updateTime = order.update_time;
  }

  let fulfillmentFlag: string | null = null;
  if ('fulfillment_flag' in order) {
    const result = normalizeNullableString(
      order.fulfillment_flag,
      MAX_FULFILLMENT_FLAG_LENGTH,
    );
    if (!result.valid) return { valid: false };
    fulfillmentFlag = result.value;
  }

  const itemListRaw = order.item_list;
  if (!Array.isArray(itemListRaw)) return { valid: false };
  const items: ShopeeOrderDetailItem[] = [];
  for (const rawItem of itemListRaw) {
    const itemResult = validateItem(rawItem);
    if (!itemResult.valid) return { valid: false };
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
    return { valid: false };
  }
  const raw = body as Record<string, unknown>;

  const error = raw.error;
  if (typeof error !== 'string') return { valid: false };
  if (typeof raw.message !== 'string') return { valid: false };
  if (error.length > 0) return { valid: false };

  const requestId = raw.request_id;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    return { valid: false };
  }

  const response = raw.response;
  if (
    typeof response !== 'object' ||
    response === null ||
    Array.isArray(response)
  ) {
    return { valid: false };
  }
  const responseRaw = response as Record<string, unknown>;

  const orderListRaw = responseRaw.order_list;
  if (!Array.isArray(orderListRaw)) return { valid: false };

  // Tamanho deve bater EXATAMENTE com o solicitado - cobre "mais que 50"/
  // "mais que o pedido" e é pré-condição necessária (não suficiente sozinha)
  // para a checagem de conjunto abaixo.
  if (orderListRaw.length !== requestedOrderSnList.length) {
    return { valid: false };
  }

  const requestedSet = new Set(requestedOrderSnList);
  const seenOrderSn = new Set<string>();
  const orders: ShopeeOrderDetailOrder[] = [];

  for (const rawOrder of orderListRaw) {
    const orderResult = validateOrder(rawOrder);
    if (!orderResult.valid) return { valid: false };

    const { orderSn } = orderResult.order;
    if (!requestedSet.has(orderSn)) return { valid: false };
    if (seenOrderSn.has(orderSn)) return { valid: false };
    seenOrderSn.add(orderSn);

    orders.push(orderResult.order);
  }

  return { valid: true, result: { orders, requestId } };
}
