import { centsToDecimalString, divideCents } from '../money.util';
import {
  SAO_PAULO_TIME_ZONE,
  listDaysInWindow,
  utcInstantToSaoPauloDateString,
} from '../period.util';
import type { DataCoverage } from '../sync-coverage.util';
import type {
  DailyPoint,
  KpiPeriodSummary,
  OrdersKpiAggregate,
  TopListingAggregate,
  TopProductAggregate,
  TopProductBySkuAggregate,
} from '../mercado-livre-orders-kpi.service';

export interface MercadoLivreKpisResponseDto {
  account: {
    id: string;
    externalSellerId: string | null;
    nickname: string | null;
  };
  period: {
    days: number;
    timeZone: string;
    from: string;
    to: string;
  };
  comparisonPeriod: {
    days: number;
    from: string;
    to: string;
  };
  summary: {
    grossRevenue: string;
    orders: number;
    units: number;
    averageTicket: string;
    cancelledOrders: number;
    cancellationRate: number;
    distinctProducts: number;
    unitsPerOrder: number;
    avgUnitPrice: string;
  };
  comparison: {
    grossRevenuePct: number | null;
    ordersPct: number | null;
    unitsPct: number | null;
    averageTicketPct: number | null;
    cancelledOrdersPct: number | null;
    cancellationRateDiffPp: number;
    distinctProductsPct: number | null;
    unitsPerOrderPct: number | null;
  };
  bestDay: {
    date: string;
    grossRevenue: string;
    paidOrders: number;
    units: number;
  } | null;
  dailySeries: Array<{
    date: string;
    grossRevenue: string;
    paidOrders: number;
    units: number;
    cancelledOrders: number;
  }>;
  topProducts: Array<{
    sku: string | null;
    title: string;
    units: number;
    grossRevenue: string;
  }>;
  topProductsBySku: Array<{
    sku: string | null;
    title: string;
    distinctListings: number;
    units: number;
    grossRevenue: string;
    unitsSharePct: number;
  }>;
  topListings: Array<{
    listingId: string;
    sku: string | null;
    title: string;
    units: number;
    grossRevenue: string;
  }>;
  dataCoverage: DataCoverage;
  lastSync: string | null;
}

export interface ToMercadoLivreKpisResponseInput {
  account: {
    id: string;
    externalSellerId: string | null;
    nickname: string | null;
  };
  aggregate: OrdersKpiAggregate;
  lastSync: Date | null;
}

/**
 * Nunca inclui token, credencial cifrada, PII, `connectedByUserId` ou
 * `failureCode` — o `account` de entrada já vem pré-filtrado pelo chamador
 * (controller), e este mapper nunca usa spread do objeto original da conta.
 * Nunca inclui `orderId`, comprador ou qualquer pedido individual — apenas
 * agregados (Checkpoint 2, "DTO").
 */
export function toMercadoLivreKpisResponse(
  input: ToMercadoLivreKpisResponseInput,
): MercadoLivreKpisResponseDto {
  const { current, previous, currentWindow, previousWindow } = input.aggregate;

  return {
    account: {
      id: input.account.id,
      externalSellerId: input.account.externalSellerId,
      nickname: input.account.nickname,
    },
    period: {
      days: listDaysInWindow(currentWindow).length,
      timeZone: SAO_PAULO_TIME_ZONE,
      from: utcInstantToSaoPauloDateString(currentWindow.from),
      to: dateBeforeExclusiveEnd(currentWindow.to),
    },
    comparisonPeriod: {
      days: listDaysInWindow(previousWindow).length,
      from: utcInstantToSaoPauloDateString(previousWindow.from),
      to: dateBeforeExclusiveEnd(previousWindow.to),
    },
    summary: toSummary(current),
    comparison: {
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
    },
    bestDay: input.aggregate.bestDay
      ? toBestDay(input.aggregate.bestDay)
      : null,
    dailySeries: input.aggregate.dailySeries.map(toDailyPoint),
    topProducts: input.aggregate.topProducts.map(toTopProduct),
    topProductsBySku: input.aggregate.topProductsBySku.map((row) =>
      toTopProductBySku(row, current.units),
    ),
    topListings: input.aggregate.topListings.map(toTopListing),
    dataCoverage: input.aggregate.dataCoverage,
    lastSync: input.lastSync ? input.lastSync.toISOString() : null,
  };
}

