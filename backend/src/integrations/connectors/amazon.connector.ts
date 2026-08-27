import { Injectable } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import type {
  ConnectionTestResult,
  MarketplaceConnector,
  MarketplaceConnectorCapabilities,
} from '../contracts/marketplace-connector.interface';
import type { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';

/**
 * Stub do connector da Amazon.
 *
 * PROIBIDO nesta fase: qualquer chamada real à Amazon Selling Partner API.
 * Existe apenas para provar que o núcleo do sistema é agnóstico de
 * marketplace e pronto para múltiplos canais.
 */
@Injectable()
export class AmazonConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.AMAZON;

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
