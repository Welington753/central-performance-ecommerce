import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceAnalyticsController } from './marketplace-analytics.controller';
import { MarketplaceAnalyticsService } from './marketplace-analytics.service';
import { MonthlyRevenueGoalProgressService } from './monthly-revenue-goal-progress.service';
import { MonthlyRevenueGoalsController } from './monthly-revenue-goals.controller';
import { MonthlyRevenueGoalsService } from './monthly-revenue-goals.service';

/**
 * Módulo do Checkpoint 3 (fundação multi-marketplace). Lê exclusivamente os
 * dados já normalizados e persistidos por
 * `MercadoLivreOrdersPersistenceService` (`marketplace_orders`,
 * `marketplace_order_items`, `sync_runs`) e por `MarketplaceAccountsService`
 * (`marketplace_accounts`) — nunca chama a rede, nunca escreve nessas
 * tabelas. Desde o Checkpoint BI-1 ("Metas e Ritmo") também expõe
 * `monthly_revenue_goals` (a única escrita deste módulo — via
 * `MonthlyRevenueGoalsService`, sempre atrás de `AdminGuard`).
 */
@Module({
  imports: [MarketplaceAccountsModule, AuthModule],
  controllers: [MarketplaceAnalyticsController, MonthlyRevenueGoalsController],
  providers: [
    MarketplaceAnalyticsService,
    MonthlyRevenueGoalsService,
    MonthlyRevenueGoalProgressService,
  ],
})
export class MarketplaceAnalyticsModule {}
