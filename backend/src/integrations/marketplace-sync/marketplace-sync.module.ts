import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AmazonOrdersModule } from '../amazon-orders/amazon-orders.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { MercadoLivreOrdersModule } from '../mercado-livre-orders/mercado-livre-orders.module';
import { ShopeeOrdersModule } from '../shopee-orders/shopee-orders.module';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { SyncModule } from '../../sync/sync.module';
import { MarketplaceAutoSyncService } from './marketplace-auto-sync.service';
import { BackfillJobsPersistenceService } from './backfill-jobs-persistence.service';
import { MarketplaceBackfillController } from './marketplace-backfill.controller';
import { MarketplaceBackfillService } from './marketplace-backfill.service';
import { MarketplaceBackfillWorkerService } from './marketplace-backfill-worker.service';

/**
 * Módulo genérico de orquestração de sincronização multi-marketplace (Fase
 * 4, "Sincronização prática de múltiplas contas e histórico completo").
 * Importa `MercadoLivreOrdersModule`/`AmazonOrdersModule`/`ShopeeOrdersModule`
 * só para reaproveitar seus `*SyncService` (`MercadoLivreOrdersSyncService`/
 * `AmazonOrdersSyncService`/`ShopeeOrdersSyncService`) já exportados —
 * nenhuma dependência de negócio nova entre os marketplaces, nenhuma cópia
 * de fetch/persistência.
 */
@Module({
  imports: [
    MarketplaceAccountsModule,
    MarketplaceOrdersModule,
    MercadoLivreOrdersModule,
    AmazonOrdersModule,
    ShopeeOrdersModule,
    AuthModule,
    SyncModule,
  ],
  controllers: [MarketplaceBackfillController],
  providers: [
    MarketplaceBackfillService,
    BackfillJobsPersistenceService,
    MarketplaceBackfillWorkerService,
    AdvisoryLockService,
    MarketplaceAutoSyncService,
  ],
})
export class MarketplaceSyncModule {}
