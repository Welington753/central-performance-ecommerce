import type {
  MappedOrderItemRecord,
  MappedOrderRecord,
} from '../marketplace-orders/mapped-order-record';
import type {
  RawMercadoLivreOrder,
  RawMercadoLivreOrderItem,
} from './mercado-livre-order-response';

export type { MappedOrderItemRecord, MappedOrderRecord };

// A allowlist real acontece em `mercado-livre-order-response.ts`; este
// mapper só converte tipos, nunca usa spread do objeto bruto recebido da
// API. Nunca define `sourceStatus`/`fulfillmentChannel`/
// `externalMarketplaceId` (campos opcionais só usados pela Amazon) — ficam
// `undefined`, persistidos como `NULL`.

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
