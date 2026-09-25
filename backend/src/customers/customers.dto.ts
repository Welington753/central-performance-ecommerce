import { centsToDecimalString } from '../integrations/marketplace-orders/money.util';
import type { Marketplace } from '../integrations/contracts/marketplace.enum';
import { maskEmail, maskPhone } from './customer-format.util';
import type {
  CustomerCards,
  CustomerRecord,
  CustomerType,
} from './customer-metrics';
import type { CustomersFilter, CustomersPagination } from './customers-query';

/**
 * Valores monetários sempre string decimal ("123.45"); `null` = N/D.
 * `buyerName` é do comprador; `recipientName`/`recipientPhoneMasked` e
 * cidade/UF são do DESTINATÁRIO da entrega (Shopee) — nunca do comprador.
 */
export interface CustomerSummaryItemDto {
  buyerId: string;
  marketplace: Marketplace;
  accountId: string;
  accountNickname: string | null;
  externalBuyerId: string;
  username: string | null;
  buyerName: string | null;
  recipientName: string | null;
  emailMasked: string | null;
  recipientPhoneMasked: string | null;
  city: string | null;
  state: string | null;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  validOrders: number;
  totalOrders: number;
  units: number;
  paidRevenue: string;
  refundedAmount: string | null;
  averageTicket: string | null;
  customerType: CustomerType;
  topProduct: {
    title: string;
    sellerSku: string | null;
    externalItemId: string;
    units: number;
  } | null;
}

export interface CustomerCardsDto {
  identifiedCustomers: number;
  customersWithValidPurchase: number;
  recurringCustomers: number;
  recurrenceRate: number | null;
  paidRevenue: string;
  paidOrders: number;
  averageTicket: string | null;
  units: number;
  buyerNameCoverage: number | null;
  recipientNameCoverage: number | null;
  emailCoverage: number | null;
  recipientPhoneCoverage: number | null;
}

export interface CustomersSummaryResponseDto {
  period: { allTime: boolean; from: string | null; to: string | null };
  cards: CustomerCardsDto;
  page: number;
  pageSize: number;
  totalCustomers: number;
  totalPages: number;
  customers: CustomerSummaryItemDto[];
}

export interface CustomerOrderLineDto {
  externalOrderId: string;
  dateCreated: string;
  status: string;
  sourceStatus: string | null;
  sellerSku: string | null;
  title: string;
  externalItemId: string;
  quantity: number;
  unitPrice: string;
  orderTotal: string;
  refundedAmount: string | null;
  fulfillment: 'FULL' | 'NORMAL' | 'UNKNOWN';
}

function money(cents: bigint | null): string | null {
  return cents === null ? null : centsToDecimalString(cents);
}

export function toCustomerCardsDto(cards: CustomerCards): CustomerCardsDto {
  return {
    identifiedCustomers: cards.identifiedCustomers,
    customersWithValidPurchase: cards.customersWithValidPurchase,
    recurringCustomers: cards.recurringCustomers,
    recurrenceRate: cards.recurrenceRate,
    paidRevenue: centsToDecimalString(cards.paidRevenueCents),
    paidOrders: cards.paidOrders,
    averageTicket: money(cards.averageTicketCents),
    units: cards.units,
    buyerNameCoverage: cards.buyerNameCoverage,
    recipientNameCoverage: cards.recipientNameCoverage,
    emailCoverage: cards.emailCoverage,
    recipientPhoneCoverage: cards.recipientPhoneCoverage,
  };
}

/** Tela: e-mail/telefone SEMPRE mascarados; CEP e endereço nunca expostos. */
export function toCustomerSummaryItemDto(
  record: CustomerRecord,
): CustomerSummaryItemDto {
  return {
    buyerId: record.buyerId,
    marketplace: record.marketplace,
    accountId: record.accountId,
    accountNickname: record.accountNickname,
    externalBuyerId: record.externalBuyerId,
    username: record.username,
    buyerName: record.buyerName,
    recipientName: record.recipientName,
    emailMasked: maskEmail(record.email),
    recipientPhoneMasked: maskPhone(record.recipientPhone),
    city: record.city,
    state: record.state,
    firstPurchaseAt: record.firstPurchaseAt?.toISOString() ?? null,
    lastPurchaseAt: record.lastPurchaseAt?.toISOString() ?? null,
    validOrders: record.validOrders,
    totalOrders: record.totalOrders,
    units: record.units,
    paidRevenue: centsToDecimalString(record.paidRevenueCents),
    refundedAmount: money(record.refundedCents),
    averageTicket: money(record.averageTicketCents),
    customerType: record.customerType,
    topProduct: record.topProduct,
  };
}

/** `pageRecords` já é SÓ a página pedida (paginação feita no banco). */
export function toCustomersSummaryResponse(
  filter: CustomersFilter,
  pagination: CustomersPagination,
  pageRecords: CustomerRecord[],
  cards: CustomerCards,
): CustomersSummaryResponseDto {
  const total = cards.identifiedCustomers;
  return {
    period: {
      allTime: filter.period === null,
      from: filter.period?.fromLabel ?? null,
      to: filter.period?.toLabel ?? null,
    },
    cards: toCustomerCardsDto(cards),
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalCustomers: total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    customers: pageRecords.map(toCustomerSummaryItemDto),
  };
}

export function fulfillmentLabel(
  logisticsClassification: string,
): CustomerOrderLineDto['fulfillment'] {
  if (logisticsClassification === 'MARKETPLACE_FULFILLED') return 'FULL';
  if (logisticsClassification === 'SELLER_FULFILLED') return 'NORMAL';
  return 'UNKNOWN';
}
