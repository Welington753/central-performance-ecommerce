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

  // --- Checkpoint CP2D (início da conexão e callback HTTP) ---------------
  'AUTHORIZATION_URL_BUILD_FAILED',

  // --- Checkpoint CP2H (renovação segura do access token) ----------------
  // `RATE_LIMITED` já estava reservado (ver acima) — primeiro escritor real
  // é `ShopeeAccessTokenService` (backoff, NUNCA muda status). `REFRESH_FAILED`
  // (também já reservado) passa a ser escrito para rejeição DEFINITIVA do
  // refresh_token pela Shopee (`provider_rejected`) — marca TOKEN_EXPIRED.
  'CREDENTIAL_DECRYPTION_FAILED',
  // Resultado de rede AMBÍGUO após o envio (timeout, JSON inválido, 5xx):
  // pode significar que a Shopee já consumiu o refresh_token (de uso único)
  // sem o sistema ter recebido os tokens novos. NUNCA retenta
  // automaticamente com o mesmo refresh_token — marca ERROR (reconexão
  // manual), nunca TOKEN_EXPIRED (não é uma rejeição confirmada) nem um
  // simples backoff (não é comprovadamente seguro reenviar).
  'REFRESH_RESULT_AMBIGUOUS',
] as const;

export type ShopeeOAuthFailureCode =
  (typeof SHOPEE_OAUTH_FAILURE_CODES)[number];
