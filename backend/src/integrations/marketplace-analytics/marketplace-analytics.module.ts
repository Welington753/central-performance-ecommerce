import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceAnalyticsController } from './marketplace-analytics.controller';
import { MarketplaceAnalyticsService } from './marketplace-analytics.service';

/**
 * Módulo do Checkpoint 3 (fundação multi-marketplace). Lê exclusivamente os
 * dados já normalizados e persistidos por
 * `MercadoLivreOrdersPersistenceService` (`marketplace_orders`,
 * `marketplace_order_items`, `sync_runs`) e por `MarketplaceAccountsService`
 * (`marketplace_accounts`) — nunca chama a rede, nunca escreve nessas
 * tabelas.
 */
@Module({
  imports: [MarketplaceAccountsModule, AuthModule],
  controllers: [MarketplaceAnalyticsController],
  providers: [MarketplaceAnalyticsService],
})
export class MarketplaceAnalyticsModule {}
