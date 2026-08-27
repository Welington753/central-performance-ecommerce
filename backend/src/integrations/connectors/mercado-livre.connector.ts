import { Injectable } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import type {
  ConnectionTestResult,
  MarketplaceConnector,
  MarketplaceConnectorCapabilities,
} from '../contracts/marketplace-connector.interface';
import type { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';

/**
 * Stub do connector do Mercado Livre.
 *
 * PROIBIDO nesta fase: OAuth real, chamadas HTTP à API do Mercado Livre,
 * sincronização de vendas/Product Ads. Este connector existe apenas para
 * provar que a arquitetura multi-marketplace está pronta para receber a
 * implementação real em uma fase futura.
 */
@Injectable()
export class MercadoLivreConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.MERCADO_LIVRE;

  getCapabilities(): MarketplaceConnectorCapabilities {
    return {
      implemented: false,
      supportsOrders: false,
      supportsAds: false,
      supportsFees: false,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async testConnection(
    _account: MarketplaceAccount,
  ): Promise<ConnectionTestResult> {
    return { ok: false, message: 'Ainda não implementado' };
  }
}
