/**
 * Vocabulário fechado de failureCode/erro para a integração Amazon
 * (mesmo espírito de `mercado-livre-oauth-failure-code.ts`): toda escrita de
 * `failureCode` e todo `ConflictException` lançado por este módulo usa um
 * destes valores — nunca uma string livre com detalhe do provedor.
 */
export const AMAZON_FAILURE_CODES = [
  'AMAZON_NOT_CONFIGURED',
  'AMAZON_ACCOUNT_MARKETPLACE_MISMATCH',
  'AMAZON_ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN',
  'AMAZON_ACCOUNT_BUSY',
  'AMAZON_CREDENTIAL_DECRYPTION_FAILED',
  'AMAZON_REFRESH_TOKEN_REJECTED',
  'AMAZON_LWA_APP_CONFIGURATION_ERROR',
  'AMAZON_REFRESH_TRANSIENT_FAILURE',
  'AMAZON_REFRESH_RESULT_NOT_COMMITTED',
  'AMAZON_ACCOUNT_ALREADY_CONNECTED',
  'AMAZON_PROVISION_VERSION_CONFLICT',
] as const;

export type AmazonFailureCode = (typeof AMAZON_FAILURE_CODES)[number];
