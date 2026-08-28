/**
 * Vocabulário fechado de failureCode (design §7). Toda escrita de
 * failureCode no sistema deve usar um destes valores — nunca uma string
 * livre com detalhe do provedor.
 */
export const ML_OAUTH_FAILURE_CODES = [
  'STATE_INVALID',
  'AUTHORIZATION_DENIED',
  'AUTHORIZATION_PROVIDER_ERROR',
  'ACCOUNT_BUSY',
  'CALLBACK_RESULT_UNKNOWN',
  'TOKEN_EXCHANGE_FAILED',
  'INVALID_TOKEN_RESPONSE',
  'IDENTITY_LOOKUP_FAILED',
  'IDENTITY_MISMATCH',
  'ACCOUNT_ALREADY_CONNECTED',
  'ACCOUNT_STATE_CONFLICT',
  'TOKEN_RESULT_NOT_COMMITTED',
  'REFRESH_RESULT_UNKNOWN',
  'REFRESH_TOKEN_REJECTED',
  'REFRESH_RESULT_NOT_COMMITTED',
  'CREDENTIAL_DECRYPTION_FAILED',
] as const;

export type MercadoLivreOAuthFailureCode =
  (typeof ML_OAUTH_FAILURE_CODES)[number];
