import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import type { MarketplaceConnector } from '../contracts/marketplace-connector.interface';
import { MARKETPLACE_CONNECTORS } from '../contracts/connector-registry.token';

/**
 * Resolve o `MarketplaceConnector` correto a partir do enum `Marketplace`.
 *
 * Este é o único ponto do módulo `integrations` cuja responsabilidade é
 * "conhecer" todos os connectors registrados — e mesmo assim, apenas através
 * da interface genérica `MarketplaceConnector`, nunca das classes concretas
 * (que chegam via injeção pelo token `MARKETPLACE_CONNECTORS`).
 */
@Injectable()
export class ConnectorRegistryService {
  private readonly connectorsByMarketplace: ReadonlyMap<
    Marketplace,
    MarketplaceConnector
  >;

  constructor(
    @Inject(MARKETPLACE_CONNECTORS)
    connectors: MarketplaceConnector[],
  ) {
    this.connectorsByMarketplace = new Map(
      connectors.map((connector) => [connector.marketplace, connector]),
    );
  }

  getConnector(marketplace: Marketplace): MarketplaceConnector {
    const connector = this.connectorsByMarketplace.get(marketplace);
    if (!connector) {
      throw new NotFoundException(
        `Nenhum connector registrado para o marketplace "${marketplace}".`,
      );
    }
    return connector;
  }

  listConnectors(): MarketplaceConnector[] {
    return Array.from(this.connectorsByMarketplace.values());
  }
}
