import { Module } from '@nestjs/common';
import { ConnectorsModule } from './connectors/connectors.module';
import { MarketplaceAccountsModule } from './marketplace-accounts/marketplace-accounts.module';
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
  ],
  exports: [
    ConnectorsModule,
    MarketplaceAccountsModule,
    MercadoLivreOAuthModule,
    MercadoLivreOrdersModule,
  ],
})
export class IntegrationsModule {}
