/**
 * Vocabulário fechado de diagnóstico estrutural de
 * `validateShopeeOrderDetailResponseBody` — responde "QUAL regra rejeitou a
 * resposta", nunca "QUAL valor veio". Um issue só carrega metadados
 * (código fechado, caminho de campo de allowlist, tipo JSON genérico e o
 * índice do pedido dentro do lote); nenhum valor recebido da Shopee entra
 * aqui — nunca `order_sn`, valor monetário, item/SKU, dado de comprador,
 * `raw.message`, corpo bruto, token, `sign` ou URL.
 */

/** Tipo JSON genérico do valor rejeitado — nunca o valor em si. */
export const SHOPEE_VALIDATION_ACTUAL_TYPES = [
  'missing',
  'null',
  'string',
  'number',
  'boolean',
  'object',
  'array',
] as const;

export type ShopeeValidationActualType =
  (typeof SHOPEE_VALIDATION_ACTUAL_TYPES)[number];

/**
 * Allowlist fechada de caminhos de campo. Contém SOMENTE campos que o
 * validador de fato inspeciona — nenhum campo pessoal/sensível é inspecionado
 * (a allowlist de extração do validador já os ignora), então nenhum pode
 * aparecer aqui. `$` é a raiz do corpo.
 */
export const SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS = [
  '$',
  'error',
  'message',
  'request_id',
  'response',
  'response.order_list',
  'response.order_list[]',
  'response.order_list[].order_sn',
  'response.order_list[].region',
  'response.order_list[].currency',
  'response.order_list[].order_status',
  'response.order_list[].total_amount',
  'response.order_list[].create_time',
  'response.order_list[].update_time',
  'response.order_list[].fulfillment_flag',
  'response.order_list[].item_list',
  'response.order_list[].item_list[]',
  'response.order_list[].item_list[].item_id',
  'response.order_list[].item_list[].item_name',
  'response.order_list[].item_list[].item_sku',
  'response.order_list[].item_list[].model_id',
  'response.order_list[].item_list[].model_name',
  'response.order_list[].item_list[].model_sku',
  'response.order_list[].item_list[].model_quantity_purchased',
  'response.order_list[].item_list[].model_original_price',
  'response.order_list[].item_list[].model_discounted_price',
] as const;

export type ShopeeOrderDetailValidationFieldPath =
  (typeof SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS)[number];

/** Um código por regra estrutural que retorna `valid: false` no validador. */
export const SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES = [
  'ROOT_NOT_OBJECT',
  'ERROR_NOT_STRING',
  'ERROR_NOT_EMPTY',
  'MESSAGE_NOT_STRING',
  'REQUEST_ID_INVALID',
  'RESPONSE_NOT_OBJECT',
  'ORDER_LIST_NOT_ARRAY',
  'ORDER_LIST_LENGTH_MISMATCH',
  'ORDER_NOT_OBJECT',
  'ORDER_SN_INVALID',
  'ORDER_SN_NOT_REQUESTED',
  'ORDER_SN_DUPLICATED',
  'REGION_INVALID',
  'CURRENCY_INVALID',
  'ORDER_STATUS_INVALID',
  'TOTAL_AMOUNT_INVALID',
  'CREATE_TIME_INVALID',
  'UPDATE_TIME_INVALID',
  'FULFILLMENT_FLAG_INVALID',
  'ITEM_LIST_NOT_ARRAY',
  'ITEM_NOT_OBJECT',
  'ITEM_ID_INVALID',
  'ITEM_NAME_INVALID',
  'ITEM_SKU_INVALID',
  'MODEL_ID_INVALID',
  'MODEL_NAME_INVALID',
  'MODEL_SKU_INVALID',
  'MODEL_QUANTITY_PURCHASED_INVALID',
  'MODEL_ORIGINAL_PRICE_INVALID',
  'MODEL_DISCOUNTED_PRICE_INVALID',
] as const;

export type ShopeeOrderDetailValidationIssueCode =
  (typeof SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES)[number];

/**
 * `fieldPath` nunca é montado por concatenação em tempo de execução — cada
 * código tem exatamente uma entrada aqui, então todo caminho emitido está na
 * allowlist por construção.
 */
