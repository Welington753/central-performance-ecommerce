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
  /**
   * `shipping.id` do Mercado Livre (Correção da auditoria Full) — persistido
   * para que um pedido deixado `UNKNOWN` possa ser reclassificado depois sem
   * refazer o backfill. Só o mapper do Mercado Livre o define; ausente, fica
   * `null` no banco.
   */
  externalShipmentId?: string | null;
  /**
   * Campos financeiros confirmados do Mercado Livre (CP2K-7D) — string
   * monetária decimal (mesma convenção de `totalAmount`), nunca centavos.
   * `buyerShippingCostAmount` é o frete COBRADO DO COMPRADOR
   * (`payments[].shipping_cost`), nunca o custo do vendedor — esse conceito
   * não é persistido neste checkpoint. Opcionais porque só o Mercado Livre
   * os preenche hoje — o mapper da Amazon nunca os define, então ficam
   * `null` no banco (mesma convenção dos três campos exclusivos da Amazon
   * acima).
   */
  marketplaceFeeAmount?: string | null;
  buyerShippingCostAmount?: string | null;
  taxesAmount?: string | null;
  couponAmount?: string | null;
  refundedAmount?: string | null;
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
  /** Comissão do Mercado Livre por item (CP2K-7D) — `null` quando ausente/não aplicável. */
  saleFeeAmount?: string | null;
}
