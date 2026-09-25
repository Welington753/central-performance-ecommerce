import type { Marketplace } from '../integrations/contracts/marketplace.enum';
import { decimalStringToCents } from '../integrations/marketplace-orders/money.util';
import type { CustomerCardsRow } from './customers.repository';

export type CustomerType = 'NEW' | 'RECURRING' | 'NO_VALID_ORDER';

export interface CustomerTopProduct {
  title: string;
  sellerSku: string | null;
  externalItemId: string;
  units: number;
}

/**
 * Comprador de UMA conta, já descriptografado (só em memória, só a página
 * ou o lote em processamento). `buyerName` é do COMPRADOR (Mercado Livre);
 * `recipientName`/`recipientPhone` e cidade/UF/CEP são do DESTINATÁRIO da
 * entrega (Shopee) — nunca apresentados como dado do comprador.
 */
export interface CustomerRecord {
  buyerId: string;
  accountId: string;
  marketplace: Marketplace;
  accountNickname: string | null;
  externalBuyerId: string;
  username: string | null;
  buyerName: string | null;
  recipientName: string | null;
  email: string | null;
  recipientPhone: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  totalOrders: number;
  validOrders: number;
  paidOrders: number;
  paidRevenueCents: bigint;
  /** `null` = o marketplace não informou reembolso para nenhum pedido. */
  refundedCents: bigint | null;
  units: number;
  /** `null` quando não há pedido pago. */
  averageTicketCents: bigint | null;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  lastOrderAt: Date;
  customerType: CustomerType;
  topProduct: CustomerTopProduct | null;
}

export interface CustomerCards {
  identifiedCustomers: number;
  customersWithValidPurchase: number;
  recurringCustomers: number;
  /** recorrentes / clientes com ao menos 1 compra válida; `null` sem base. */
  recurrenceRate: number | null;
  paidRevenueCents: bigint;
  paidOrders: number;
  averageTicketCents: bigint | null;
  units: number;
  buyerNameCoverage: number | null;
  recipientNameCoverage: number | null;
  emailCoverage: number | null;
  recipientPhoneCoverage: number | null;
}

/** Recorrente = 2+ pedidos distintos válidos (contados por pedido, nunca por item). */
export function classifyCustomer(validOrders: number): CustomerType {
  if (validOrders >= 2) return 'RECURRING';
  if (validOrders === 1) return 'NEW';
  return 'NO_VALID_ORDER';
}

/** Divisão em centavos arredondada ao centavo mais próximo; `null` sem denominador. */
export function divideCentsOrNull(
  numerator: bigint,
  denominator: number,
): bigint | null {
  if (denominator <= 0) return null;
  const den = BigInt(denominator);
  return (numerator * 2n + den) / (den * 2n);
}

function ratio(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 10000) / 10000;
}

/** Cards a partir da agregação SQL (`findCards`) — nenhum dado pessoal envolvido. */
export function toCustomerCards(row: CustomerCardsRow): CustomerCards {
  const paidRevenueCents = decimalStringToCents(row.paid_revenue);
  return {
    identifiedCustomers: row.identified,
    customersWithValidPurchase: row.with_valid_purchase,
    recurringCustomers: row.recurring,
    recurrenceRate: ratio(row.recurring, row.with_valid_purchase),
    paidRevenueCents,
    paidOrders: row.paid_orders,
    averageTicketCents: divideCentsOrNull(paidRevenueCents, row.paid_orders),
    units: Number(row.units),
    buyerNameCoverage: ratio(row.with_buyer_name, row.identified),
    recipientNameCoverage: ratio(row.with_recipient_name, row.identified),
    emailCoverage: ratio(row.with_email, row.identified),
    recipientPhoneCoverage: ratio(row.with_recipient_phone, row.identified),
  };
}
