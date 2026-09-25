import type {
  MappedOrderItemRecord,
  MappedOrderRecord,
} from '../marketplace-orders/mapped-order-record';
import {
  centsToDecimalString,
  decimalStringToCents,
} from '../marketplace-orders/money.util';
import type { MappedBuyerRecord } from '../marketplace-orders/buyer-snapshot';
import type {
  RawMercadoLivreBuyer,
  RawMercadoLivreOrder,
  RawMercadoLivreOrderItem,
  RawMercadoLivrePayment,
} from './mercado-livre-order-response';

export type { MappedOrderItemRecord, MappedOrderRecord };

/**
 * Único status de payment elegível para o agregado financeiro do pedido
 * (CP2K-7D, regra confirmada por sondagem real — ver preflight CP2K-7D):
 * `approved` é o único estado documentado do Mercado Livre que representa um
 * pagamento efetivamente concluído. Qualquer outro status (`cancelled`,
 * `rejected`, `in_process`, `refunded`, `charged_back`, `unknown`...) nunca
 * contribui para a soma — evita contar dinheiro de um pagamento que nunca se
 * efetivou (ou já foi desfeito) como se fosse receita/custo real do pedido.
 */
const ELIGIBLE_PAYMENT_STATUS = 'approved';

/**
 * Soma um campo monetário só entre os payments elegíveis — em centavos
 * (`bigint`), nunca em `float` (mesma convenção de `money.util.ts`).
 * `null` quando NENHUM payment elegível tem o campo presente (nem sequer um
 * `null` explícito vira contribuição) — distinto de zero, que é preservado
 * quando pelo menos um payment elegível tem exatamente esse valor.
 */
function sumEligiblePaymentField(
  payments: readonly RawMercadoLivrePayment[],
  field: keyof Omit<RawMercadoLivrePayment, 'status'>,
): string | null {
  const values = payments
    .filter((payment) => payment.status === ELIGIBLE_PAYMENT_STATUS)
    .map((payment) => payment[field])
    .filter((value): value is string => value !== null);

  if (values.length === 0) return null;

  const totalCents = values.reduce(
    (sum, value) => sum + decimalStringToCents(value),
    0n,
  );
  return centsToDecimalString(totalCents);
}

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
    // Correção da auditoria Full: o `shipping.id` passa a ser PERSISTIDO,
    // não só usado em memória — sem ele, um pedido deixado `UNKNOWN` só
    // poderia ser reclassificado refazendo o backfill de pedidos.
    externalShipmentId: raw.shippingId,
    marketplaceFeeAmount: sumEligiblePaymentField(
      raw.payments,
      'marketplaceFee',
    ),
    buyerShippingCostAmount: sumEligiblePaymentField(
      raw.payments,
      'shippingCost',
    ),
    taxesAmount: sumEligiblePaymentField(raw.payments, 'taxesAmount'),
    couponAmount: sumEligiblePaymentField(raw.payments, 'couponAmount'),
    refundedAmount: sumEligiblePaymentField(
      raw.payments,
      'transactionAmountRefunded',
    ),
    buyer: mapMercadoLivreBuyer(raw.buyer),
    items: raw.items.map(mapMercadoLivreOrderItem),
  };
}

/**
 * O pedido do Mercado Livre não traz e-mail/telefone/endereço do comprador
 * (nunca inventados aqui); `first_name`/`last_name` só quando a própria
 * resposta os trouxe.
 */
function mapMercadoLivreBuyer(
  raw: RawMercadoLivreBuyer | null,
): MappedBuyerRecord | null {
  if (raw === null) return null;
  const nameParts = [raw.firstName, raw.lastName].filter(
    (part): part is string => part !== null,
  );
  return {
    externalBuyerId: raw.id,
    dataSource: 'MERCADO_LIVRE_ORDERS',
    username: raw.nickname,
    buyerName: nameParts.length > 0 ? nameParts.join(' ') : null,
    recipientName: null,
    email: null,
    recipientPhone: null,
    city: null,
    state: null,
    postalCode: null,
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
    saleFeeAmount: raw.saleFee,
  };
}
