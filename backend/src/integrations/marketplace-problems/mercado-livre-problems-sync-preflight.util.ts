import { ConflictException, Injectable } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { MercadoLivreOAuthService } from '../mercado-livre-oauth/mercado-livre-oauth.service';

/**
 * Vocabulário fechado de falhas de PRÉ-VOO do CP2-B (conta/token) — sempre
 * LANÇADO, nunca aparece dentro de `ProblemsSyncResult` (esse carrega só
 * falhas de EXECUÇÃO). Ver `mercado-livre-problems-sync.service.ts`.
 */
export class ProblemsSyncError extends Error {
  constructor(
    public readonly code:
      | 'ACCOUNT_NOT_CONNECTED'
      | 'ACCOUNT_BUSY'
      | 'TOKEN_EXPIRED'
      | 'TOKEN_REFRESH_PENDING'
      | 'ML_APP_CONFIGURATION_ERROR'
      | 'CREDENTIAL_DECRYPTION_FAILED',
  ) {
    super(code);
  }
}

/**
 * Tabela EXAUSTIVA das 8 mensagens de `ConflictException` que
 * `ensureValidAccessToken` pode lançar — levantada lendo INTEIRAMENTE
 * `mercado-livre-oauth.service.ts` (`assertEligibleForToken`,
 * `returnCurrentTokenOrThrow`, `decryptOrMarkError`). `OAUTH_CONFLICT_TO_
 * SYNC_ERROR_CODE` de `mercado-livre-orders-sync.service.ts` NÃO é
 * exportada (sem `export` na declaração) — esta é uma tabela própria,
 * nunca um import de algo inexistente publicamente. O fallback fica FORA
 * deste `Record` tipado (linha abaixo, via `??`) para que uma 9ª mensagem
 * futura no OAuth service não quebre a compilação nem trave a execução.
 */
const OAUTH_ERROR_TO_PROBLEMS_SYNC_CODE: Record<
  string,
  ProblemsSyncError['code']
> = {
  ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN: 'ACCOUNT_NOT_CONNECTED',
  ACCOUNT_BUSY: 'ACCOUNT_BUSY',
  REFRESH_TOKEN_REJECTED: 'TOKEN_EXPIRED',
  ML_APP_CONFIGURATION_ERROR: 'ML_APP_CONFIGURATION_ERROR',
  REFRESH_TEMPORARY_FAILURE: 'TOKEN_REFRESH_PENDING',
  REFRESH_OUTCOME_UNKNOWN: 'TOKEN_REFRESH_PENDING',
  REFRESH_RESULT_NOT_COMMITTED: 'TOKEN_REFRESH_PENDING',
  CREDENTIAL_DECRYPTION_FAILED: 'CREDENTIAL_DECRYPTION_FAILED',
};

const OAUTH_ERROR_FALLBACK_CODE: ProblemsSyncError['code'] =
  'TOKEN_REFRESH_PENDING';

export interface ResolvedProblemsSyncAccount {
  accessToken: string;
  externalSellerId: string;
}

/**
 * Pré-voo compartilhado pelos 3 métodos públicos de
 * `MercadoLivreProblemsSyncService`: resolve a conta, confirma elegibilidade
 * e obtém um `accessToken` válido — sempre LANÇA `ProblemsSyncError` em
 * qualquer falha (nunca retorna um resultado parcial).
 */
@Injectable()
export class MercadoLivreProblemsSyncPreflight {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly oauthService: MercadoLivreOAuthService,
  ) {}

  async resolveAccountAndToken(
    accountId: string,
  ): Promise<ResolvedProblemsSyncAccount> {
    const account =
      await this.marketplaceAccountsService.findByIdOrFail(accountId);

    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE ||
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.externalSellerId
    ) {
      throw new ProblemsSyncError('ACCOUNT_NOT_CONNECTED');
    }

    try {
      const accessToken =
        await this.oauthService.ensureValidAccessToken(accountId);
      return { accessToken, externalSellerId: account.externalSellerId };
    } catch (error) {
      if (error instanceof ConflictException) {
        const code =
          OAUTH_ERROR_TO_PROBLEMS_SYNC_CODE[error.message] ??
          OAUTH_ERROR_FALLBACK_CODE;
        throw new ProblemsSyncError(code);
      }
      throw error;
    }
  }
}
