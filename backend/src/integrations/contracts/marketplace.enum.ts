/**
 * Marketplaces suportados (ou planejados) pela Central de Performance.
 *
 * Importante: no Postgres, qualquer coluna que armazene este valor deve ser
 * `varchar` (NUNCA `enum` nativo do Postgres). Isso garante que adicionar um
 * novo marketplace no futuro (ex.: um quarto canal) nunca exija uma migration
 * de schema — apenas um novo valor de enum em código e um novo connector.
 */
export enum Marketplace {
  MERCADO_LIVRE = 'MERCADO_LIVRE',
  AMAZON = 'AMAZON',
  SHOPEE = 'SHOPEE',
}
