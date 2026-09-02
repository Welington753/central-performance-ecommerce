import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Marketplace } from '../contracts/marketplace.enum';
import { decimalStringToCents } from './money.util';
import {
  CANCELLED_ORDER_STATUS,
  PAID_ORDER_STATUS,
} from './mercado-livre-order-status';
import {
  listDaysInWindow,
  type KpiWindows,
  type PeriodWindow,
} from './period.util';
import { computeDataCoverage, type DataCoverage } from './sync-coverage.util';

const TOP_PRODUCTS_LIMIT = 10;
const TOP_RANKING_LIMIT = 50;

export interface KpiPeriodSummary {
  grossRevenueCents: bigint;
  orders: number;
  units: number;
  cancelledOrders: number;
  distinctProducts: number;
  itemsGrossRevenueCents: bigint;
}

export interface TopProductAggregate {
  sku: string | null;
  title: string;
  units: number;
  grossRevenueCents: bigint;
}

export interface TopProductBySkuAggregate {
  sku: string | null;
  title: string;
  distinctListings: number;
  units: number;
  grossRevenueCents: bigint;
}

export interface TopListingAggregate {
  externalItemId: string;
  variationId: string | null;
  sku: string | null;
  title: string;
  units: number;
  grossRevenueCents: bigint;
}

export interface DailyPoint {
  date: string;
  grossRevenueCents: bigint;
  paidOrders: number;
  units: number;
  cancelledOrders: number;
}

export interface OrdersKpiAggregate {
  currentWindow: PeriodWindow;
  previousWindow: PeriodWindow;
  current: KpiPeriodSummary;
  previous: KpiPeriodSummary;
  topProducts: TopProductAggregate[];
  topProductsBySku: TopProductBySkuAggregate[];
  topListings: TopListingAggregate[];
  dailySeries: DailyPoint[];
  bestDay: DailyPoint | null;
  dataCoverage: DataCoverage;
}

/**
 * Toda agregação de KPI considera EXCLUSIVAMENTE pedidos com
 * `status = 'paid'` para faturamento/unidades (design "Definições dos
 * KPIs") — um pedido que estava pago e depois vira `cancelled` numa
 * sincronização futura some automaticamente destas somas, porque a query
 * sempre lê o `status` ATUAL da linha, nunca um histórico. `cancelled` só
 * entra na contagem de cancelamentos (Checkpoint 2), nunca em
 * faturamento/unidades.
 */
