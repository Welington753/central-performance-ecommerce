import { percentChange } from '../../marketplace-orders/percent-change.util';
import {
  centsToDecimalString,
  divideCents,
} from '../../marketplace-orders/money.util';
import {
  SAO_PAULO_TIME_ZONE,
  listDaysInWindow,
  utcInstantToSaoPauloDateString,
} from '../../marketplace-orders/period.util';
import { intervalsToDto } from '../consolidated-coverage.util';
import { computeRefundCoverage } from '../refund-coverage.util';
import type {
  AnalyticsAccountTotals,
  AnalyticsDailyPointRaw,
  AnalyticsPeriodTotals,
  MarketplaceAnalyticsAggregate,
} from '../marketplace-analytics.service';
import { toFullAggregate } from './marketplace-analytics-full-response.mapper';
import { roundTo, shareOf } from './marketplace-analytics-response-math.util';
import type {
  AnalyticsBestDay,
  AnalyticsBreakdownSummary,
  AnalyticsDailyPoint,
  AnalyticsKpiComparison,
  AnalyticsKpiSummary,
  AnalyticsTopProductBySku,
  MarketplaceAnalyticsKpisResponseDto,
} from './marketplace-analytics-kpi-response.dto';

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
    full: aggregate.full ? toFullAggregate(aggregate.full) : null,
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
    grossSalesRevenue: centsToDecimalString(totals.grossSalesRevenueCents),
    grossSalesOrders: totals.grossSalesOrders,
    grossSalesUnits: totals.grossSalesUnits,
    grossSalesAverageTicket: divideCents(
      totals.grossSalesRevenueCents,
      BigInt(totals.grossSalesOrders),
    ),
    grossSalesAvgUnitPrice: divideCents(
      totals.grossSalesRevenueCents,
      BigInt(totals.grossSalesUnits),
    ),
    cancelledUnits: totals.cancelledUnits,
    cancelledRevenue: centsToDecimalString(totals.cancelledRevenueCents),
    partiallyRefundedOrders: totals.partiallyRefundedOrders,
    partiallyRefundedGrossAmount: centsToDecimalString(
      totals.partiallyRefundedGrossAmountCents,
    ),
    refundCoverage: computeRefundCoverage(totals.partiallyRefundedOrders),
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
    grossSalesRevenuePct: percentChange(
      Number(current.grossSalesRevenueCents),
      Number(previous.grossSalesRevenueCents),
    ),
    grossSalesOrdersPct: percentChange(
      current.grossSalesOrders,
      previous.grossSalesOrders,
    ),
    grossSalesUnitsPct: percentChange(
      current.grossSalesUnits,
      previous.grossSalesUnits,
    ),
    grossSalesAverageTicketPct: percentChange(
      grossSalesAverageTicketApprox(current),
      grossSalesAverageTicketApprox(previous),
    ),
    grossSalesAvgUnitPricePct: percentChange(
      grossSalesAvgUnitPriceApprox(current),
      grossSalesAvgUnitPriceApprox(previous),
    ),
    cancelledUnitsPct: percentChange(
      current.cancelledUnits,
      previous.cancelledUnits,
    ),
    cancelledRevenuePct: percentChange(
      Number(current.cancelledRevenueCents),
      Number(previous.cancelledRevenueCents),
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

function grossSalesAverageTicketApprox(totals: AnalyticsPeriodTotals): number {
  if (totals.grossSalesOrders === 0) return 0;
  return Number(totals.grossSalesRevenueCents) / totals.grossSalesOrders;
}

function grossSalesAvgUnitPriceApprox(totals: AnalyticsPeriodTotals): number {
  if (totals.grossSalesUnits === 0) return 0;
  return Number(totals.grossSalesRevenueCents) / totals.grossSalesUnits;
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

function dateBeforeExclusiveEnd(exclusiveEnd: Date): string {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return utcInstantToSaoPauloDateString(
    new Date(exclusiveEnd.getTime() - oneDayMs),
  );
}
