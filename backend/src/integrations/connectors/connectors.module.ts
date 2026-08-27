import { Module } from '@nestjs/common';
import { MARKETPLACE_CONNECTORS } from '../contracts/connector-registry.token';
import type { MarketplaceConnector } from '../contracts/marketplace-connector.interface';
import { AmazonConnector } from './amazon.connector';
import { ConnectorRegistryService } from './connector-registry.service';
import { MercadoLivreConnector } from './mercado-livre.connector';
import { ShopeeConnector } from './shopee.connector';

/**
 * Único módulo do sistema que conhece as classes concretas dos connectors.
 *
 * `auth`, `users`, `sync`, `common` e `marketplace-accounts` nunca importam
 * `MercadoLivreConnector`, `AmazonConnector` ou `ShopeeConnector` diretamente
 * — apenas `ConnectorRegistryService` (via `IntegrationsModule`), que expõe
 * os connectors somente através da interface `MarketplaceConnector`.
 * Isso é verificado automaticamente por `integrations/architecture.spec.ts`.
 */
@Module({
  providers: [
    MercadoLivreConnector,
    AmazonConnector,
    ShopeeConnector,
    {
      provide: MARKETPLACE_CONNECTORS,
      useFactory: (
        mercadoLivre: MercadoLivreConnector,
        amazon: AmazonConnector,
        shopee: ShopeeConnector,
      ): MarketplaceConnector[] => [mercadoLivre, amazon, shopee],
      inject: [MercadoLivreConnector, AmazonConnector, ShopeeConnector],
    },
    ConnectorRegistryService,
  ],
  exports: [ConnectorRegistryService],
})
export class ConnectorsModule {}
