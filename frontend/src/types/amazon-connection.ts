import type { MarketplaceAccountDto } from "./marketplace";

// Espelha `AmazonSetupStatusResponseDto` (backend, Checkpoint 4-C) — allowlist
// fechada: nunca Application ID completo, LWA Client ID/Secret, tokens ou
// valores cifrados.
export interface AmazonSetupStatusDto {
  applicationConfigured: boolean;
  missingConfigurationKeys: string[];
  hasAccount: boolean;
  accounts: MarketplaceAccountDto[];
  canProvision: boolean;
  canVerify: boolean;
  canSynchronize: boolean;
}

// Espelha `AmazonVerifyConnectionResponseDto` — o código É a mensagem
// (vocabulário fechado), nunca texto livre do backend/Amazon.
export type AmazonVerifyConnectionCode =
  | "VERIFIED"
  | "AMAZON_NOT_CONFIGURED"
  | "AMAZON_ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN"
  | "AMAZON_ACCOUNT_BUSY"
  | "AMAZON_REFRESH_TOKEN_REJECTED"
  | "AMAZON_LWA_APP_CONFIGURATION_ERROR"
  | "AMAZON_REFRESH_TRANSIENT_FAILURE"
  | "AMAZON_REFRESH_RESULT_NOT_COMMITTED"
  | "AMAZON_CREDENTIAL_DECRYPTION_FAILED"
  | "AMAZON_ACCOUNT_MARKETPLACE_MISMATCH"
  | "PROVIDER_REJECTED_CREDENTIAL"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_REJECTED_REQUEST"
  | "INVALID_PROVIDER_RESPONSE"
  | "PROVIDER_UNAVAILABLE";

export interface AmazonVerifyConnectionDto {
  connected: boolean;
  code: AmazonVerifyConnectionCode;
  verifiedAt: string;
  marketplaceCount: number;
}
