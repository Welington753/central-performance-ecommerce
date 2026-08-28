export interface MercadoLivreTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  userId: number;
  tokenType: string;
  scope: string;
}

export type TokenResponseValidation =
  { valid: true; token: MercadoLivreTokenResponse } | { valid: false };

/**
 * Teto interno DEFENSIVO (design §10) — não é a validade oficial do token do
 * ML (a doc é inconsistente: "6 horas" no texto vs. `expires_in: 10800` no
 * exemplo). Só protege contra resposta malformada/corrompida.
 */
const MAX_EXPIRES_IN_SECONDS = 86400;

export function validateTokenResponseBody(
  body: unknown,
): TokenResponseValidation {
  if (typeof body !== 'object' || body === null) return { valid: false };
  const raw = body as Record<string, unknown>;

  const accessToken = raw.access_token;
  const refreshToken = raw.refresh_token;
  const expiresIn = raw.expires_in;
  const userId = raw.user_id;
  const tokenType = raw.token_type;
  const scope = raw.scope;

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { valid: false };
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return { valid: false };
  }
  if (typeof userId !== 'number' || !Number.isFinite(userId)) {
    return { valid: false };
  }
  if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
    return { valid: false };
  }
  if (typeof scope !== 'string') return { valid: false };

  const normalizedScopes = scope.toLowerCase().split(' ').filter(Boolean);
  if (!normalizedScopes.includes('read')) return { valid: false };
  if (normalizedScopes.includes('write')) return { valid: false };

  if (
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_EXPIRES_IN_SECONDS
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    token: {
      accessToken,
      refreshToken,
      expiresInSeconds: expiresIn,
      userId,
      tokenType,
      scope,
    },
  };
}
