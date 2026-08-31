import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redactSensitiveData } from '../../common/logging/redact.util';
import { AdvisoryLockService } from './advisory-lock.service';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

@Injectable()
export class MercadoLivreOAuthCleanupService {
  private readonly logger = new Logger(MercadoLivreOAuthCleanupService.name);

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
   *
   * Cada candidata é isolada em seu próprio try/catch: `tryAcquire`/
   * `failIfStillStaleProcessing`/`lock.release()` falhando para UMA conta
   * (ex.: conexão instável só com aquele advisory lock) não pode interromper
   * o processamento das demais candidatas do lote — o erro é logado (nunca o
   * corpo bruto de exceções de rede, só a mensagem já seguramente textual) e
   * o loop continua.
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
      try {
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
      } catch (error) {
        // `error.message` NUNCA é interpolado bruto — passa sempre por
        // `redactSensitiveData`, o mesmo sanitizador já usado em
        // `handleCallback` (Task 19). Os únicos valores fora do sanitizador
        // são identificadores seguros (UUID da tentativa e da conta), nunca
        // segredo/token/corpo bruto.
        this.logger.error(
          'mercado_livre_oauth_recover_stale_processing_failed',
          {
            authorizationRequestId: candidate.id,
            marketplaceAccountId: candidate.marketplaceAccountId,
            message: redactSensitiveData(
              error instanceof Error ? error.message : 'erro desconhecido',
            ),
          },
        );
      }
    }

    return recovered;
  }
}