export const SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_FIELD_PATHS: Record<
  ShopeeOrderDetailValidationIssueCode,
  ShopeeOrderDetailValidationFieldPath
> = {
  ROOT_NOT_OBJECT: '$',
  ERROR_NOT_STRING: 'error',
  ERROR_NOT_EMPTY: 'error',
  MESSAGE_NOT_STRING: 'message',
  REQUEST_ID_INVALID: 'request_id',
  RESPONSE_NOT_OBJECT: 'response',
  ORDER_LIST_NOT_ARRAY: 'response.order_list',
  ORDER_LIST_LENGTH_MISMATCH: 'response.order_list',
  ORDER_NOT_OBJECT: 'response.order_list[]',
  ORDER_SN_INVALID: 'response.order_list[].order_sn',
  ORDER_SN_NOT_REQUESTED: 'response.order_list[].order_sn',
  ORDER_SN_DUPLICATED: 'response.order_list[].order_sn',
  REGION_INVALID: 'response.order_list[].region',
  CURRENCY_INVALID: 'response.order_list[].currency',
  ORDER_STATUS_INVALID: 'response.order_list[].order_status',
  TOTAL_AMOUNT_INVALID: 'response.order_list[].total_amount',
  CREATE_TIME_INVALID: 'response.order_list[].create_time',
  UPDATE_TIME_INVALID: 'response.order_list[].update_time',
  FULFILLMENT_FLAG_INVALID: 'response.order_list[].fulfillment_flag',
  ITEM_LIST_NOT_ARRAY: 'response.order_list[].item_list',
  ITEM_NOT_OBJECT: 'response.order_list[].item_list[]',
  ITEM_ID_INVALID: 'response.order_list[].item_list[].item_id',
  ITEM_NAME_INVALID: 'response.order_list[].item_list[].item_name',
  ITEM_SKU_INVALID: 'response.order_list[].item_list[].item_sku',
  MODEL_ID_INVALID: 'response.order_list[].item_list[].model_id',
  MODEL_NAME_INVALID: 'response.order_list[].item_list[].model_name',
  MODEL_SKU_INVALID: 'response.order_list[].item_list[].model_sku',
  MODEL_QUANTITY_PURCHASED_INVALID:
    'response.order_list[].item_list[].model_quantity_purchased',
  MODEL_ORIGINAL_PRICE_INVALID:
    'response.order_list[].item_list[].model_original_price',
  MODEL_DISCOUNTED_PRICE_INVALID:
    'response.order_list[].item_list[].model_discounted_price',
};

export interface ShopeeOrderDetailValidationIssue {
  code: ShopeeOrderDetailValidationIssueCode;
  fieldPath: ShopeeOrderDetailValidationFieldPath;
  actualType: ShopeeValidationActualType;
  /** Índice do pedido dentro do lote de `get_order_detail`; ausente em falha de envelope. */
  orderIndex?: number;
}

export function describeShopeeValidationActualType(
  value: unknown,
): ShopeeValidationActualType {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const rawType = typeof value;
  switch (rawType) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'object':
      return rawType;
    default:
      // `function`/`symbol`/`bigint` nunca saem de `JSON.parse` — cai fechado
      // no tipo mais genérico, nunca no valor.
      return 'object';
  }
}

/**
 * Único construtor de issue — `value` é inspecionado SÓ para derivar
 * `actualType` e nunca é retido em nenhum campo do retorno.
 */
export function shopeeOrderDetailValidationIssue(
  code: ShopeeOrderDetailValidationIssueCode,
  value: unknown,
  orderIndex?: number,
): ShopeeOrderDetailValidationIssue {
  return {
    code,
    fieldPath: SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_FIELD_PATHS[code],
    actualType: describeShopeeValidationActualType(value),
    ...(orderIndex === undefined ? {} : { orderIndex }),
  };
}

/** Anexa o índice do pedido a um issue já construído em nível de pedido/item. */
export function withShopeeOrderIndex(
  issue: ShopeeOrderDetailValidationIssue,
  orderIndex: number,
): ShopeeOrderDetailValidationIssue {
  return { ...issue, orderIndex };
}
