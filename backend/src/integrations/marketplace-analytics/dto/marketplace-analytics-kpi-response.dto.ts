import type { Marketplace } from '../../contracts/marketplace.enum';
import type { MarketplaceAccountStatus } from '../../marketplace-accounts/marketplace-account.entity';
import type { MarketplaceFilter } from '../marketplace-filter.util';
import type { LogisticsScopeFilter } from '../logistics-scope-filter.util';
import type {
  AccountAvailability,
  SourceAvailability,
} from '../source-eligibility.util';
import type { ConsolidatedCoverageStatus } from '../consolidated-coverage.util';
import type { RefundCoverage } from '../refund-coverage.util';
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
  /**
   * Reconhecimento de `partially_refunded` (auditoria "contrato de dados",
   * Checkpoint BI-1) — aditivo, nunca somado a `grossRevenue`/
   * `cancelledRevenue` acima. `partiallyRefundedGrossAmount` é o valor BRUTO
   * (`total_amount`) anterior/independente do estorno, nunca a receita
   * líquida real (o valor efetivamente estornado não é persistido hoje).
   */
  partiallyRefundedOrders: number;
  partiallyRefundedGrossAmount: string;
  /** COMPLETE quando não há nenhum `partially_refunded` no escopo; PARTIAL quando há ao menos um (valor de estorno em si nunca disponível hoje). */
  refundCoverage: RefundCoverage;
  /**
   * Três agregados financeiros confirmados (CP2K-8B) — exibidos à parte,
   * NUNCA somados/subtraídos de `grossRevenue` acima. `shippingCost`/
   * `couponAmount` usam o mesmo conjunto de pedidos `paid` de `grossRevenue`;
   * `refundedAmount` usa `partially_refunded` (distinto de
   * `partiallyRefundedGrossAmount`, que é o `total_amount` bruto desses
   * pedidos, não o valor estornado em si). Sempre presentes (nunca
   * `undefined`) — `"0.00"` quando não há dado, nunca omitido.
   */
  shippingCost: string;
  couponAmount: string;
  refundedAmount: string;
  /**
   * "Despesas e ajustes conhecidos" (correção pós-revisão: ver relatório da
   * tarefa) — hoje soma SOMENTE `couponAmount` acima. `couponAmount` usa a
   * MESMA população `paid` de `grossRevenue` e está confirmado (comentário do
   * card existente, CP2K-8D) que ainda não é descontado do valor bruto —
   * seguro somar.
   *
   * `refundedAmount` NUNCA entra aqui: seus pedidos têm status
   * `partially_refunded`, população DISJUNTA da de `grossRevenue` (nunca
   * contam como `paid`). Não há, no código/fixtures/testes deste
   * repositório, prova de que `total_amount` desses pedidos já reflita ou
   * não o reembolso — somar arriscaria excluir a receita do pedido da base
   * E ainda descontar o reembolso (dupla penalização). Por isso
   * `refundedAmount` permanece só como indicador informativo, à parte.
   *
   * NUNCA chamado de lucro líquido/bruto — comissão, tarifas, impostos, Ads,
   * frete do vendedor e custo dos produtos ficam de fora desliberadamente.
   */
  knownAdjustmentsAmount: string;
  /** `despesas_e_ajustes_conhecidos / grossRevenue * 100` — `0` quando `grossRevenue` é zero (nunca NaN/Infinity). */
  knownAdjustmentsPctOfGrossRevenue: number;
  /** `grossRevenue - knownAdjustmentsAmount` — "resultado parcial", nunca lucro (frete do vendedor/comissão/tarifas/impostos/Ads/custo de produto ficam de fora). */
  resultAfterKnownAdjustments: string;
  /** `resultAfterKnownAdjustments / grossRevenue * 100` — `0` quando `grossRevenue` é zero. */
  marginAfterKnownAdjustmentsPct: number;
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
  /**
   * `grossRevenue` da linha / soma do MESMO `quantity * unit_price` de TODOS
   * os itens de pedidos `paid` do período (nunca só as linhas do Top
   * N/busca) — auditoria pós-revisão: o denominador precisa usar a mesma
   * expressão financeira do numerador (`totals.itemsGrossRevenueCents`,
   * já usado em `avgUnitPrice`), nunca `grossRevenue`/`total_amount` do
   * pedido, que pode divergir de `quantity * unit_price` por cupom, desconto
   * ou arredondamento. Mesma população/denominador de `unitsSharePct`.
   */
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
  /** Mesma regra de `AnalyticsTopProductBySku.grossRevenueSharePct` — ver comentário lá. */
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
  /**
   * MESMA forma de `breakdownByAccount`, mas para TODAS as contas
   * classificadas do sistema — nunca só as do filtro de escopo atual (Fase
   * 4, "cartões por conta Mercado Livre"). Consumido pelo painel "Visão
   * consolidada dos marketplaces", que sempre mostra todo mundo lado a
   * lado, igual a `breakdownByMarketplace`.
   */
  breakdownByAccountUnscoped: AccountBreakdownEntry[];
  sources: AnalyticsSourceCoverage[];
  dataCoverage: AnalyticsDataCoverage;
  lastSync: string | null;
  full: MarketplaceAnalyticsFull | null;
}
