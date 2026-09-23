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
  /** Faturamento de PEDIDOS PAGOS, antes de tarifas/frete/impostos/Ads — indicador operacional, nunca "líquido". */
  grossRevenue: string;
  orders: number;
  units: number;
  averageTicket: string;
  cancelledOrders: number;
  cancellationRate: number;
  distinctProducts: number;
  unitsPerOrder: number;
  avgUnitPrice: string;
  /** "Vendas brutas" — equivalente ao indicador do marketplace: pedidos pagos + cancelados com valor válido. */
  grossSalesRevenue: string;
  grossSalesOrders: number;
  grossSalesUnits: number;
  grossSalesAverageTicket: string;
  grossSalesAvgUnitPrice: string;
  /** Painel "Ver cancelamentos" — todos os pedidos cancelados do período. */
  cancelledUnits: number;
  cancelledRevenue: string;
  /** partially_refunded — nunca somado a grossRevenue/cancelledRevenue acima. */
  partiallyRefundedOrders: number;
  /** Valor BRUTO (total_amount) anterior/independente do estorno — nunca receita líquida. */
  partiallyRefundedGrossAmount: string;
  refundCoverage: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  /**
   * Três agregados financeiros confirmados (CP2K-8B/CP2K-8D) — exibidos à
   * parte, nunca somados/subtraídos de `grossRevenue`. Só têm dado real para
   * Mercado Livre hoje; strings decimais sempre presentes (nunca `undefined`).
   */
  shippingCost: string;
  couponAmount: string;
  refundedAmount: string;
  /**
   * "Despesas e ajustes conhecidos" — hoje soma só `couponAmount` (mesma
   * população de `grossRevenue`, confirmado que ainda não é descontado do
   * valor bruto). `refundedAmount` fica de fora: seus pedidos têm status
   * diferente (partially_refunded), população disjunta de `grossRevenue` —
   * ver `ExpensesAndResultSection`.
   */
  knownAdjustmentsAmount: string;
  knownAdjustmentsPctOfGrossRevenue: number;
  resultAfterKnownAdjustments: string;
  marginAfterKnownAdjustmentsPct: number;
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
  grossSalesRevenuePct: number | null;
  grossSalesOrdersPct: number | null;
  grossSalesUnitsPct: number | null;
  grossSalesAverageTicketPct: number | null;
  grossSalesAvgUnitPricePct: number | null;
  cancelledUnitsPct: number | null;
  cancelledRevenuePct: number | null;
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
  /** Mesma população/denominador de `unitsSharePct` (todos os pedidos pagos do período, nunca só as linhas do Top N/busca). */
  grossRevenueSharePct: number;
}

export interface AnalyticsTopListing {
  listingId: string;
  marketplace: Marketplace;
  accountId: string;
  sku: string | null;
  title: string;
  units: number;
  grossRevenue: string;
  grossRevenueSharePct: number;
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

// "Mercado Livre Full" (Fase 4) — restrito a pedidos com classificação
// logística MARKETPLACE_FULFILLED. Nunca inclui Flex nem pedidos ainda não
// classificados (ver `FullClassificationCoverage` no backend).
export type FullClassificationCoverage = "complete" | "partial" | "unknown";

export interface AnalyticsFullSummary {
  grossSalesRevenue: string;
  grossSalesOrders: number;
  grossSalesUnits: number;
  paidRevenue: string;
  paidOrders: number;
  paidUnits: number;
  averageTicket: string;
  shareOfPaidRevenuePct: number;
  shareOfPaidUnitsPct: number;
  cancelledOrders: number;
  cancelledUnits: number;
  cancelledRevenue: string;
}

export interface AnalyticsFullComparison {
  grossSalesRevenuePct: number | null;
  grossSalesOrdersPct: number | null;
  grossSalesUnitsPct: number | null;
  paidRevenuePct: number | null;
  paidOrdersPct: number | null;
  paidUnitsPct: number | null;
  averageTicketPct: number | null;
  cancelledOrdersPct: number | null;
  cancelledUnitsPct: number | null;
  cancelledRevenuePct: number | null;
}

export interface AnalyticsFullDailyPoint {
  date: string;
  paidRevenue: string;
  paidOrders: number;
  units: number;
  cancelledOrders: number;
}

export interface AnalyticsFullRankingEntry {
  sku: string | null;
  title: string;
  distinctListings: number;
  orders: number;
  units: number;
  paidRevenue: string;
  grossSalesRevenue: string;
  unitsSharePct: number;
}

// "Full x sem Full" (Fase 4): grupo genérico sem os percentuais de
// participação (só fazem sentido para o grupo Full em si).
export interface LogisticsGroupSummary {
  grossSalesRevenue: string;
  grossSalesOrders: number;
  grossSalesUnits: number;
  paidRevenue: string;
  paidOrders: number;
  paidUnits: number;
  averageTicket: string;
  cancelledOrders: number;
  cancelledUnits: number;
  cancelledRevenue: string;
}

export interface MarketplaceAnalyticsFull {
  coverage: FullClassificationCoverage;
  classifiedOrders: number;
  unclassifiedOrders: number;
  summary: AnalyticsFullSummary | null;
  comparison: AnalyticsFullComparison | null;
  dailySeries: AnalyticsFullDailyPoint[];
  ranking: AnalyticsFullRankingEntry[];
  nonFullSummary: LogisticsGroupSummary | null;
  unknownSummary: LogisticsGroupSummary | null;
  totalSummary: LogisticsGroupSummary | null;
}

export type LogisticsScopeFilter = "ALL" | "FULL" | "NON_FULL";

export interface MarketplaceAnalyticsKpisDto {
  scope: {
    marketplace: MarketplaceFilter;
    accountId: string | null;
    allTime: boolean;
    logisticsScope: LogisticsScopeFilter;
  };
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
  /**
   * Mesma forma de `breakdownByAccount`, mas para TODAS as contas do
   * sistema — nunca só as do filtro de escopo atual. Usado pelo painel
   * "Visão consolidada dos marketplaces" para desenhar um cartão por conta
   * do Mercado Livre sempre visível, igual a `breakdownByMarketplace`.
   */
  breakdownByAccountUnscoped: AccountBreakdownEntry[];
  sources: AnalyticsSourceCoverage[];
  dataCoverage: AnalyticsDataCoverage;
  lastSync: string | null;
  full: MarketplaceAnalyticsFull | null;
  /** "Shopee Full" — mesma forma de `full`, sempre restrita às contas Shopee do escopo. Nunca somado/misturado com `full` (Mercado Livre). */
  shopeeFull: MarketplaceAnalyticsFull | null;
}
