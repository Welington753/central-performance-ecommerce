/**
 * Vocabulário fechado de failureCode da Shopee — independente do vocabulário
 * do Mercado Livre (`mercado-livre-oauth-failure-code.ts`, nunca alterado
 * por este arquivo). Toda escrita de failureCode relacionada à Shopee deve
 * usar um destes valores, nunca uma string livre com detalhe do provedor.
 */
export const SHOPEE_OAUTH_FAILURE_CODES = [
  'SHOPEE_NOT_CONFIGURED',
  'INVALID_REDIRECT_URI',
  'INVALID_AUTHORIZATION_RESPONSE',
  'INVALID_TOKEN_RESPONSE',
  'TOKEN_EXCHANGE_FAILED',
  'REFRESH_FAILED',
  'WRONG_SIGN',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'TOKEN_RESULT_NOT_COMMITTED',
  'REFRESH_RESULT_NOT_COMMITTED',
] as const;

export type ShopeeOAuthFailureCode =
  (typeof SHOPEE_OAUTH_FAILURE_CODES)[number];
