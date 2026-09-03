import { Module } from '@nestjs/common';
import { AmazonConnectionModule } from './amazon-connection/amazon-connection.module';
import { AmazonOrdersModule } from './amazon-orders/amazon-orders.module';
import { AmazonModule } from './amazon-sp-api/amazon.module';
import { ConnectorsModule } from './connectors/connectors.module';
import { MarketplaceAccountsModule } from './marketplace-accounts/marketplace-accounts.module';
import { MarketplaceAnalyticsModule } from './marketplace-analytics/marketplace-analytics.module';
import { MarketplaceSyncModule } from './marketplace-sync/marketplace-sync.module';
import { MercadoLivreOAuthModule } from './mercado-livre-oauth/mercado-livre-oauth.module';
import { MercadoLivreOrdersModule } from './mercado-livre-orders/mercado-livre-orders.module';

/**
 * Módulo agregador de integrações com marketplaces.
 *
 * Propositalmente não referencia nenhuma classe concreta de connector —
 * apenas reexporta os módulos que compõem a área de integrações.
 */
@Module({
  imports: [
    ConnectorsModule,
    MarketplaceAccountsModule,
    MercadoLivreOAuthModule,
    MercadoLivreOrdersModule,
    MarketplaceAnalyticsModule,
    AmazonModule,
    AmazonOrdersModule,
    AmazonConnectionModule,
    MarketplaceSyncModule,
  ],
  exports: [
    ConnectorsModule,
    MarketplaceAccountsModule,
    MercadoLivreOAuthModule,
    MercadoLivreOrdersModule,
    MarketplaceAnalyticsModule,
    AmazonModule,
    AmazonOrdersModule,
    AmazonConnectionModule,
    MarketplaceSyncModule,
  ],
})
export class IntegrationsModule {}