function toSummary(summary: KpiPeriodSummary) {
  return {
    grossRevenue: centsToDecimalString(summary.grossRevenueCents),
    orders: summary.orders,
    units: summary.units,
    averageTicket: divideCents(
      summary.grossRevenueCents,
      BigInt(summary.orders),
    ),
    cancelledOrders: summary.cancelledOrders,
    cancellationRate: cancellationRate(summary),
    distinctProducts: summary.distinctProducts,
    unitsPerOrder: roundTo(unitsPerOrderApprox(summary), 2),
    avgUnitPrice: divideCents(
      summary.itemsGrossRevenueCents,
      BigInt(summary.units),
    ),
  };
}

/**
 * Taxa de cancelamento: `cancelados / (pagos + cancelados) × 100`. Com
 * denominador zero, retorna `0` — nunca `NaN`/`Infinity` (Checkpoint 2,
 * "Taxa de cancelamento").
 */
function cancellationRate(summary: KpiPeriodSummary): number {
  const denominator = summary.orders + summary.cancelledOrders;
  if (denominator === 0) return 0;
  return roundTo((summary.cancelledOrders / denominator) * 100, 1);
}

function unitsPerOrderApprox(summary: KpiPeriodSummary): number {
  if (summary.orders === 0) return 0;
  return summary.units / summary.orders;
}

/**
 * Aproximação em `number` usada SOMENTE para calcular a variação percentual
 * do ticket médio (design "Comparação") — a exibição do ticket médio em si
 * (`summary.averageTicket`) sempre vem de `divideCents`, nunca desta
 * aproximação. Um percentual já é, por natureza, um valor arredondado; a
 * precisão de `bigint` que os VALORES monetários exigem não se aplica aqui.
 */
function averageTicketApprox(summary: KpiPeriodSummary): number {
  if (summary.orders === 0) return 0;
  return Number(summary.grossRevenueCents) / summary.orders;
}

function toTopProduct(product: TopProductAggregate) {
  return {
    sku: product.sku,
    title: product.title,
    units: product.units,
    grossRevenue: centsToDecimalString(product.grossRevenueCents),
  };
}

function toTopProductBySku(
  product: TopProductBySkuAggregate,
  totalUnitsInPeriod: number,
) {
  return {
    sku: product.sku,
    title: product.title,
    distinctListings: product.distinctListings,
    units: product.units,
    grossRevenue: centsToDecimalString(product.grossRevenueCents),
    unitsSharePct: shareOf(product.units, totalUnitsInPeriod),
  };
}

function toTopListing(listing: TopListingAggregate) {
  return {
    listingId: listing.variationId
      ? `${listing.externalItemId}:${listing.variationId}`
      : listing.externalItemId,
    sku: listing.sku,
    title: listing.title,
    units: listing.units,
    grossRevenue: centsToDecimalString(listing.grossRevenueCents),
  };
}

function toDailyPoint(point: DailyPoint) {
  return {
    date: point.date,
    grossRevenue: centsToDecimalString(point.grossRevenueCents),
    paidOrders: point.paidOrders,
    units: point.units,
    cancelledOrders: point.cancelledOrders,
  };
}

function toBestDay(point: DailyPoint) {
  return {
    date: point.date,
    grossRevenue: centsToDecimalString(point.grossRevenueCents),
    paidOrders: point.paidOrders,
    units: point.units,
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

/**
 * `period.to`/`comparisonPeriod.to` exibem o ÚLTIMO dia incluído (inclusivo
 * para o usuário) — nunca o instante exclusivo interno (início do dia
 * seguinte) usado nas queries.
 */
function dateBeforeExclusiveEnd(exclusiveEnd: Date): string {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return utcInstantToSaoPauloDateString(
    new Date(exclusiveEnd.getTime() - oneDayMs),
  );
}

/**
 * `null` quando o período anterior é zero — nunca `Infinity`/`NaN`/um
 * percentual inventado (design "Comparação").
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
