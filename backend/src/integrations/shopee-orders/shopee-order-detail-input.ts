import { containsControlCharacter } from './shopee-order-list-input';

export interface ShopeeOrderDetailInput {
  orderSnList: string[];
}

export type ShopeeOrderDetailInputInvalidCode =
  'INVALID_ORDER_SN_LIST_SIZE' | 'INVALID_ORDER_SN' | 'DUPLICATE_ORDER_SN';

export type ShopeeOrderDetailInputValidation =
  | { valid: true; input: ShopeeOrderDetailInput }
  | { valid: false; failureCode: ShopeeOrderDetailInputInvalidCode };

/** Limite oficial documentado: `order_sn_list` aceita entre 1 e 50 `order_sn`. */
const MAX_ORDER_SN_LIST_SIZE = 50;

/** Mesmo teto conservador de `shopee-order-list-response.ts` (`MAX_ORDER_SN_LENGTH`). */
const MAX_ORDER_SN_LENGTH = 64;

function isValidOrderSn(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ORDER_SN_LENGTH &&
    // Nunca apara/converte: um `order_sn` com espaço externo é REJEITADO,
    // nunca silenciosamente normalizado.
    value === value.trim() &&
    // Vírgula corromperia a junção por vírgula do parâmetro `order_sn_list`.
    !value.includes(',') &&
    !containsControlCharacter(value)
  );
}

/**
 * Validador puro de entrada de `GET /api/v2/order/get_order_detail`
 * (Checkpoint CP2K-2) - roda ANTES de qualquer assinatura/URL/fetch. Nunca
 * aceita `response_optional_fields` do chamador (é sempre a constante
 * fechada `SHOPEE_ORDER_DETAIL_RESPONSE_OPTIONAL_FIELDS`).
 */
export function validateShopeeOrderDetailInput(
  input: ShopeeOrderDetailInput,
): ShopeeOrderDetailInputValidation {
  if (
    !Array.isArray(input.orderSnList) ||
    input.orderSnList.length < 1 ||
    input.orderSnList.length > MAX_ORDER_SN_LIST_SIZE
  ) {
    return { valid: false, failureCode: 'INVALID_ORDER_SN_LIST_SIZE' };
  }

  for (const orderSn of input.orderSnList) {
    if (!isValidOrderSn(orderSn)) {
      return { valid: false, failureCode: 'INVALID_ORDER_SN' };
    }
  }

  if (new Set(input.orderSnList).size !== input.orderSnList.length) {
    // Rejeitado explicitamente - nunca deduplicado silenciosamente.
    return { valid: false, failureCode: 'DUPLICATE_ORDER_SN' };
  }

  return { valid: true, input: { orderSnList: input.orderSnList } };
}
