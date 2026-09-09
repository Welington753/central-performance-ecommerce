import type { Marketplace } from '../../contracts/marketplace.enum';
import type { MarketplaceAccountStatus } from '../../marketplace-accounts/marketplace-account.entity';
import type { MarketplaceFilter } from '../marketplace-filter.util';
import type { LogisticsScopeFilter } from '../logistics-scope-filter.util';
import type {
  AccountAvailability,
  SourceAvailability,
} from '../source-eligibility.util';
import type { ConsolidatedCoverageStatus } from '../consolidated-coverage.util';
import type { MarketplaceAnalyticsFull } from './marketplace-analytics-full-response.dto';

export interface AnalyticsKpiSummary {
  /** Faturamento de PEDIDOS PAGOS, antes de tarifas/frete/impostos/Ads — indicador operacional, nunca chamado de "líquido". */
  grossRevenue: string;
  orders: number;
  units: number;
  averageTicket: string;
  cancelledOrders: number;
  cancellationRate: number;
  distinctProducts: number;
  unitsPerOrder: number;
  avgUnitPrice: string;
  /**
   * "Vendas brutas" — equivalente ao indicador do marketplace: pedidos
   * pagos + cancelados com valor válido. Nunca inclui pendentes/`unfulfillable`.
   */
  grossSalesRevenue: string;
  grossSalesOrders: number;
  grossSalesUnits: number;
  grossSalesAverageTicket: string;
  grossSalesAvgUnitPrice: string;
  /** Painel "Ver cancelamentos" — todos os pedidos cancelados do período (ver `cancelledOrders`/`cancellationRate` acima para contagem/taxa). */
  cancelledUnits: number;
  cancelledRevenue: string;
}

export interface AnalyticsKpiComparison {
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
  /** `null` quando não há nenhuma prova real de dado (`NOT_CONNECTED`/`CONNECTED_NO_DATA`) — NUNCA "R$ 0,00" inventado. */
  summary: AnalyticsBreakdownSummary | null;
  lastSync: string | null;
}

export interface AccountBreakdownEntry {
  accountId: string;
  marketplace: Marketplace;
  nickname: string | null;
  externalSellerId: string | null;
  status: MarketplaceAccountStatus;
  availability: AccountAvailability;
  summary: AnalyticsBreakdownSummary | null;
  lastSync: string | null;
}

export interface AnalyticsSourceCoverage {
  accountId: string;
  marketplace: Marketplace;
  availability: AccountAvailability;
  synchronizedIntervals: Array<{ from: string; to: string }>;
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
}

export interface AnalyticsDataCoverage {
  status: ConsolidatedCoverageStatus;
  synchronizedIntervals: Array<{ from: string; to: string }>;
  selectedPeriodComplete: boolean;
  comparisonPeriodComplete: boolean;
}

/**
 * Contrato genérico multi-marketplace (Checkpoint 3). Nunca inclui token,
 * credencial cifrada, `connectedByUserId`, `failureCode`, comprador, pedido
 * individual ou qualquer resposta bruta de marketplace — só agregados.
 */
export interface MarketplaceAnalyticsKpisResponseDto {
  scope: {
    marketplace: MarketplaceFilter;
    accountId: string | null;
    /** "Todo o período" (Fase 4): quando `true`, `comparison` é sempre
     * `null` e `comparisonPeriod` não deve ser exibido — o frontend nunca
     * mostra percentuais comparativos neste modo. */
    allTime: boolean;
    /** `ALL`/`FULL`/`NON_FULL` (Fase 4, "Full x sem Full") — sempre `ALL` fora do escopo Mercado Livre. */
    logisticsScope: LogisticsScopeFilter;
  };
  availability: SourceAvailability;
  period: { days: number; timeZone: string; from: string; to: string };
  comparisonPeriod: { days: number; from: string; to: string };
  /** `null` somente quando `availability` é `NOT_CONNECTED` ou `CONNECTED_NO_DATA` — sem prova real de dado. */
  summary: AnalyticsKpiSummary | null;
  comparison: AnalyticsKpiComparison | null;
  bestDay: AnalyticsBestDay | null;
  dailySeries: AnalyticsDailyPoint[];
  topProductsBySku: AnalyticsTopProductBySku[];
  topListings: AnalyticsTopListing[];
  breakdownByMarketplace: MarketplaceBreakdownEntry[];
  breakdownByAccount: AccountBreakdownEntry[];
  sources: AnalyticsSourceCoverage[];
  dataCoverage: AnalyticsDataCoverage;
  lastSync: string | null;
  full: MarketplaceAnalyticsFull | null;
}
