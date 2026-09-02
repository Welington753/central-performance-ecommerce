import type {
  RawMercadoLivreOrder,
  RawMercadoLivreOrderItem,
} from './mercado-livre-order-response';

/**
 * Registro pronto para persistência — já sem nenhum campo de comprador,
 * mensagem, endereço ou payload bruto (a allowlist real acontece em
 * `mercado-livre-order-response.ts`; este mapper só converte tipos, nunca
 * usa spread do objeto bruto recebido da API).
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

function toDateOrNull(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Lança `InvalidOrderDateError` quando `date_created` não é uma data válida
 * — o chamador (serviço de sincronização) traduz isso para
 * `INVALID_PROVIDER_RESPONSE`, nunca persiste um pedido com data
 * inventada/zerada.
 */
export class InvalidOrderDateError extends Error {}

export function mapMercadoLivreOrder(
  marketplaceAccountId: string,
  raw: RawMercadoLivreOrder,
): MappedOrderRecord {
  const dateCreated = toDateOrNull(raw.dateCreated);
  if (dateCreated === null) {
    throw new InvalidOrderDateError(
      `date_created inválida para o pedido ${raw.externalOrderId}`,
    );
  }

  return {
    marketplaceAccountId,
    externalOrderId: raw.externalOrderId,
    status: raw.status,
    currencyId: raw.currencyId,
    totalAmount: raw.totalAmount,
    packId: raw.packId,
    dateCreated,
    dateClosed: toDateOrNull(raw.dateClosed),
    marketplaceLastUpdated: toDateOrNull(raw.lastUpdated),
    items: raw.items.map(mapMercadoLivreOrderItem),
  };
}

function mapMercadoLivreOrderItem(
  raw: RawMercadoLivreOrderItem,
): MappedOrderItemRecord {
  return {
    externalItemId: raw.itemId,
    variationId: raw.variationId,
    sellerSku: raw.sellerSku,
    title: raw.title,
    quantity: raw.quantity,
    unitPrice: raw.unitPrice,
    currencyId: raw.currencyId,
  };
}
