import type { FullClassificationCoverage } from '../marketplace-analytics.service';

/**
 * "Mercado Livre Full" (Fase 4) — restrito a pedidos com classificação
 * logística `MARKETPLACE_FULFILLED`. Nunca inclui Flex nem pedidos ainda não
 * classificados.
 */
export interface AnalyticsFullSummary {
  grossSalesRevenue: string;
  grossSalesOrders: number;
  grossSalesUnits: number;
  paidRevenue: string;
  paidOrders: number;
  paidUnits: number;
  averageTicket: string;
  /** % do faturamento pago TOTAL (todas as modalidades) que veio do Full. */
  shareOfPaidRevenuePct: number;
  /** % das unidades pagas TOTAIS (todas as modalidades) vendidas no Full. */
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

/**
 * Grupo genérico (Fase 4, item 4 — comparativo Full x sem Full x total):
 * mesmas 9 métricas de `AnalyticsFullSummary`, sem os percentuais de
 * participação (que só fazem sentido para o grupo Full).
 */
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
  /** "complete": todo pedido pago/cancelado do escopo já foi classificado. "partial": parte. "unknown": nenhuma prova de classificação. */
  coverage: FullClassificationCoverage;
  classifiedOrders: number;
  unclassifiedOrders: number;
  /** `null` nas MESMAS condições de `summary` no nível raiz (sem prova real de dado no escopo). */
  summary: AnalyticsFullSummary | null;
  comparison: AnalyticsFullComparison | null;
  dailySeries: AnalyticsFullDailyPoint[];
  ranking: AnalyticsFullRankingEntry[];
  /**
   * Comparativo (Fase 4, item 4) — cada grupo é independentemente `null`
   * quando não há nenhum pedido pago/cancelado com valor válido naquele
   * grupo (nunca um zero fabricado). `total` é a soma real e SEMPRE
   * calculada sem filtro de classificação — nunca afetada pelo
   * `logisticsScope` do resto do dashboard.
   */
  nonFullSummary: LogisticsGroupSummary | null;
  unknownSummary: LogisticsGroupSummary | null;
  totalSummary: LogisticsGroupSummary | null;
}
