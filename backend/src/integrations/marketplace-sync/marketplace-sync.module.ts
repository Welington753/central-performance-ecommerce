import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AmazonOrdersModule } from '../amazon-orders/amazon-orders.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { MercadoLivreOrdersModule } from '../mercado-livre-orders/mercado-livre-orders.module';
import { MarketplaceBackfillController } from './marketplace-backfill.controller';
import { MarketplaceBackfillService } from './marketplace-backfill.service';

/**
 * Módulo genérico de orquestração de sincronização multi-marketplace (Fase
 * 4, "Sincronização prática de múltiplas contas e histórico completo").
 * Importa `MercadoLivreOrdersModule`/`AmazonOrdersModule` só para reaproveitar
 * seus `*SyncService` já exportados — nenhuma dependência de negócio nova
 * entre os dois marketplaces, nenhuma cópia de fetch/persistência.
 */
@Module({
  imports: [
    MarketplaceAccountsModule,
    MarketplaceOrdersModule,
    MercadoLivreOrdersModule,
    AmazonOrdersModule,
    AuthModule,
  ],
  controllers: [MarketplaceBackfillController],
  providers: [MarketplaceBackfillService],
})
export class MarketplaceSyncModule {}
