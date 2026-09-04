import type { LogisticsClassification } from './logistics-classification';

/**
 * Registro de pedido pronto para persistência — já sem nenhum campo de
 * comprador, mensagem, endereço ou payload bruto. Genérico entre
 * marketplaces: cada mapper específico (`mercado-livre-order.mapper.ts`,
 * `amazon-order.mapper.ts`) produz este mesmo formato a partir da resposta
 * bruta do respectivo provedor. Os três campos opcionais de Amazon só
 * existem hoje para ela — o mapper do Mercado Livre nunca os define, então
 * ficam `null` no banco (coluna nullable, ver `marketplace-order.entity.ts`).
 * `logisticsClassification`/`logisticsType` (Fase 4, "Full") são preenchidos
 * fora do mapper puro — o serviço de sincronização do Mercado Livre resolve
 * a classificação (consulta assíncrona ao envio) e a atribui ao registro já
 * mapeado antes de persistir; ausentes, ficam `UNKNOWN`/`null`.
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
  logisticsClassification?: LogisticsClassification;
  logisticsType?: string | null;
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
