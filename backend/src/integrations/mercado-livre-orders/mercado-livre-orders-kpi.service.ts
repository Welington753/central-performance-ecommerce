import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { decimalStringToCents } from './money.util';
import { PAID_ORDER_STATUS } from './mercado-livre-order-status';
import { computeKpiWindows, type PeriodWindow } from './period.util';

const TOP_PRODUCTS_LIMIT = 10;

export interface KpiPeriodSummary {
  grossRevenueCents: bigint;
  orders: number;
  units: number;
}

export interface TopProductAggregate {
  sku: string | null;
  title: string;
  units: number;
  grossRevenueCents: bigint;
}

export interface OrdersKpiAggregate {
  currentWindow: PeriodWindow;
  previousWindow: PeriodWindow;
  current: KpiPeriodSummary;
  previous: KpiPeriodSummary;
  topProducts: TopProductAggregate[];
}

/**
 * Toda agregação de KPI considera EXCLUSIVAMENTE pedidos com
 * `status = 'paid'` (design "Definições dos KPIs") — um pedido que estava
 * pago e depois vira `cancelled` numa sincronização futura some
 * automaticamente destas somas, porque a query sempre lê o `status` ATUAL
 * da linha, nunca um histórico.
 */
@Injectable()
export class MercadoLivreOrdersKpiService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getAggregate(
    accountId: string,
    referenceNow: Date = new Date(),
  ): Promise<OrdersKpiAggregate> {
    const { current: currentWindow, previous: previousWindow } =
      computeKpiWindows(referenceNow);

    const [current, previous, topProducts] = await Promise.all([
      this.computePeriodSummary(accountId, currentWindow),
      this.computePeriodSummary(accountId, previousWindow),
      this.computeTopProducts(accountId, currentWindow),
    ]);

    return { currentWindow, previousWindow, current, previous, topProducts };
  }

  private async computePeriodSummary(
    accountId: string,
    window: PeriodWindow,
  ): Promise<KpiPeriodSummary> {
    const [ordersRow] = await this.dataSource.query<
      Array<{ gross_revenue: string; orders: string }>
    >(
      `SELECT
          COALESCE(SUM(total_amount), 0)::text AS gross_revenue,
          COUNT(*)::text AS orders
        FROM marketplace_orders
        WHERE marketplace_account_id = $1
          AND status = $2
          AND date_created >= $3
          AND date_created < $4`,
      [accountId, PAID_ORDER_STATUS, window.from, window.to],
    );

    const [unitsRow] = await this.dataSource.query<Array<{ units: string }>>(
      `SELECT COALESCE(SUM(oi.quantity), 0)::text AS units
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
      units: Number(unitsRow.units),
    };
  }

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
