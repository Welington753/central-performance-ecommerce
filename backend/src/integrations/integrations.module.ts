import { Module } from '@nestjs/common';
import { ConnectorsModule } from './connectors/connectors.module';
import { MarketplaceAccountsModule } from './marketplace-accounts/marketplace-accounts.module';
import { MercadoLivreOAuthModule } from './mercado-livre-oauth/mercado-livre-oauth.module';

/**
 * Módulo agregador de integrações com marketplaces.
 *
 * Propositalmente não referencia nenhuma classe concreta de connector —
 * apenas reexporta os módulos que compõem a área de integrações.
 */
@Module({
  imports: [ConnectorsModule, MarketplaceAccountsModule, MercadoLivreOAuthModule],
  exports: [ConnectorsModule, MarketplaceAccountsModule, MercadoLivreOAuthModule],
})
export class IntegrationsModule {}
