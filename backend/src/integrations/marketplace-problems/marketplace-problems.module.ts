import { Module } from '@nestjs/common';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MercadoLivreClaimsModule } from '../mercado-livre-claims/mercado-livre-claims.module';
import { MercadoLivreOAuthModule } from '../mercado-livre-oauth/mercado-livre-oauth.module';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import { MarketplaceProblemsSyncJobsPersistenceService } from './marketplace-problems-sync-jobs-persistence.service';
import { MarketplaceProblemsSyncTickService } from './marketplace-problems-sync-tick.service';
import { MarketplaceProblemsSyncWorkerService } from './marketplace-problems-sync-worker.service';
import { MercadoLivreProblemsSyncService } from './mercado-livre-problems-sync.service';
import { MercadoLivreProblemsSyncPreflight } from './mercado-livre-problems-sync-preflight.util';

/**
 * Módulo de "Problemas" (CP2-C): wiring real do cliente HTTP de Claims, do
 * pré-voo (conta + token OAuth), da persistência/cache do CP2-A, da
 * orquestração do CP2-B, do job durável e do worker.
 *
 * Deliberadamente NÃO importado pelo `AppModule` nesta etapa e sem
 * controller/endpoint: nenhum processamento automático em produção. Mesmo
 * quando importado, o worker só cria timer com
 * `PROBLEMS_SYNC_WORKER_ENABLED=true` (default `false`, sempre desligado em
 * `NODE_ENV=test`). `DataSource`/`ConfigService`/`EncryptionService` vêm dos
 * módulos globais da aplicação.
 */
@Module({
  imports: [
    MarketplaceAccountsModule,
    MercadoLivreOAuthModule,
    MercadoLivreClaimsModule,
  ],
  providers: [
    MarketplaceProblemReasonsCacheRepository,
    MarketplaceProblemsPersistenceService,
    MercadoLivreProblemsSyncPreflight,
    MercadoLivreProblemsSyncService,
    MarketplaceProblemsSyncJobsPersistenceService,
    MarketplaceProblemsSyncTickService,
    MarketplaceProblemsSyncWorkerService,
  ],
  exports: [
    MercadoLivreProblemsSyncService,
    MarketplaceProblemsSyncJobsPersistenceService,
  ],
})
export class MarketplaceProblemsModule {}
