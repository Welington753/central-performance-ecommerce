import { NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import type { MarketplaceConnector } from '../contracts/marketplace-connector.interface';
import { ConnectorRegistryService } from './connector-registry.service';

function buildFakeConnector(marketplace: Marketplace): MarketplaceConnector {
  return {
    marketplace,
    getCapabilities: () => ({
      implemented: false,
      supportsOrders: false,
      supportsAds: false,
      supportsFees: false,
    }),
    testConnection: () =>
      Promise.resolve({ ok: false, message: 'Ainda não implementado' }),
  };
}

describe('ConnectorRegistryService', () => {
  it('resolves the connector registered for a given marketplace', () => {
    const mercadoLivre = buildFakeConnector(Marketplace.MERCADO_LIVRE);
    const amazon = buildFakeConnector(Marketplace.AMAZON);
    const registry = new ConnectorRegistryService([mercadoLivre, amazon]);

    expect(registry.getConnector(Marketplace.MERCADO_LIVRE)).toBe(mercadoLivre);
    expect(registry.getConnector(Marketplace.AMAZON)).toBe(amazon);
  });

  it('throws NotFoundException for a marketplace without a registered connector', () => {
    const registry = new ConnectorRegistryService([
      buildFakeConnector(Marketplace.MERCADO_LIVRE),
    ]);

    expect(() => registry.getConnector(Marketplace.SHOPEE)).toThrow(
      NotFoundException,
    );
  });

  it('lists every registered connector', () => {
    const connectors = [
      buildFakeConnector(Marketplace.MERCADO_LIVRE),
      buildFakeConnector(Marketplace.AMAZON),
      buildFakeConnector(Marketplace.SHOPEE),
    ];
    const registry = new ConnectorRegistryService(connectors);

    expect(registry.listConnectors()).toHaveLength(3);
  });

  it('every stub connector reports implemented: false (nenhuma integração real nesta fase)', async () => {
    const connectors = [
      buildFakeConnector(Marketplace.MERCADO_LIVRE),
      buildFakeConnector(Marketplace.AMAZON),
      buildFakeConnector(Marketplace.SHOPEE),
    ];

    for (const connector of connectors) {
      expect(connector.getCapabilities().implemented).toBe(false);
      await expect(connector.testConnection({} as never)).resolves.toEqual({
        ok: false,
        message: 'Ainda não implementado',
      });
    }
  });
});
