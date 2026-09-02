import { percentChange } from '../../mercado-livre-orders/dto/mercado-livre-kpis-response.dto';
import {
  centsToDecimalString,
  divideCents,
} from '../../mercado-livre-orders/money.util';
import {
  SAO_PAULO_TIME_ZONE,
  listDaysInWindow,
  utcInstantToSaoPauloDateString,
} from '../../mercado-livre-orders/period.util';
import type { Marketplace } from '../../contracts/marketplace.enum';
import type { MarketplaceAccountStatus } from '../../marketplace-accounts/marketplace-account.entity';
import { intervalsToDto } from '../consolidated-coverage.util';
import type { MarketplaceFilter } from '../marketplace-filter.util';
import type {
  AccountAvailability,
  SourceAvailability,
} from '../source-eligibility.util';
import type { ConsolidatedCoverageStatus } from '../consolidated-coverage.util';
import type {
  AnalyticsAccountTotals,
  AnalyticsDailyPointRaw,
  AnalyticsPeriodTotals,
  MarketplaceAnalyticsAggregate,
} from '../marketplace-analytics.service';

export interface AnalyticsKpiSummary {
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

export interface AnalyticsKpiComparison {
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
  scope: { marketplace: MarketplaceFilter; accountId: string | null };
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
}

/**
 * Nunca inclui token, credencial cifrada, `connectedByUserId`,
 * `failureCode`, comprador, `orderId` ou qualquer resposta bruta de
 * marketplace — o `aggregate` de entrada já vem pré-filtrado pelo serviço
 * (nenhuma conta traz `encrypted*`/`failureCode` para dentro deste tipo).
 */
export function toMarketplaceAnalyticsResponse(
  aggregate: MarketplaceAnalyticsAggregate,
): MarketplaceAnalyticsKpisResponseDto {
  return {
    scope: aggregate.scope,
    availability: aggregate.availability,
    period: {
      days: listDaysInWindow(aggregate.currentWindow).length,
      timeZone: SAO_PAULO_TIME_ZONE,
      from: utcInstantToSaoPauloDateString(aggregate.currentWindow.from),
      to: dateBeforeExclusiveEnd(aggregate.currentWindow.to),
    },
    comparisonPeriod: {
      days: listDaysInWindow(aggregate.previousWindow).length,
      from: utcInstantToSaoPauloDateString(aggregate.previousWindow.from),
      to: dateBeforeExclusiveEnd(aggregate.previousWindow.to),
    },
    summary: aggregate.current ? toSummary(aggregate.current) : null,
    comparison:
      aggregate.current && aggregate.previous
        ? toComparison(aggregate.current, aggregate.previous)
        : null,
    bestDay: aggregate.bestDay ? toBestDay(aggregate.bestDay) : null,
    dailySeries: aggregate.dailySeries.map(toDailyPoint),
    topProductsBySku: aggregate.topProductsBySku.map((row) =>
      toTopProductBySku(row, aggregate.current?.units ?? 0),
    ),
    topListings: aggregate.topListings.map((row) => ({
      listingId: row.variationId
        ? `${row.externalItemId}:${row.variationId}`
        : row.externalItemId,
      marketplace: row.marketplace,
      accountId: row.accountId,
      sku: row.sku,
      title: row.title,
      units: row.units,
      grossRevenue: centsToDecimalString(row.grossRevenueCents),
    })),
    breakdownByMarketplace: aggregate.breakdownByMarketplace.map((entry) => ({
      marketplace: entry.marketplace,
      availability: entry.availability,
      accountsIncluded: entry.accountsIncluded,
      accountsTotal: entry.accountsTotal,
      summary: entry.totals ? toBreakdownSummary(entry.totals) : null,
      lastSync: entry.lastSuccessfulSyncAt
        ? entry.lastSuccessfulSyncAt.toISOString()
        : null,
    })),
    breakdownByAccount: aggregate.breakdownByAccount.map((entry) => ({
      accountId: entry.accountId,
      marketplace: entry.marketplace,
      nickname: entry.nickname,
      externalSellerId: entry.externalSellerId,
      status: entry.status,
      availability: entry.availability,
      summary: entry.totals ? toBreakdownSummary(entry.totals) : null,
      lastSync: entry.lastSuccessfulSyncAt
        ? entry.lastSuccessfulSyncAt.toISOString()
        : null,
    })),
    sources: aggregate.sources.map((source) => ({
      accountId: source.accountId,
      marketplace: source.marketplace,
      availability: source.availability,
      synchronizedIntervals: intervalsToDto(source.coverage.intervals),
      selectedPeriodComplete: source.coverage.selectedPeriodComplete,
      comparisonPeriodComplete: source.coverage.comparisonPeriodComplete,
    })),
    dataCoverage: {
      status: aggregate.dataCoverage.status,
      synchronizedIntervals: intervalsToDto(aggregate.dataCoverage.intervals),
      selectedPeriodComplete: aggregate.dataCoverage.selectedPeriodComplete,
      comparisonPeriodComplete: aggregate.dataCoverage.comparisonPeriodComplete,
    },
    lastSync: aggregate.lastSync ? aggregate.lastSync.toISOString() : null,
  };
}

function toSummary(totals: AnalyticsPeriodTotals): AnalyticsKpiSummary {
  return {
    grossRevenue: centsToDecimalString(totals.grossRevenueCents),
    orders: totals.orders,
    units: totals.units,
    averageTicket: divideCents(totals.grossRevenueCents, BigInt(totals.orders)),
    cancelledOrders: totals.cancelledOrders,
    cancellationRate: cancellationRate(totals),
    distinctProducts: totals.distinctProducts,
    unitsPerOrder: roundTo(unitsPerOrderApprox(totals), 2),
    avgUnitPrice: divideCents(
      totals.itemsGrossRevenueCents,
      BigInt(totals.units),
    ),
  };
}

function toComparison(
  current: AnalyticsPeriodTotals,
  previous: AnalyticsPeriodTotals,
): AnalyticsKpiComparison {
  return {
    grossRevenuePct: percentChange(
      Number(current.grossRevenueCents),
      Number(previous.grossRevenueCents),
    ),
    ordersPct: percentChange(current.orders, previous.orders),
    unitsPct: percentChange(current.units, previous.units),
    averageTicketPct: percentChange(
      averageTicketApprox(current),
      averageTicketApprox(previous),
    ),
    cancelledOrdersPct: percentChange(
      current.cancelledOrders,
      previous.cancelledOrders,
    ),
    cancellationRateDiffPp: roundTo(
      cancellationRate(current) - cancellationRate(previous),
      1,
    ),
    distinctProductsPct: percentChange(
      current.distinctProducts,
      previous.distinctProducts,
    ),
    unitsPerOrderPct: percentChange(
      unitsPerOrderApprox(current),
      unitsPerOrderApprox(previous),
    ),
  };
}

function cancellationRate(totals: AnalyticsPeriodTotals): number {
  const denominator = totals.orders + totals.cancelledOrders;
  if (denominator === 0) return 0;
  return roundTo((totals.cancelledOrders / denominator) * 100, 1);
}

function unitsPerOrderApprox(totals: AnalyticsPeriodTotals): number {
  if (totals.orders === 0) return 0;
  return totals.units / totals.orders;
}

function averageTicketApprox(totals: AnalyticsPeriodTotals): number {
  if (totals.orders === 0) return 0;
  return Number(totals.grossRevenueCents) / totals.orders;
}

function toBestDay(point: AnalyticsDailyPointRaw): AnalyticsBestDay {
  return {
    date: point.date,
    grossRevenue: centsToDecimalString(point.grossRevenueCents),
    paidOrders: point.paidOrders,
    units: point.units,
  };
}

function toDailyPoint(point: AnalyticsDailyPointRaw): AnalyticsDailyPoint {
  return {
    date: point.date,
    grossRevenue: centsToDecimalString(point.grossRevenueCents),
    paidOrders: point.paidOrders,
    units: point.units,
    cancelledOrders: point.cancelledOrders,
  };
}

function toTopProductBySku(
  row: {
    sku: string | null;
    title: string;
    distinctListings: number;
    units: number;
    grossRevenueCents: bigint;
  },
  totalUnitsInPeriod: number,
): AnalyticsTopProductBySku {
  return {
    sku: row.sku,
    title: row.title,
    distinctListings: row.distinctListings,
    units: row.units,
    grossRevenue: centsToDecimalString(row.grossRevenueCents),
    unitsSharePct: shareOf(row.units, totalUnitsInPeriod),
  };
}

function toBreakdownSummary(
  totals: AnalyticsAccountTotals,
): AnalyticsBreakdownSummary {
  return {
    grossRevenue: centsToDecimalString(totals.grossRevenueCents),
    paidOrders: totals.orders,
    units: totals.units,
  };
}

function shareOf(part: number, total: number): number {
  if (total === 0) return 0;
  return roundTo((part / total) * 100, 1);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function dateBeforeExclusiveEnd(exclusiveEnd: Date): string {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return utcInstantToSaoPauloDateString(
    new Date(exclusiveEnd.getTime() - oneDayMs),
  );
}
