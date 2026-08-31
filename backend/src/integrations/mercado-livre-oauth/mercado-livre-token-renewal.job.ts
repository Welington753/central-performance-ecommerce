import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { MercadoLivreOAuthCleanupService } from './mercado-livre-oauth-cleanup.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

const RENEWAL_BATCH_SIZE = 25;

/**
 * Job agendado (design §3/§6.4): a cada 5 min, varre PENDING/PROCESSING
 * vencidos e renova contas CONNECTED perto da expiração. `running` evita
 * sobreposição DENTRO desta instância — a coordenação entre múltiplas
 * instâncias é feita pelo AdvisoryLockService, não por esta flag.
 */
@Injectable()
export class MercadoLivreTokenRenewalJob {
  private readonly logger = new Logger(MercadoLivreTokenRenewalJob.name);
  private running = false;

  constructor(
    private readonly service: MercadoLivreOAuthService,
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly cleanupService: MercadoLivreOAuthCleanupService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanupService.sweepExpiredPending();
      await this.cleanupService.recoverStaleProcessing();
      await this.renewDueAccounts();
    } finally {
      this.running = false;
    }
  }

  private async renewDueAccounts(): Promise<void> {
    const leewayMs = this.configService.get<number>(
      'ML_TOKEN_REFRESH_LEEWAY_MS',
      900000,
    );
    const dueBefore = new Date(Date.now() + leewayMs);
    const accounts =
      await this.marketplaceAccountsService.findConnectedDueForRenewal(
        dueBefore,
        RENEWAL_BATCH_SIZE,
      );

    for (const account of accounts) {
      try {
        await this.service.ensureValidAccessToken(account.id);
      } catch {
        this.logger.warn(
          `mercado_livre_renewal_failed accountId=${account.id}`,
        );
      }
    }
  }
}
