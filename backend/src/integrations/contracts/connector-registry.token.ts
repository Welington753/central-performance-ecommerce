/**
 * Token de injeção de dependência genérico usado para fornecer a lista de
 * `MarketplaceConnector` disponíveis ao `ConnectorRegistryService`.
 *
 * Nenhum módulo fora de `integrations/connectors` deve conhecer as classes
 * concretas dos connectors — todo o resto do sistema depende apenas deste
 * token e da interface `MarketplaceConnector`.
 */
export const MARKETPLACE_CONNECTORS = Symbol('MARKETPLACE_CONNECTORS');
