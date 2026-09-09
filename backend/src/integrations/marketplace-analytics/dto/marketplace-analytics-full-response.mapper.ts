import { percentChange } from '../../marketplace-orders/percent-change.util';
import {
  centsToDecimalString,
  divideCents,
} from '../../marketplace-orders/money.util';
import type {
  AnalyticsFullAggregate,
  AnalyticsFullDailyPointRaw,
  AnalyticsFullPeriodTotals,
  AnalyticsFullRankingEntryRaw,
} from '../marketplace-analytics.service';
import { roundTo, shareOf } from './marketplace-analytics-response-math.util';
import type {
  AnalyticsFullComparison,
  AnalyticsFullDailyPoint,
  AnalyticsFullRankingEntry,
  AnalyticsFullSummary,
  LogisticsGroupSummary,
  MarketplaceAnalyticsFull,
} from './marketplace-analytics-full-response.dto';

function hasGroupData(totals: AnalyticsFullPeriodTotals): boolean {
  return totals.grossSalesOrders > 0 || totals.cancelledOrders > 0;
}

/**
 * `totalCurrent` aqui é SEMPRE `full.totalCurrent` (a soma real,
 * incondicional por classificação) — nunca `aggregate.current` do nível
 * raiz, que passa a ser filtrado pelo `logisticsScope` selecionado no resto
 * do dashboard (Fase 4, item 2). Usar o total raiz faria `shareOfPaidRevenuePct`
 * virar 100% sempre que o usuário filtrasse por `FULL`.
 */
export function toFullAggregate(
  full: AnalyticsFullAggregate,
): MarketplaceAnalyticsFull {
  const hasData = hasGroupData(full.current);
  return {
    coverage: full.coverage,
    classifiedOrders: full.classifiedOrders,
    unclassifiedOrders: full.unclassifiedOrders,
    summary: hasData ? toFullSummary(full.current, full.totalCurrent) : null,
    comparison:
      hasData && full.previous
        ? toFullComparison(full.current, full.previous)
        : null,
    dailySeries: full.dailySeries.map(toFullDailyPoint),
    ranking: full.ranking.map((row) =>
      toFullRankingEntry(row, full.current.grossSalesUnits),
    ),
    nonFullSummary: hasGroupData(full.nonFullCurrent)
      ? toGroupSummary(full.nonFullCurrent)
      : null,
    unknownSummary: hasGroupData(full.unknownCurrent)
      ? toGroupSummary(full.unknownCurrent)
      : null,
    totalSummary: hasGroupData(full.totalCurrent)
      ? toGroupSummary(full.totalCurrent)
      : null,
  };
}

function toGroupSummary(
  totals: AnalyticsFullPeriodTotals,
): LogisticsGroupSummary {
  return {
    grossSalesRevenue: centsToDecimalString(totals.grossSalesRevenueCents),
    grossSalesOrders: totals.grossSalesOrders,
    grossSalesUnits: totals.grossSalesUnits,
    paidRevenue: centsToDecimalString(totals.paidRevenueCents),
    paidOrders: totals.paidOrders,
    paidUnits: totals.paidUnits,
    averageTicket: divideCents(
      totals.paidRevenueCents,
      BigInt(totals.paidOrders),
    ),
    cancelledOrders: totals.cancelledOrders,
    cancelledUnits: totals.cancelledUnits,
    cancelledRevenue: centsToDecimalString(totals.cancelledRevenueCents),
  };
}

function toFullSummary(
  totals: AnalyticsFullPeriodTotals,
  totalCurrent: AnalyticsFullPeriodTotals,
): AnalyticsFullSummary {
  return {
    ...toGroupSummary(totals),
    shareOfPaidRevenuePct: shareOfCents(
      totals.paidRevenueCents,
      totalCurrent.paidRevenueCents,
    ),
    shareOfPaidUnitsPct: shareOf(totals.paidUnits, totalCurrent.paidUnits),
  };
}

function toFullComparison(
  current: AnalyticsFullPeriodTotals,
  previous: AnalyticsFullPeriodTotals,
): AnalyticsFullComparison {
  return {
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
    paidRevenuePct: percentChange(
      Number(current.paidRevenueCents),
      Number(previous.paidRevenueCents),
    ),
    paidOrdersPct: percentChange(current.paidOrders, previous.paidOrders),
    paidUnitsPct: percentChange(current.paidUnits, previous.paidUnits),
    averageTicketPct: percentChange(
      fullAverageTicketApprox(current),
      fullAverageTicketApprox(previous),
    ),
    cancelledOrdersPct: percentChange(
      current.cancelledOrders,
      previous.cancelledOrders,
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

function fullAverageTicketApprox(totals: AnalyticsFullPeriodTotals): number {
  if (totals.paidOrders === 0) return 0;
  return Number(totals.paidRevenueCents) / totals.paidOrders;
}

function toFullDailyPoint(
  point: AnalyticsFullDailyPointRaw,
): AnalyticsFullDailyPoint {
  return {
    date: point.date,
    paidRevenue: centsToDecimalString(point.paidRevenueCents),
    paidOrders: point.paidOrders,
    units: point.units,
    cancelledOrders: point.cancelledOrders,
  };
}

function toFullRankingEntry(
  row: AnalyticsFullRankingEntryRaw,
  totalFullUnitsInPeriod: number,
): AnalyticsFullRankingEntry {
  return {
    sku: row.sku,
    title: row.title,
    distinctListings: row.distinctListings,
    orders: row.orders,
    units: row.units,
    paidRevenue: centsToDecimalString(row.paidRevenueCents),
    grossSalesRevenue: centsToDecimalString(row.grossSalesRevenueCents),
    unitsSharePct: shareOf(row.units, totalFullUnitsInPeriod),
  };
}

function shareOfCents(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return roundTo((Number(part) / Number(total)) * 100, 1);
}
