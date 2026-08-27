import type { Marketplace } from '../../contracts/marketplace.enum';

/**
 * Entrada para pré-cadastrar uma conta de marketplace (status inicial
 * DISCONNECTED, sem nenhuma credencial). Não há endpoint HTTP público para
 * esta operação nesta fase — o fluxo de conexão real (OAuth) fica para uma
 * fase futura. Este tipo existe para o serviço/testes de unicidade
 * condicional (marketplace, externalSellerId).
 */
export interface CreateMarketplaceAccountInput {
  marketplace: Marketplace;
  externalSellerId?: string | null;
  nickname?: string | null;
}
