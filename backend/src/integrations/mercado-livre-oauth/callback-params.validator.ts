export type CallbackQuery = Record<string, string | string[] | undefined>;

export type CallbackParamsResult =
  | { valid: true; state: string; code: string; error: null }
  | { valid: true; state: string; code: null; error: string }
  | { valid: false };

const MAX_STATE_LENGTH = 512;
const MAX_CODE_LENGTH = 2048;
const MAX_ERROR_LENGTH = 128;
const MAX_ERROR_DESCRIPTION_LENGTH = 1024;
const MAX_ERROR_URI_LENGTH = 2048;
const ALLOWED_KEYS = new Set([
  'state',
  'code',
  'error',
  'error_description',
  'error_uri',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * design §6.2 passo 1: `state` obrigatório; exatamente um entre `code` e
 * `error`; `error_description`/`error_uri` só como complemento opcional de
 * `error`, validados só por tamanho e NUNCA propagados no resultado (nunca
 * logados/persistidos/redirecionados/em errorSummary ou exceções).
 */
export function validateCallbackParams(
  query: CallbackQuery,
): CallbackParamsResult {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_KEYS.has(key)) return { valid: false };
  }

  const state = query.state;
  const code = query.code;
  const error = query.error;
  const errorDescription = query.error_description;
  const errorUri = query.error_uri;

  if (!isNonEmptyString(state) || state.length > MAX_STATE_LENGTH) {
    return { valid: false };
  }

  const hasCode = isNonEmptyString(code);
  const hasError = isNonEmptyString(error);

  if (hasCode === hasError) return { valid: false }; // XOR

  if (hasCode) {
    if (errorDescription !== undefined || errorUri !== undefined) {
      return { valid: false };
    }
    if (code.length > MAX_CODE_LENGTH) return { valid: false };
    return { valid: true, state, code, error: null };
  }

  if ((error as string).length > MAX_ERROR_LENGTH) return { valid: false };
  if (
    errorDescription !== undefined &&
    (typeof errorDescription !== 'string' ||
      errorDescription.length > MAX_ERROR_DESCRIPTION_LENGTH)
  ) {
    return { valid: false };
  }
  if (
    errorUri !== undefined &&
    (typeof errorUri !== 'string' || errorUri.length > MAX_ERROR_URI_LENGTH)
  ) {
    return { valid: false };
  }

  return { valid: true, state, code: null, error: error as string };
}
