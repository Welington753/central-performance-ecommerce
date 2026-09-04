import type { Marketplace } from '../../contracts/marketplace.enum';
import {
  MarketplaceAccountStatus,
  type MarketplaceAccount,
} from '../marketplace-account.entity';

/**
 * Sinal PÚBLICO e sanitizado para a interface decidir a ação principal a
 * mostrar — nunca o `failureCode` interno cru (design §7, "nunca exposto").
 * - `RECONNECT_REQUIRED`: autorização confirmada como inválida/revogada
 *   (`TOKEN_EXPIRED`), ou qualquer outro `ERROR` fora do vocabulário
 *   recuperável abaixo — precisa do fluxo OAuth completo de novo.
 * - `TEMPORARY_RETRY`: falha recuperável de renovação (correção de
 *   resiliência OAuth, inclui o legado `REFRESH_RESULT_UNKNOWN`) — a
 *   interface oferece "Tentar agora" (`POST .../recover`), nunca
 *   "Reconectar" como ação principal.
 * - `CONFIGURATION_ERROR`: client_id/client_secret da aplicação inválidos —
 *   reconectar ESTA conta nunca resolve.
 * - `null`: nada a recuperar (conta `CONNECTED`/`DISCONNECTED`).
 */
export type MarketplaceAccountRecoveryHint =
  'RECONNECT_REQUIRED' | 'TEMPORARY_RETRY' | 'CONFIGURATION_ERROR' | null;

const TEMPORARY_RETRY_FAILURE_CODES: ReadonlySet<string> = new Set([
  'REFRESH_RESULT_UNKNOWN',
  'REFRESH_TEMPORARY_FAILURE',
  'REFRESH_OUTCOME_UNKNOWN',
]);

function computeRecoveryHint(
  account: MarketplaceAccount,
): MarketplaceAccountRecoveryHint {
  if (account.status === MarketplaceAccountStatus.TOKEN_EXPIRED) {
    return 'RECONNECT_REQUIRED';
  }
  if (account.status !== MarketplaceAccountStatus.ERROR) {
    return null;
  }
  if (account.failureCode === 'ML_APP_CONFIGURATION_ERROR') {
    return 'CONFIGURATION_ERROR';
  }
  if (
    account.failureCode &&
    TEMPORARY_RETRY_FAILURE_CODES.has(account.failureCode)
  ) {
    return 'TEMPORARY_RETRY';
  }
  // Qualquer outro ERROR (ex.: CREDENTIAL_DECRYPTION_FAILED, ou qualquer
  // causa de conta Amazon) — comportamento inalterado: pede reconexão.
  return 'RECONNECT_REQUIRED';
}

/**
 * Nunca inclui `encrypted*`, `connectedByUserId`, `tokenVersion`,
 * `failureCode` ou `errorSummary` — os dois primeiros são detalhes internos
 * de credencial/concorrência, e os dois últimos são "interno/auditoria"
 * por definição do design (§7): o frontend nunca vê o vocabulário fechado
 * de `failureCode` nem o texto de `errorSummary` — ele deriva sua própria
 * mensagem genérica e fixa a partir de `status` (público por natureza: é
 * exatamente o mesmo enum `DISCONNECTED/CONNECTED/TOKEN_EXPIRED/ERROR` que
 * o design já trata como estado observável da conta).
 */
export interface MarketplaceAccountResponseDto {
  id: string;
  marketplace: Marketplace;
  externalSellerId: string | null;
  nickname: string | null;
  status: MarketplaceAccountStatus;
  recoveryHint: MarketplaceAccountRecoveryHint;
  tokenExpiresAt: string | null;
  lastSuccessfulSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toMarketplaceAccountResponse(
  account: MarketplaceAccount,
): MarketplaceAccountResponseDto {
  return {
    id: account.id,
    marketplace: account.marketplace,
    externalSellerId: account.externalSellerId,
    nickname: account.nickname,
    status: account.status,
    recoveryHint: computeRecoveryHint(account),
    tokenExpiresAt: account.tokenExpiresAt
      ? account.tokenExpiresAt.toISOString()
      : null,
    lastSuccessfulSyncAt: account.lastSuccessfulSyncAt
      ? account.lastSuccessfulSyncAt.toISOString()
      : null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
