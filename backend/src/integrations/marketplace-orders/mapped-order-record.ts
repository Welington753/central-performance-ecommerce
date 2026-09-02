/**
 * Registro de pedido pronto para persistência — já sem nenhum campo de
 * comprador, mensagem, endereço ou payload bruto. Genérico entre
 * marketplaces: cada mapper específico (`mercado-livre-order.mapper.ts`,
 * `amazon-order.mapper.ts`) produz este mesmo formato a partir da resposta
 * bruta do respectivo provedor. Os três campos opcionais só existem hoje
 * para a Amazon — o mapper do Mercado Livre nunca os define, então ficam
 * `null` no banco (coluna nullable, ver `marketplace-order.entity.ts`).
 */
export interface MappedOrderRecord {
  marketplaceAccountId: string;
  externalOrderId: string;
  status: string;
  currencyId: string;
  totalAmount: string;
  packId: string | null;
  dateCreated: Date;
  dateClosed: Date | null;
  marketplaceLastUpdated: Date | null;
  sourceStatus?: string | null;
  fulfillmentChannel?: string | null;
  externalMarketplaceId?: string | null;
  items: MappedOrderItemRecord[];
}

export interface MappedOrderItemRecord {
  externalItemId: string;
  variationId: string | null;
  sellerSku: string | null;
  title: string;
  quantity: number;
  unitPrice: string;
  currencyId: string;
}
