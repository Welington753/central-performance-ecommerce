import { parsePositiveSafeIntegerString } from './shopee-decimal-id.util';

export type ShopeeCallbackInputValidation =
  | { valid: true; state: string; code: string; shopId: string }
  | { valid: false };

/**
 * Limites defensivos (Checkpoint CP2C) — mesmo raciocínio de
 * `callback-params.validator.ts` (Mercado Livre): protegem contra payload
 * absurdo antes de qualquer uso do valor, nunca a gramática exata (não
 * confirmada) do `state`/`code` da Shopee.
 */
const MAX_STATE_LENGTH = 512;
const MAX_CODE_LENGTH = 2048;
const WHITESPACE_PATTERN = /\s/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validador puro da entrada do callback Shopee — `state`/`code`/`shopId`.
 * Nunca consome a tentativa pendente (não chama `claimByState`) nem realiza
 * qualquer chamada de rede; só confirma formato/tamanho. `shopId` reaproveita
 * `parsePositiveSafeIntegerString` (decimal positivo, sem espaços, dentro de
 * `Number.MAX_SAFE_INTEGER` — o mesmo critério já usado por
 * `ShopeeHttpClient`).
 */
export function validateShopeeCallbackInput(input: {
  state: unknown;
  code: unknown;
  shopId: unknown;
}): ShopeeCallbackInputValidation {
  const { state, code, shopId } = input;

  if (!isNonEmptyString(state) || state.length > MAX_STATE_LENGTH) {
    return { valid: false };
  }
  if (WHITESPACE_PATTERN.test(state)) return { valid: false };

  if (!isNonEmptyString(code) || code.length > MAX_CODE_LENGTH) {
    return { valid: false };
  }
  if (WHITESPACE_PATTERN.test(code)) return { valid: false };

  if (!isNonEmptyString(shopId)) return { valid: false };
  if (parsePositiveSafeIntegerString(shopId) === null) return { valid: false };

  return { valid: true, state, code, shopId };
}
