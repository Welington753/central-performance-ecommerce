// Espelha MarketplaceAnalyticsKpisResponseDto (backend, Checkpoint 3)
// exatamente — nenhum campo interno/PII. Componentes reutilizáveis
// (KpiSummaryCards, AdditionalKpiCards, DailyRevenueChart,
// ProductRankingTabs, DataCoverageBanner) dependem SOMENTE destes tipos
// genéricos, nunca de `MercadoLivreKpisDto` diretamente.

export type Marketplace = "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
export type MarketplaceFilter = "ALL" | Marketplace;
export type MarketplaceAccountStatusValue =
  | "DISCONNECTED"
  | "CONNECTED"
  | "TOKEN_EXPIRED"
  | "ERROR";

export type SourceAvailability =
  | "AVAILABLE"
  | "CONNECTED_NO_DATA"
  | "HISTORICAL_ONLY"
  | "NOT_CONNECTED";

export type AccountAvailability = Exclude<SourceAvailability, "NOT_CONNECTED">;

export interface AnalyticsSummary {
  grossRevenue: string;
  orders: number;
  units: number;
  averageTicket: string;
  cancelledOrders: number;
  cancellationRate: number;
  distinctProducts: number;
  unitsPerOrder: number;
  avgUnitPrice: string;
}

export interface AnalyticsComparison {
  grossRevenuePct: number | null;
  ordersPct: number | null;
  unitsPct: number | null;
  averageTicketPct: number | null;
  cancelledOrdersPct: number | null;
  cancellationRateDiffPp: number;
  distinctProductsPct: number | null;
  unitsPerOrderPct: number | null;
}

export interface AnalyticsBestDay {
  date: string;
  grossRevenue: string;
  paidOrders: number;
  units: number;
}

export interface AnalyticsDailyPoint {
  date: string;
  grossRevenue: string;
  paidOrders: number;
  units: number;
  cancelledOrders: number;
}

export interface AnalyticsTopProductBySku {
  sku: string | null;
  title: string;
  distinctListings: number;
  units: number;
  grossRevenue: string;
  unitsSharePct: number;
}

export interface AnalyticsTopListing {
  listingId: string;
  marketplace: Marketplace;
  accountId: string;
  sku: string | null;
  title: string;
  units: number;
  grossRevenue: string;
}

export interface AnalyticsBreakdownSummary {
  grossRevenue: string;
  paidOrders: number;
  units: number;
}

export interface MarketplaceBreakdownEntry {
  marketplace: Marketplace;
  availability: SourceAvailability;
  accountsIncluded: number;
  accountsTotal: number;
  summary: AnalyticsBreakdownSummary | null;
  lastSync: string | null;
}

export interface AccountBreakdownEntry {
  accountId: string;
  marketplace: Marketplace;
  nickname: string | null;
  externalSellerId: string | null;
  status: MarketplaceAccountStatusValue;
  availability: AccountAvailability;
  summary: AnalyticsBreakdownSummary | null;
  lastSync: string | null;
}

export interface SynchronizedInterval {
  from: string;
  to: string;
}

export interface AnalyticsSourceCoverage {
  accountId: string;
  marketplace: Marketplace;
  availability: AccountAvailability;
  synchronizedIntervals: SynchronizedInterval[];
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
}

export interface AnalyticsDataCoverage {
  status: "complete" | "partial" | "unknown";
  synchronizedIntervals: SynchronizedInterval[];
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
}

export interface MarketplaceAnalyticsKpisDto {
  scope: { marketplace: MarketplaceFilter; accountId: string | null };
  availability: SourceAvailability;
  period: { days: number; timeZone: string; from: string; to: string };
  comparisonPeriod: { days: number; from: string; to: string };
  summary: AnalyticsSummary | null;
  comparison: AnalyticsComparison | null;
  bestDay: AnalyticsBestDay | null;
  dailySeries: AnalyticsDailyPoint[];
  topProductsBySku: AnalyticsTopProductBySku[];
  topListings: AnalyticsTopListing[];
  breakdownByMarketplace: MarketplaceBreakdownEntry[];
  breakdownByAccount: AccountBreakdownEntry[];
  sources: AnalyticsSourceCoverage[];
  dataCoverage: AnalyticsDataCoverage;
  lastSync: string | null;
}
