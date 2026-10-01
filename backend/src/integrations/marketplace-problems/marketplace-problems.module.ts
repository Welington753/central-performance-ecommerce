import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MercadoLivreClaimsModule } from '../mercado-livre-claims/mercado-livre-claims.module';
import { MercadoLivreOAuthModule } from '../mercado-livre-oauth/mercado-livre-oauth.module';
import { MarketplaceProblemClaimQuarantineRepository } from './marketplace-problem-claim-quarantine.repository';
import { MarketplaceProblemReasonsCacheRepository } from './marketplace-problem-reasons-cache.repository';
import { MarketplaceProblemsController } from './marketplace-problems.controller';
import { MarketplaceProblemsHistoricalBackfillService } from './marketplace-problems-historical-backfill.service';
import { MarketplaceProblemsListQueryService } from './marketplace-problems-list-query.service';
import { MarketplaceProblemsMonthlyQueryService } from './marketplace-problems-monthly-query.service';
import { MarketplaceProblemsPersistenceService } from './marketplace-problems-persistence.service';
import { MarketplaceProblemsResponsibilityService } from './marketplace-problems-responsibility.service';
import { MarketplaceProblemsSummaryQueryService } from './marketplace-problems-summary-query.service';
import { MarketplaceProblemsSyncManagementService } from './marketplace-problems-sync-management.service';
import { MarketplaceProblemsSyncJobsPersistenceService } from './marketplace-problems-sync-jobs-persistence.service';
import { MarketplaceProblemsSyncTickService } from './marketplace-problems-sync-tick.service';
import { MarketplaceProblemsSyncWorkerService } from './marketplace-problems-sync-worker.service';
import { MercadoLivreProblemsHistoricalSyncService } from './mercado-livre-problems-historical-sync.service';
import { MercadoLivreProblemsSyncService } from './mercado-livre-problems-sync.service';
import { MercadoLivreProblemsSyncPreflight } from './mercado-livre-problems-sync-preflight.util';

/**
 * Módulo de "Problemas": consulta/gestão (controller + query services) e o
 * pipeline de sincronização (cliente HTTP de Claims, pré-voo, CP2-A/B, job
 * durável do CP2-C e worker). Importado pelo `AppModule`, mas seguro: o
 * worker só cria timer com `PROBLEMS_SYNC_WORKER_ENABLED=true` (default
 * `false`, sempre desligado em `NODE_ENV=test`), nenhuma chamada externa
 * acontece ao importar, e sem jobs criados (`start` explícito por conta)
 * nada processa. `DataSource`/`ConfigService`/`EncryptionService` vêm dos
 * módulos globais da aplicação.
 */
@Module({
  imports: [
    AuthModule,
    MarketplaceAccountsModule,
    MercadoLivreOAuthModule,
    MercadoLivreClaimsModule,
  ],
  controllers: [MarketplaceProblemsController],
  providers: [
    MarketplaceProblemsListQueryService,
    MarketplaceProblemsSummaryQueryService,
    MarketplaceProblemsMonthlyQueryService,
    MarketplaceProblemsResponsibilityService,
    MarketplaceProblemsSyncManagementService,
    MarketplaceProblemReasonsCacheRepository,
    MarketplaceProblemClaimQuarantineRepository,
    MarketplaceProblemsPersistenceService,
    MercadoLivreProblemsSyncPreflight,
    MercadoLivreProblemsSyncService,
    MercadoLivreProblemsHistoricalSyncService,
    MarketplaceProblemsHistoricalBackfillService,
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
