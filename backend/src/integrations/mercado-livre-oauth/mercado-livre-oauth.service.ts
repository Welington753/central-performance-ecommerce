import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from './advisory-lock.service';
import { buildAuthorizationUrl } from './build-authorization-url';
import { MercadoLivreHttpClient } from './mercado-livre-http.client';
import {
  OAuthAuthorizationRequestsService,
  OAuthConnectionInProgressError,
} from './oauth-authorization-requests.service';

const CONNECTABLE_STATUSES: MarketplaceAccountStatus[] = [
  MarketplaceAccountStatus.DISCONNECTED,
  MarketplaceAccountStatus.TOKEN_EXPIRED,
  MarketplaceAccountStatus.ERROR,
  MarketplaceAccountStatus.CONNECTED,
];

@Injectable()
export class MercadoLivreOAuthService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly authorizationRequestsService: OAuthAuthorizationRequestsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly httpClient: MercadoLivreHttpClient,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
    // Não usado por `startConnection` — só é lido por `handleCallback`
    // (Task 19), que precisa abrir uma transação compartilhada entre o CAS
    // da conta e a finalização da tentativa. Introduzido já aqui, e não na
    // Task 19, para que a assinatura do construtor nunca mude no meio do
    // plano — todo call site (Tasks 16, 19, 20, 23) usa a mesma ordem de 7
    // argumentos desde o início.
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Autorização interna nesta fase (design §6.1): sem RBAC/ownership na Fase
   * 1, qualquer usuário interno autenticado e ativo pode conectar/reconectar
   * qualquer conta — `initiatedByUserId` só serve para auditoria.
   */
  async startConnection(input: {
    marketplaceAccountId: string;
    initiatedByUserId: string;
  }): Promise<{ authorizationUrl: string }> {
    const account = await this.marketplaceAccountsService.findByIdOrFail(
      input.marketplaceAccountId,
    );

    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE ||
      !CONNECTABLE_STATUSES.includes(account.status)
    ) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }

    try {
      const pending = await this.authorizationRequestsService.createPending({
        marketplaceAccountId: account.id,
        initiatedByUserId: input.initiatedByUserId,
        marketplace: Marketplace.MERCADO_LIVRE,
      });

      return {
        authorizationUrl: buildAuthorizationUrl({
          clientId: this.configService.getOrThrow<string>('ML_CLIENT_ID'),
          redirectUri: this.configService.getOrThrow<string>('ML_REDIRECT_URI'),
          state: pending.state,
          codeChallenge: pending.codeChallenge,
        }),
      };
    } catch (error) {
      if (error instanceof OAuthConnectionInProgressError) {
        throw new ConflictException('OAUTH_CONNECTION_IN_PROGRESS');
      }
      throw error;
    }
  }
}
