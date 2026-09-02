import { centsToDecimalString, divideCents } from '../money.util';
import { SAO_PAULO_TIME_ZONE } from '../period.util';
import type {
  KpiPeriodSummary,
  OrdersKpiAggregate,
  TopProductAggregate,
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
  summary: {
    grossRevenue: string;
    orders: number;
    units: number;
    averageTicket: string;
  };
  comparison: {
    grossRevenuePct: number | null;
    ordersPct: number | null;
    unitsPct: number | null;
    averageTicketPct: number | null;
  };
  topProducts: Array<{
    sku: string | null;
    title: string;
    units: number;
    grossRevenue: string;
  }>;
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
 */
export function toMercadoLivreKpisResponse(
  input: ToMercadoLivreKpisResponseInput,
): MercadoLivreKpisResponseDto {
  const { current, previous, currentWindow } = input.aggregate;

  return {
    account: {
      id: input.account.id,
      externalSellerId: input.account.externalSellerId,
      nickname: input.account.nickname,
    },
    period: {
      days: 30,
      timeZone: SAO_PAULO_TIME_ZONE,
      from: currentWindow.from.toISOString(),
      to: currentWindow.to.toISOString(),
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
    },
    topProducts: input.aggregate.topProducts.map(toTopProduct),
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
  };
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
