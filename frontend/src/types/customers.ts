export type CustomerMarketplaceFilter = "ALL" | "MERCADO_LIVRE" | "SHOPEE";
export type CustomerTypeFilter = "ALL" | "NEW" | "RECURRING";
export type CustomerType = "NEW" | "RECURRING" | "NO_VALID_ORDER";

export interface CustomersFilters {
  marketplace: CustomerMarketplaceFilter;
  accountId: string;
  allTime: boolean;
  from: string;
  to: string;
  customerType: CustomerTypeFilter;
  search: string;
  product: string;
  onlyWithEmail: boolean;
  onlyWithRecipientPhone: boolean;
}

/**
 * Espelha `CustomerSummaryItemDto` do backend — e-mail/telefone já chegam
 * mascarados. `buyerName` é do comprador (Mercado Livre); `recipientName`,
 * `recipientPhoneMasked` e cidade/UF são do DESTINATÁRIO da entrega (Shopee).
 */
export interface CustomerSummaryItemDto {
  buyerId: string;
  marketplace: "MERCADO_LIVRE" | "SHOPEE";
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

export interface CustomersSummaryDto {
  period: { allTime: boolean; from: string | null; to: string | null };
  cards: CustomerCardsDto;
  page: number;
  pageSize: number;
  totalCustomers: number;
  totalPages: number;
  customers: CustomerSummaryItemDto[];
}

export interface BuyerEnrichmentAccountStatusDto {
  accountId: string;
  marketplace: "MERCADO_LIVRE" | "SHOPEE";
  nickname: string | null;
  connected: boolean;
  jobStatus: string | null;
  cursorBefore: string | null;
  chunksProcessed: number;
  lastErrorCode: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  pauseRequested: boolean;
  lastStartOutcome?:
    | "QUEUED"
    | "ALREADY_ACTIVE"
    | "MODE_CONFLICT"
    | "NOT_CONNECTED"
    | "NOT_SUPPORTED";
}

export interface BuyerEnrichmentStatusDto {
  workerEnabled: boolean;
  accounts: BuyerEnrichmentAccountStatusDto[];
}
