import type { Marketplace } from './marketplace.enum';
import type { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';

/**
 * Capacidades que um connector de marketplace declara suportar.
 *
 * Nesta fase (Fundação), todos os connectors concretos devem retornar
 * `implemented: false` — nenhuma chamada real a API de marketplace é feita.
 */
export interface MarketplaceConnectorCapabilities {
  implemented: boolean;
  supportsOrders: boolean;
  supportsAds: boolean;
  supportsFees: boolean;
}

/**
 * Resultado de um teste de conexão com a conta de um marketplace.
 */
export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/**
 * Contrato mínimo e genérico que qualquer marketplace (Mercado Livre, Amazon,
 * Shopee, ou futuros canais) deve implementar.
 *
 * Propositalmente minimalista nesta fase: não há métodos de busca de vendas,
 * taxas ou anúncios reais — apenas o suficiente para o núcleo da aplicação
 * (auth, sync, marketplace-accounts) conseguir descobrir capacidades e
 * validar uma conexão sem conhecer detalhes de nenhum marketplace específico.
 */
export interface MarketplaceConnector {
  readonly marketplace: Marketplace;

  getCapabilities(): MarketplaceConnectorCapabilities;

  testConnection(account: MarketplaceAccount): Promise<ConnectionTestResult>;
}
