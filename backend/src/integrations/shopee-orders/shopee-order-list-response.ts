export interface ShopeeOrderListOrderSummary {
  orderSn: string;
}

export interface ShopeeOrderListResult {
  orders: ShopeeOrderListOrderSummary[];
  more: boolean;
  /** `null` quando `more=false` (documentado: `next_cursor` vazio nesse caso). */
  nextCursor: string | null;
  requestId: string;
}

export type ShopeeOrderListValidation =
  { valid: true; result: ShopeeOrderListResult } | { valid: false };

/**
 * Teto defensivo (Checkpoint CP2K-1) - maior que qualquer `order_sn` de
 * exemplo na documentação oficial (14 caracteres); protege contra um
 * `order_sn` corrompido/anormalmente grande antes de qualquer uso posterior.
 */
const MAX_ORDER_SN_LENGTH = 64;

/** Mesmo teto local de `shopee-order-list-input.ts` (`MAX_CURSOR_LENGTH`). */
const MAX_CURSOR_LENGTH = 512;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isValidOrderEntry(value: unknown): value is { order_sn: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const orderSn = (value as Record<string, unknown>).order_sn;
  return (
    typeof orderSn === 'string' &&
    orderSn.length > 0 &&
    orderSn.length <= MAX_ORDER_SN_LENGTH
  );
}

/**
 * Validador puro de uma resposta DESCONHECIDA de
 * `GET /api/v2/order/get_order_list` (Checkpoint CP2K-1). `body` sempre
 * começa como `unknown` - nunca confia em nenhum campo antes de checar tipo.
 *
 * Extrai SOMENTE `order_sn` de cada entrada de `order_list` - qualquer outro
 * campo presente (ex.: `order_status`, se um dia vier sem ter sido pedido)
 * é silenciosamente descartado, nunca repassado ao chamador. Nunca
 * deduplica: entradas repetidas de `order_sn` são preservadas na mesma
 * ordem recebida - a deduplicação e a proteção contra cursor repetido
 * pertencem ao serviço de paginação de um checkpoint futuro, não a este
 * parser.
 */
export function validateShopeeOrderListResponseBody(
  body: unknown,
): ShopeeOrderListValidation {
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

  const orders: ShopeeOrderListOrderSummary[] = [];
  for (const entry of orderListRaw) {
    if (!isValidOrderEntry(entry)) return { valid: false };
    orders.push({ orderSn: entry.order_sn });
  }

  const more = responseRaw.more;
  if (typeof more !== 'boolean') return { valid: false };

  let nextCursor: string | null = null;
  if (more) {
    const rawNextCursor = responseRaw.next_cursor;
    if (
      typeof rawNextCursor !== 'string' ||
      rawNextCursor.length === 0 ||
      rawNextCursor.length > MAX_CURSOR_LENGTH
    ) {
      return { valid: false };
    }
    nextCursor = rawNextCursor;
  }
  // Quando `more=false`, `nextCursor` permanece `null` independentemente do
  // que `next_cursor` contiver na resposta bruta (documentado: vazio nesse
  // caso) - nunca inspecionado, nunca repassado.

  return {
    valid: true,
    result: { orders, more, nextCursor, requestId },
  };
}
