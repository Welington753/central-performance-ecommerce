import type { Marketplace } from '../../contracts/marketplace.enum';
import type {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-account.entity';

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