@Injectable()
export class MercadoLivreOrdersKpiService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getAggregate(
    accountId: string,
    windows: KpiWindows,
  ): Promise<OrdersKpiAggregate> {
    const { current: currentWindow, previous: previousWindow } = windows;

    const [
      current,
      previous,
      topProducts,
      topProductsBySku,
      topListings,
      dailySeries,
      dataCoverage,
    ] = await Promise.all([
      this.computePeriodSummary(accountId, currentWindow),
      this.computePeriodSummary(accountId, previousWindow),
      this.computeTopProducts(accountId, currentWindow),
      this.computeTopProductsBySku(accountId, currentWindow),
      this.computeTopListings(accountId, currentWindow),
      this.computeDailySeries(accountId, currentWindow),
      this.computeDataCoverage(accountId, currentWindow, previousWindow),
    ]);

    const bestDay = pickBestDay(dailySeries);

    return {
      currentWindow,
      previousWindow,
      current,
      previous,
      topProducts,
      topProductsBySku,
      topListings,
      dailySeries,
      bestDay,
      dataCoverage,
    };
  }

  private async computePeriodSummary(
    accountId: string,
    window: PeriodWindow,
  ): Promise<KpiPeriodSummary> {
    const [ordersRow] = await this.dataSource.query<
      Array<{ gross_revenue: string; orders: string; cancelled_orders: string }>
    >(
      `SELECT
          COALESCE(SUM(total_amount) FILTER (WHERE status = $2), 0)::text AS gross_revenue,
          COUNT(*) FILTER (WHERE status = $2)::text AS orders,
          COUNT(*) FILTER (WHERE status = $5)::text AS cancelled_orders
        FROM marketplace_orders
        WHERE marketplace_account_id = $1
          AND date_created >= $3
          AND date_created < $4`,
      [
        accountId,
        PAID_ORDER_STATUS,
        window.from,
        window.to,
        CANCELLED_ORDER_STATUS,
      ],
    );

    const [itemsRow] = await this.dataSource.query<
      Array<{
        units: string;
        items_gross_revenue: string;
        distinct_products: string;
      }>
    >(
      `SELECT
          COALESCE(SUM(oi.quantity), 0)::text AS units,
          COALESCE(SUM(oi.quantity * oi.unit_price), 0)::text AS items_gross_revenue,
          COUNT(DISTINCT
            CASE WHEN NULLIF(TRIM(oi.seller_sku), '') IS NOT NULL
                 THEN 'sku:' || TRIM(oi.seller_sku)
                 ELSE 'fallback:' || oi.external_item_id || ':' || COALESCE(oi.variation_id, '')
            END
          )::text AS distinct_products
        FROM marketplace_order_items oi
        INNER JOIN marketplace_orders o ON o.id = oi.order_id
        WHERE o.marketplace_account_id = $1
          AND o.status = $2
          AND o.date_created >= $3
          AND o.date_created < $4`,
      [accountId, PAID_ORDER_STATUS, window.from, window.to],
    );

    return {
      grossRevenueCents: decimalCurrencyToCents(ordersRow.gross_revenue),
      orders: Number(ordersRow.orders),
      cancelledOrders: Number(ordersRow.cancelled_orders),
      units: Number(itemsRow.units),
      itemsGrossRevenueCents: decimalCurrencyToCents(
        itemsRow.items_gross_revenue,
      ),
      distinctProducts: Number(itemsRow.distinct_products),
    };
  }

  /**
   * Ranking legado (Fase 3 original) — agrupa por
   * `(external_item_id, variation_id, seller_sku)`, então um mesmo SKU
   * vendido em mais de um anúncio aparece em mais de uma linha. Mantido
   * inalterado para preservar o contrato existente; a consolidação real por
   * SKU está em `computeTopProductsBySku` (Checkpoint 2).
   */
  private async computeTopProducts(
    accountId: string,
    window: PeriodWindow,
  ): Promise<TopProductAggregate[]> {
    const rows = await this.dataSource.query<
      Array<{
        sku: string | null;
        title: string;
        units: string;
        gross_revenue: string;
      }>
    >(
      `SELECT
          oi.seller_sku AS sku,
          MAX(oi.title) AS title,
          SUM(oi.quantity)::text AS units,
          SUM(oi.quantity * oi.unit_price)::text AS gross_revenue
        FROM marketplace_order_items oi
        INNER JOIN marketplace_orders o ON o.id = oi.order_id
        WHERE o.marketplace_account_id = $1
          AND o.status = $2
          AND o.date_created >= $3
          AND o.date_created < $4
        GROUP BY oi.external_item_id, oi.variation_id, oi.seller_sku
        ORDER BY SUM(oi.quantity * oi.unit_price) DESC
        LIMIT $5`,
      [
        accountId,
        PAID_ORDER_STATUS,
        window.from,
        window.to,
        TOP_PRODUCTS_LIMIT,
      ],
    );

    return rows.map((row) => ({
      sku: row.sku,
      title: row.title,
      units: Number(row.units),
      grossRevenueCents: decimalCurrencyToCents(row.gross_revenue),
    }));
  }

  /**
   * Ranking consolidado por SKU (Checkpoint 2, "Ranking por SKU — aba Por
   * SKU"): um mesmo SKU normalizado (espaços externos removidos) nunca
   * aparece em mais de uma linha, não importa em quantos anúncios diferentes
   * ele foi vendido. Sem SKU, usa a chave técnica de fallback
   * `externalItemId + variationId` — que nunca mistura produtos diferentes,
   * porque cada anúncio+variação vira seu próprio grupo.
   */
  private async computeTopProductsBySku(
    accountId: string,
    window: PeriodWindow,
  ): Promise<TopProductBySkuAggregate[]> {
    const rows = await this.dataSource.query<
      Array<{
        sku: string | null;
        title: string;
        distinct_listings: string;
        units: string;
        gross_revenue: string;
      }>
    >(
      `WITH normalized AS (
          SELECT
            oi.title,
            oi.quantity,
            oi.unit_price,
            oi.external_item_id,
            oi.variation_id,
            NULLIF(TRIM(oi.seller_sku), '') AS normalized_sku,
            o.date_created
          FROM marketplace_order_items oi
          INNER JOIN marketplace_orders o ON o.id = oi.order_id
          WHERE o.marketplace_account_id = $1
            AND o.status = $2
            AND o.date_created >= $3
            AND o.date_created < $4
        )
        SELECT
          MAX(normalized_sku) AS sku,
          (array_agg(title ORDER BY date_created DESC))[1] AS title,
          COUNT(DISTINCT external_item_id || ':' || COALESCE(variation_id, ''))::text AS distinct_listings,
          SUM(quantity)::text AS units,
          SUM(quantity * unit_price)::text AS gross_revenue
        FROM normalized
        GROUP BY COALESCE(normalized_sku, 'fallback:' || external_item_id || ':' || COALESCE(variation_id, ''))
        ORDER BY SUM(quantity * unit_price) DESC
        LIMIT $5`,
      [accountId, PAID_ORDER_STATUS, window.from, window.to, TOP_RANKING_LIMIT],
    );

    return rows.map((row) => ({
      sku: row.sku,
      title: row.title,
      distinctListings: Number(row.distinct_listings),
      units: Number(row.units),
      grossRevenueCents: decimalCurrencyToCents(row.gross_revenue),
    }));
  }

  /**
   * Ranking por anúncio (Checkpoint 2, "aba Por anúncio") — agrupa por
   * `externalItemId + variationId`, nunca consolidando SKUs iguais entre
   * anúncios diferentes. Não expõe nenhum dado de pedido além do resumo
   * agregado (nunca comprador, nunca `orderId`).
   */
  private async computeTopListings(
    accountId: string,
    window: PeriodWindow,
  ): Promise<TopListingAggregate[]> {
    const rows = await this.dataSource.query<
      Array<{
        external_item_id: string;
        variation_id: string | null;
        sku: string | null;
        title: string;
        units: string;
        gross_revenue: string;
      }>
    >(
      `SELECT
          oi.external_item_id,
          oi.variation_id,
          (array_agg(NULLIF(TRIM(oi.seller_sku), '') ORDER BY o.date_created DESC))[1] AS sku,
          (array_agg(oi.title ORDER BY o.date_created DESC))[1] AS title,
          SUM(oi.quantity)::text AS units,
          SUM(oi.quantity * oi.unit_price)::text AS gross_revenue
        FROM marketplace_order_items oi
        INNER JOIN marketplace_orders o ON o.id = oi.order_id
        WHERE o.marketplace_account_id = $1
          AND o.status = $2
          AND o.date_created >= $3
          AND o.date_created < $4
        GROUP BY oi.external_item_id, oi.variation_id
        ORDER BY SUM(oi.quantity * oi.unit_price) DESC
        LIMIT $5`,
      [accountId, PAID_ORDER_STATUS, window.from, window.to, TOP_RANKING_LIMIT],
    );

    return rows.map((row) => ({
      externalItemId: row.external_item_id,
      variationId: row.variation_id,
      sku: row.sku,
      title: row.title,
      units: Number(row.units),
      grossRevenueCents: decimalCurrencyToCents(row.gross_revenue),
    }));
  }

  /**
   * Série diária (Checkpoint 2, "Evolução diária") — um ponto para CADA dia
   * do período, inclusive dias sem venda. O agrupamento por dia usa um
   * índice inteiro relativo ao início da janela (já alinhado à meia-noite de
   * `America/Sao_Paulo` por `resolveKpiPeriod`), nunca `AT TIME ZONE` do
   * Postgres — mesma premissa de deslocamento fixo (-03:00, sem horário de
   * verão desde 2019) usada em todo `period.util.ts`.
   */
  private async computeDailySeries(
    accountId: string,
    window: PeriodWindow,
  ): Promise<DailyPoint[]> {
    const days = listDaysInWindow(window);

    const [ordersRows, itemsRows] = await Promise.all([
      this.dataSource.query<
        Array<{
          day_index: number;
          gross_revenue: string;
          paid_orders: string;
          cancelled_orders: string;
        }>
      >(
        `SELECT
            floor(extract(epoch FROM (date_created - $2::timestamptz)) / 86400)::int AS day_index,
            COALESCE(SUM(total_amount) FILTER (WHERE status = $4), 0)::text AS gross_revenue,
            COUNT(*) FILTER (WHERE status = $4)::text AS paid_orders,
            COUNT(*) FILTER (WHERE status = $5)::text AS cancelled_orders
          FROM marketplace_orders
          WHERE marketplace_account_id = $1
            AND date_created >= $2
            AND date_created < $3
          GROUP BY day_index`,
        [
          accountId,
          window.from,
          window.to,
          PAID_ORDER_STATUS,
          CANCELLED_ORDER_STATUS,
        ],
      ),
      this.dataSource.query<Array<{ day_index: number; units: string }>>(
        `SELECT
            floor(extract(epoch FROM (o.date_created - $2::timestamptz)) / 86400)::int AS day_index,
            COALESCE(SUM(oi.quantity), 0)::text AS units
          FROM marketplace_order_items oi
          INNER JOIN marketplace_orders o ON o.id = oi.order_id
          WHERE o.marketplace_account_id = $1
            AND o.status = $4
            AND o.date_created >= $2
            AND o.date_created < $3
          GROUP BY day_index`,
        [accountId, window.from, window.to, PAID_ORDER_STATUS],
      ),
    ]);

    const ordersByDay = new Map(ordersRows.map((row) => [row.day_index, row]));
    const unitsByDay = new Map(itemsRows.map((row) => [row.day_index, row]));

    return days.map((date, index) => {
      const ordersRow = ordersByDay.get(index);
      const unitsRow = unitsByDay.get(index);
      return {
        date,
        grossRevenueCents: ordersRow
          ? decimalCurrencyToCents(ordersRow.gross_revenue)
          : 0n,
        paidOrders: ordersRow ? Number(ordersRow.paid_orders) : 0,
        units: unitsRow ? Number(unitsRow.units) : 0,
        cancelledOrders: ordersRow ? Number(ordersRow.cancelled_orders) : 0,
      };
    });
  }

  private async computeDataCoverage(
    accountId: string,
    currentWindow: PeriodWindow,
    previousWindow: PeriodWindow,
  ): Promise<DataCoverage> {
    const rows = await this.dataSource.query<
      Array<{ date_from: Date; date_to: Date }>
    >(
      `SELECT date_from, date_to
        FROM sync_runs
        WHERE marketplace_account_id = $1
          AND marketplace = $2
          AND status = 'SUCCESS'
          AND date_from IS NOT NULL
          AND date_to IS NOT NULL`,
      [accountId, Marketplace.MERCADO_LIVRE],
    );

    return computeDataCoverage(
      rows.map((row) => ({ from: row.date_from, to: row.date_to })),
      currentWindow,
      previousWindow,
    );
  }
}

/**
 * `decimalStringToCents` (`money.util.ts`) espera exatamente 2 casas
 * decimais — verdade para colunas `numeric(14,2)` lidas diretamente, mas o
 * `::text` de um `SUM(...)` sem linhas casadas por `COALESCE(..., 0)` pode
 * devolver `"0"` sem casas decimais. Este helper local normaliza antes de
 * delegar à função compartilhada.
 */
function decimalCurrencyToCents(value: string): bigint {
  const normalized = value.includes('.') ? value : `${value}.00`;
  return decimalStringToCents(normalized);
}

/**
 * Melhor dia do período (Checkpoint 2): o dia de maior faturamento bruto.
 * `null` quando não houve nenhuma venda no período inteiro — nunca um dia
 * "vencedor" com faturamento zero.
 */
function pickBestDay(dailySeries: DailyPoint[]): DailyPoint | null {
  let best: DailyPoint | null = null;
  for (const day of dailySeries) {
    if (day.grossRevenueCents <= 0n) continue;
    if (best === null || day.grossRevenueCents > best.grossRevenueCents) {
      best = day;
    }
  }
  return best;
}
