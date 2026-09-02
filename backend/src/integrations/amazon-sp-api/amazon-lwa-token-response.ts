export interface AmazonLwaTokenResponse {
  accessToken: string;
  tokenType: string;
  expiresInSeconds: number;
}

export type AmazonLwaTokenResponseValidation =
  { valid: true; token: AmazonLwaTokenResponse } | { valid: false };

/**
 * Teto interno DEFENSIVO, mesmo espírito de `mercado-livre-token-response.ts`
 * — só protege contra uma resposta malformada/corrompida, não é a validade
 * oficial documentada pela Amazon.
 */
const MAX_EXPIRES_IN_SECONDS = 86400;

/**
 * Validação fechada da resposta de `POST https://api.amazon.com/auth/o2/token`
 * (Etapa 4): apenas `access_token`, `token_type` e `expires_in` são exigidos
 * — a troca por `refresh_token` não é validada nem exigida aqui porque a LWA
 * não a inclui de forma garantida em respostas de `grant_type=refresh_token`,
 * e o design deste checkpoint nunca rotaciona o refresh token armazenado
 * (`AmazonAuthService.ensureValidAccessToken` preserva o refresh token
 * existente em toda renovação).
 */
export function validateAmazonLwaTokenResponseBody(
  body: unknown,
): AmazonLwaTokenResponseValidation {
  if (typeof body !== 'object' || body === null) return { valid: false };
  const raw = body as Record<string, unknown>;

  const accessToken = raw.access_token;
  const tokenType = raw.token_type;
  const expiresIn = raw.expires_in;

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { valid: false };
  }
  if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
    return { valid: false };
  }
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
    token: { accessToken, tokenType, expiresInSeconds: expiresIn },
  };
}
