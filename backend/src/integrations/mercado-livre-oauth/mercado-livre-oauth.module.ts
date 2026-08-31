import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { AdvisoryLockService } from './advisory-lock.service';
import { ML_FETCH, MercadoLivreHttpClient } from './mercado-livre-http.client';
import { MercadoLivreOAuthCleanupService } from './mercado-livre-oauth-cleanup.service';
import { MercadoLivreOAuthController } from './mercado-livre-oauth.controller';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';
import { MercadoLivreTokenRenewalJob } from './mercado-livre-token-renewal.job';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

/**
 * Módulo específico do Mercado Livre — fora dos diretórios varridos por
 * `integrations/architecture.spec.ts` (design §1), assim como
 * `integrations/connectors`. `EncryptionService` vem do `CommonModule`
 * (`@Global()`), não precisa ser importado explicitamente aqui. Sem
 * `TypeOrmModule.forFeature`: `OAuthAuthorizationRequestsService` (Task 12)
 * nunca injeta um `Repository<OAuthAuthorizationRequest>` — tudo é SQL cru
 * via `DataSource`.
 */
@Module({
  imports: [MarketplaceAccountsModule, AuthModule],
  controllers: [MercadoLivreOAuthController],
  providers: [
    OAuthAuthorizationRequestsService,
    AdvisoryLockService,
    { provide: ML_FETCH, useValue: fetch },
    MercadoLivreHttpClient,
    MercadoLivreOAuthService,
    MercadoLivreOAuthCleanupService,
    MercadoLivreTokenRenewalJob,
  ],
  exports: [MercadoLivreOAuthService],
})
export class MercadoLivreOAuthModule {}
