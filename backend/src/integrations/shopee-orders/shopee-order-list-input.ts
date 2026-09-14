export type ShopeeOrderListTimeRangeField = 'create_time' | 'update_time';

export interface ShopeeOrderListInput {
  timeRangeField: ShopeeOrderListTimeRangeField;
  timeFrom: number;
  timeTo: number;
  pageSize: number;
  cursor?: string;
}

export interface ShopeeOrderListNormalizedInput {
  timeRangeField: ShopeeOrderListTimeRangeField;
  timeFrom: number;
  timeTo: number;
  pageSize: number;
  /** `null` representa a primeira página (cursor vazio/ausente). */
  cursor: string | null;
}

export type ShopeeOrderListInputInvalidCode =
  | 'INVALID_TIME_RANGE_FIELD'
  | 'INVALID_TIME_FROM'
  | 'INVALID_TIME_TO'
  | 'INVALID_TIME_RANGE_ORDER'
  | 'INVALID_TIME_RANGE_SPAN'
  | 'INVALID_PAGE_SIZE'
  | 'INVALID_CURSOR';

export type ShopeeOrderListInputValidation =
  | { valid: true; input: ShopeeOrderListNormalizedInput }
  | { valid: false; failureCode: ShopeeOrderListInputInvalidCode };

/** Limite oficial documentado: `time_from`/`time_to` no máximo 15 dias de diferença. */
const MAX_TIME_RANGE_SPAN_SECONDS = 15 * 24 * 60 * 60;

/**
 * Teto local conservador para `cursor` (Checkpoint CP2K-1) - a Shopee NUNCA
 * documenta um tamanho máximo para este valor opaco; os exemplos observados
 * (ex.: `"20"`) são minúsculos. 512 caracteres é generoso o bastante para
 * qualquer cursor real, e barra tanto um valor corrompido/anômalo quanto um
 * ataque de amplificação via query string.
 */
const MAX_CURSOR_LENGTH = 512;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Detecta qualquer caractere de controle ASCII (0x00-0x1F ou 0x7F, DEL) sem
 * usar um literal de regex com caractere de controle embutido (evita o
 * problema do `no-control-regex`/exceção de lint) - checagem por código de
 * caractere, char a char.
 */
function containsControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * `cursor` vazio ou ausente representa a primeira página (normalizado para
 * `null`). Um cursor NÃO VAZIO só é aceito se: não for só espaço em branco,
 * não contiver nenhum caractere de controle, e não exceder o teto local
 * conservador - qualquer um desses casos é rejeitado como `INVALID_CURSOR`,
 * nunca silenciosamente tratado como "primeira página".
 */
function validateCursor(
  cursor: string | undefined,
): { valid: true; cursor: string | null } | { valid: false } {
  if (cursor === undefined || cursor === '') {
    return { valid: true, cursor: null };
  }
  if (typeof cursor !== 'string') return { valid: false };
  if (cursor.trim().length === 0) return { valid: false };
  if (containsControlCharacter(cursor)) return { valid: false };
  if (cursor.length > MAX_CURSOR_LENGTH) return { valid: false };
  return { valid: true, cursor };
}

/**
 * Validador puro de entrada de `GET /api/v2/order/get_order_list`
 * (Checkpoint CP2K-1) - roda ANTES de qualquer assinatura/URL/fetch. Nunca
 * aceita `order_status`/`response_optional_fields`/
 * `request_order_status_pending`/`logistics_channel_id` (fora de escopo
 * deste checkpoint por design - ver CP2K-DOC) nem qualquer campo além dos
 * cinco parâmetros específicos documentados.
 */
export function validateShopeeOrderListInput(
  input: ShopeeOrderListInput,
): ShopeeOrderListInputValidation {
  if (
    input.timeRangeField !== 'create_time' &&
    input.timeRangeField !== 'update_time'
  ) {
    return { valid: false, failureCode: 'INVALID_TIME_RANGE_FIELD' };
  }

  if (!isPositiveSafeInteger(input.timeFrom)) {
    return { valid: false, failureCode: 'INVALID_TIME_FROM' };
  }
  if (!isPositiveSafeInteger(input.timeTo)) {
    return { valid: false, failureCode: 'INVALID_TIME_TO' };
  }
  if (input.timeFrom >= input.timeTo) {
    return { valid: false, failureCode: 'INVALID_TIME_RANGE_ORDER' };
  }
  if (input.timeTo - input.timeFrom > MAX_TIME_RANGE_SPAN_SECONDS) {
    return { valid: false, failureCode: 'INVALID_TIME_RANGE_SPAN' };
  }

  if (
    typeof input.pageSize !== 'number' ||
    !Number.isInteger(input.pageSize) ||
    input.pageSize < 1 ||
    input.pageSize > 100
  ) {
    return { valid: false, failureCode: 'INVALID_PAGE_SIZE' };
  }

  const cursorResult = validateCursor(input.cursor);
  if (!cursorResult.valid) {
    return { valid: false, failureCode: 'INVALID_CURSOR' };
  }

  return {
    valid: true,
    input: {
      timeRangeField: input.timeRangeField,
      timeFrom: input.timeFrom,
      timeTo: input.timeTo,
      pageSize: input.pageSize,
      cursor: cursorResult.cursor,
    },
  };
}
