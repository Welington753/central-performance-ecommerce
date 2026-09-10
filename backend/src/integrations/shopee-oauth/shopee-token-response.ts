export interface ShopeeTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  /**
   * `request_id` sanitizado (apenas letras, números, `_`/`-`), útil para
   * correlacionar com o suporte Shopee em caso de falha — `null` quando
   * ausente ou com formato inesperado. NUNCA o `message` bruto do provedor
   * é preservado aqui nem em qualquer outro campo.
   */
  requestId: string | null;
}

export type ShopeeTokenResponseValidation =
  { valid: true; token: ShopeeTokenResult } | { valid: false };

/**
 * Teto interno DEFENSIVO (Checkpoint CP2A) — não é a validade oficial do
 * `access_token` da Shopee (~4h, conforme decisão confirmada: usar
 * `expire_in` retornado, nunca uma duração fixa no código). Só protege
 * contra resposta malformada/corrompida com um valor absurdo.
 */
const MAX_EXPIRE_IN_SECONDS = 86400;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Validador puro de uma resposta DESCONHECIDA de `/auth/token/get` ou
 * `/auth/access_token/get`. Nunca transporta `message`/payload bruto do
 * provedor para fora desta função — só os quatro campos internos listados
 * em `ShopeeTokenResult`.
 */
export function validateShopeeTokenResponseBody(
  body: unknown,
): ShopeeTokenResponseValidation {
  if (typeof body !== 'object' || body === null) return { valid: false };
  const raw = body as Record<string, unknown>;

  const error = raw.error;
  if (typeof error !== 'string' || error.length > 0) return { valid: false };

  const accessToken = raw.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { valid: false };
  }

  const refreshToken = raw.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return { valid: false };
  }

  const expireIn = raw.expire_in;
  if (
    typeof expireIn !== 'number' ||
    !Number.isSafeInteger(expireIn) ||
    expireIn <= 0 ||
    expireIn > MAX_EXPIRE_IN_SECONDS
  ) {
    return { valid: false };
  }

  const rawRequestId = raw.request_id;
  const requestId =
    typeof rawRequestId === 'string' && REQUEST_ID_PATTERN.test(rawRequestId)
      ? rawRequestId
      : null;

  return {
    valid: true,
    token: {
      accessToken,
      refreshToken,
      expiresInSeconds: expireIn,
      requestId,
    },
  };
}
