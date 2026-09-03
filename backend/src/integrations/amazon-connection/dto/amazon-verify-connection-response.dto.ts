/**
 * Vocabulário fechado de resultado da verificação de conexão (Checkpoint
 * 4-C) — a string É o código exposto ao frontend, nunca texto livre,
 * mensagem de driver ou corpo bruto da resposta Amazon.
 */
export type AmazonVerifyConnectionCode =
  | 'VERIFIED'
  | 'AMAZON_NOT_CONFIGURED'
  | 'AMAZON_ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN'
  | 'AMAZON_ACCOUNT_BUSY'
  | 'AMAZON_REFRESH_TOKEN_REJECTED'
  | 'AMAZON_LWA_APP_CONFIGURATION_ERROR'
  | 'AMAZON_REFRESH_TRANSIENT_FAILURE'
  | 'AMAZON_REFRESH_RESULT_NOT_COMMITTED'
  | 'AMAZON_CREDENTIAL_DECRYPTION_FAILED'
  | 'AMAZON_ACCOUNT_MARKETPLACE_MISMATCH'
  | 'PROVIDER_REJECTED_CREDENTIAL'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_REJECTED_REQUEST'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'PROVIDER_UNAVAILABLE';

/**
 * Resposta de `POST /marketplace-accounts/:id/amazon/verify` — allowlist
 * fechada. Nunca inclui o payload de pedidos consultado (descartado
 * imediatamente após a validação), nunca um pedido individual, SKU, token
 * ou header.
 */
export interface AmazonVerifyConnectionResponseDto {
  connected: boolean;
  code: AmazonVerifyConnectionCode;
  verifiedAt: string;
  marketplaceCount: number;
}
