import type { MarketplaceAccountResponseDto } from '../../marketplace-accounts/dto/marketplace-account-response.dto';

/**
 * Resposta de `GET /integrations/amazon/setup-status` (Checkpoint 4-C).
 * Allowlist fechada — nunca inclui Application ID completo, LWA Client
 * ID/Secret, refresh/access token, valor cifrado, header ou stack trace.
 * `missingConfigurationKeys` traz só os NOMES das variáveis de ambiente
 * ausentes, nunca seus valores (que nem chegam a existir, nesse caso).
 * `accounts` reaproveita `MarketplaceAccountResponseDto` — já sanitizado
 * pelo Checkpoint 2 (nunca `encrypted*`, `tokenVersion`, `failureCode` ou
 * `errorSummary`).
 */
export interface AmazonSetupStatusResponseDto {
  applicationConfigured: boolean;
  missingConfigurationKeys: string[];
  hasAccount: boolean;
  accounts: MarketplaceAccountResponseDto[];
  canProvision: boolean;
  canVerify: boolean;
  canSynchronize: boolean;
}
