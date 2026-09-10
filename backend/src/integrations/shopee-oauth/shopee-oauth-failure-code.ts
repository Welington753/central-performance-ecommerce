/**
 * Vocabulário fechado de failureCode da Shopee — independente do vocabulário
 * do Mercado Livre (`mercado-livre-oauth-failure-code.ts`, nunca alterado
 * por este arquivo). Toda escrita de failureCode relacionada à Shopee deve
 * usar um destes valores, nunca uma string livre com detalhe do provedor.
 *
 * `PROVIDER_UNAVAILABLE` removido no Checkpoint CP2B (revisão de
 * segurança): nenhum cenário real garante de forma comprovável que uma
 * requisição nunca chegou à Shopee — mantê-lo seria uma afirmação
 * enganosa. `unknown_result` do `ShopeeHttpClient` mapeia para
 * `TOKEN_EXCHANGE_RESULT_UNKNOWN` (Checkpoint CP2C), nunca para algo que
 * implique "nunca chegou".
 */
export const SHOPEE_OAUTH_FAILURE_CODES = [
  'SHOPEE_NOT_CONFIGURED',
  'INVALID_REDIRECT_URI',
  'INVALID_AUTHORIZATION_RESPONSE',
  'INVALID_TOKEN_RESPONSE',
  // Reservados para checkpoints futuros (renovação/assinatura) — ainda sem
  // nenhum escritor real.
  'REFRESH_FAILED',
  'WRONG_SIGN',
  'RATE_LIMITED',

  // --- Checkpoint CP2C (processamento transacional da autorização) -------
  'OAUTH_CALLBACK_INVALID',
  'TOKEN_EXCHANGE_FAILED',
  'TOKEN_EXCHANGE_REJECTED',
  'TOKEN_EXCHANGE_RATE_LIMITED',
  'TOKEN_EXCHANGE_INVALID_RESPONSE',
  'TOKEN_EXCHANGE_RESULT_UNKNOWN',
  'TOKEN_RESULT_NOT_COMMITTED',
  'REFRESH_RESULT_NOT_COMMITTED',
  'SHOP_ALREADY_CONNECTED',
  'ACCOUNT_NOT_ELIGIBLE',
  'CREDENTIAL_ENCRYPTION_FAILED',
  'ACCOUNT_BUSY',
] as const;

export type ShopeeOAuthFailureCode =
  (typeof SHOPEE_OAUTH_FAILURE_CODES)[number];
