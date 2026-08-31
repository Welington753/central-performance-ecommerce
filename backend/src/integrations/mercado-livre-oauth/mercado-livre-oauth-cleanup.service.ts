import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdvisoryLockService } from './advisory-lock.service';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

@Injectable()
export class MercadoLivreOAuthCleanupService {
  constructor(
    private readonly authorizationRequestsService: OAuthAuthorizationRequestsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly configService: ConfigService,
  ) {}

  async sweepExpiredPending(): Promise<number> {
    return this.authorizationRequestsService.sweepExpiredPending();
  }

  /**
   * design §6.3.b: nunca marca uma tentativa PROCESSING como abandonada sem
   * antes tentar o mesmo advisory lock da conta — se ocupado, um callback ou
   * refresh legítimo pode ainda estar em execução, então pula.
   */
  async recoverStaleProcessing(): Promise<number> {
    const staleAfterMs = this.configService.get<number>(
      'ML_OAUTH_PROCESSING_STALE_AFTER_MS',
      120000,
    );
    const cutoff = new Date(Date.now() - staleAfterMs);
    const candidates =
      await this.authorizationRequestsService.findStaleProcessingCandidates(
        cutoff,
      );

    let recovered = 0;
    for (const candidate of candidates) {
      const lock = await this.advisoryLockService.tryAcquire(
        candidate.marketplaceAccountId,
      );
      if (!lock) continue;

      try {
        const changed =
          await this.authorizationRequestsService.failIfStillStaleProcessing(
            candidate.id,
            cutoff,
          );
        if (changed) recovered += 1;
      } finally {
        await lock.release();
      }
    }

    return recovered;
  }
}
