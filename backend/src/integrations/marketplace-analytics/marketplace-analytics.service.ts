import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import {
  CANCELLED_ORDER_STATUS,
  PAID_ORDER_STATUS,
} from '../marketplace-orders/order-status';
import { decimalStringToCents } from '../marketplace-orders/money.util';
import {
  listDaysInWindow,
  resolveKpiPeriod,
  type KpiWindows,
  type PeriodWindow,
} from '../marketplace-orders/period.util';
import type { SyncedInterval } from '../marketplace-orders/coverage-interval.util';
import {
  computeConsolidatedCoverage,
  computeSourceCoverage,
  type ConsolidatedCoverage,
  type PerSourceCoverage,
} from './consolidated-coverage.util';
import {
  MARKETPLACE_FILTER_ALL,
  parseAccountIdFilter,
  parseMarketplaceFilter,
  assertNoAccountMarketplaceConflict,
  type MarketplaceFilter,
} from './marketplace-filter.util';
import {
  bestAvailability,
  classifyAccount,
  hasProvenData,
  type AccountAvailability,
  type ClassifiedAccount,
  type SourceAvailability,
} from './source-eligibility.util';

const TOP_RANKING_LIMIT = 50;

/**
 * Checkpoint 4-B: nunca soma `total_amount` de pedidos pagos com moedas
 * diferentes no mesmo agregado — o escopo (Mercado Livre sempre BRL até
 * aqui; Amazon configurada via `AMAZON_MARKETPLACE_IDS`) deve ser
 * internamente consistente. A mensagem É o código fechado.
 */
export class MarketplaceAnalyticsCurrencyMismatchError extends Error {
  readonly code = 'CURRENCY_MISMATCH';
  constructor() {
    super('CURRENCY_MISMATCH');
  }
}

export interface AnalyticsPeriodTotals {
  grossRevenueCents: bigint;
  orders: number;
  units: number;
  cancelledOrders: number;
  distinctProducts: number;
  itemsGrossRevenueCents: bigint;
  /**
   * "Vendas brutas" (equivalente ao indicador do marketplace): pedidos pagos
   * + pedidos cancelados com valor válido (`total_amount > 0`) — nunca
   * pendentes/`unfulfillable`. Ver `fetchPeriodTotals`.
   */
  grossSalesRevenueCents: bigint;
  grossSalesOrders: number;
  grossSalesUnits: number;
  /**
   * Cancelamentos (painel "Ver cancelamentos") — TODOS os pedidos cancelados
   * do período, sem o filtro de valor válido usado em `grossSales*` acima;
   * definição própria, deliberadamente distinta da regra de cancelamento do
   * marketplace (ver tooltip do painel no frontend).
   */
  cancelledUnits: number;
  cancelledRevenueCents: bigint;
}

export interface AnalyticsAccountTotals {
  grossRevenueCents: bigint;
  orders: number;
  units: number;
}

export interface AnalyticsDailyPointRaw {
  date: string;
  grossRevenueCents: bigint;
  paidOrders: number;
  units: number;
  cancelledOrders: number;
}

export interface AnalyticsTopProductBySkuRaw {
  sku: string | null;
  title: string;
  distinctListings: number;
  units: number;
  grossRevenueCents: bigint;
}

export interface AnalyticsTopListingRaw {
  marketplace: Marketplace;
  accountId: string;
  externalItemId: string;
  variationId: string | null;
  sku: string | null;
  title: string;
  units: number;
  grossRevenueCents: bigint;
}

export interface AnalyticsAccountBreakdownRaw {
  accountId: string;
  marketplace: Marketplace;
  nickname: string | null;
  externalSellerId: string | null;
  status: ClassifiedAccount['status'];
  availability: AccountAvailability;
  totals: AnalyticsAccountTotals | null;
  lastSuccessfulSyncAt: Date | null;
}

export interface AnalyticsMarketplaceBreakdownRaw {
  marketplace: Marketplace;
  availability: SourceAvailability;
  accountsIncluded: number;
  accountsTotal: number;
  totals: AnalyticsAccountTotals | null;
  lastSuccessfulSyncAt: Date | null;
}

export interface AnalyticsSourceCoverageRaw {
  accountId: string;
  marketplace: Marketplace;
  availability: AccountAvailability;
  coverage: PerSourceCoverage;
}

export interface MarketplaceAnalyticsAggregate {
  scope: { marketplace: MarketplaceFilter; accountId: string | null };
  availability: SourceAvailability;
  currentWindow: PeriodWindow;
  previousWindow: PeriodWindow;
  current: AnalyticsPeriodTotals | null;
  previous: AnalyticsPeriodTotals | null;
  bestDay: AnalyticsDailyPointRaw | null;
  dailySeries: AnalyticsDailyPointRaw[];
  topProductsBySku: AnalyticsTopProductBySkuRaw[];
  topListings: AnalyticsTopListingRaw[];
  breakdownByMarketplace: AnalyticsMarketplaceBreakdownRaw[];
  breakdownByAccount: AnalyticsAccountBreakdownRaw[];
  sources: AnalyticsSourceCoverageRaw[];
  dataCoverage: ConsolidatedCoverage;
  lastSync: Date | null;
}

export interface MarketplaceAnalyticsQuery {
  from?: string;
  to?: string;
  marketplace?: string;
  accountId?: string;
}

/**
 * Camada de analytics multi-marketplace (Checkpoint 3, "Fundação"; Checkpoint
 * 4-B: também alimentada por pedidos Amazon). Nunca chama a rede e nunca
 * escreve em `marketplace_accounts`/`sync_runs` — é uma leitura pura sobre os
 * dados já normalizados e persistidos por
 * `MarketplaceOrdersPersistenceService` (genérico, `marketplace-orders/`,
 * usado por QUALQUER marketplace — Mercado Livre e Amazon). Trabalha sobre
 * uma LISTA de contas em vez de uma única conta — a generalização
 * multi-fonte de `MercadoLivreOrdersKpiService` (Fase 3/Checkpoint 2), que
 * continua existindo e intocado para o endpoint legado.
 */
@Injectable()
export class MarketplaceAnalyticsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
  ) {}

  async getAggregate(
    query: MarketplaceAnalyticsQuery,
    referenceNow: Date = new Date(),
  ): Promise<MarketplaceAnalyticsAggregate> {
    const marketplaceFilter = parseMarketplaceFilter(query.marketplace);
    const accountIdFilter = parseAccountIdFilter(query.accountId);
    const windows = resolveKpiPeriod(
      { from: query.from, to: query.to },
      referenceNow,
    );

    const allAccounts = await this.marketplaceAccountsService.findAll();
    const hasHistoryByAccountId = await this.fetchHasHistoryMap();

    const classifiedByAccountId = new Map<string, ClassifiedAccount>();
    for (const account of allAccounts) {
      const classified = classifyAccount({
        id: account.id,
        marketplace: account.marketplace,
        status: account.status,
        nickname: account.nickname,
        externalSellerId: account.externalSellerId,
        lastSuccessfulSyncAt: account.lastSuccessfulSyncAt,
        hasHistory: hasHistoryByAccountId.get(account.id) ?? false,
      });
      if (classified) classifiedByAccountId.set(account.id, classified);
    }

    if (accountIdFilter) {
      const matchedAccount = allAccounts.find((a) => a.id === accountIdFilter);
      if (matchedAccount) {
        assertNoAccountMarketplaceConflict(
          marketplaceFilter,
          matchedAccount.marketplace,
        );
      }
    }

    const scopedAccounts = [...classifiedByAccountId.values()].filter(
      (account) =>
        (marketplaceFilter === MARKETPLACE_FILTER_ALL ||
          account.marketplace === marketplaceFilter) &&
        (accountIdFilter === null || account.id === accountIdFilter),
    );

    const scopeAvailability = bestAvailability(
      scopedAccounts.map((a) => a.availability),
    );

    const scopedAccountIds = scopedAccounts.map((a) => a.id);
    const allClassifiedIds = [...classifiedByAccountId.values()].map(
      (a) => a.id,
    );

    // Totais por conta, para TODAS as contas classificadas do sistema
    // (nunca só as do escopo atual) — o painel por marketplace mostra
    // Mercado Livre/Amazon/Shopee independente do filtro selecionado.
    const currentTotalsByAccount = await this.fetchAccountTotals(
      allClassifiedIds,
      windows.current,
    );

    const lastSyncOf = (ids: readonly string[]): Date | null =>
      ids.reduce<Date | null>((latest, id) => {
        const account = classifiedByAccountId.get(id);
        const syncedAt = account?.lastSuccessfulSyncAt ?? null;
        if (!syncedAt) return latest;
        if (!latest || syncedAt.getTime() > latest.getTime()) return syncedAt;
        return latest;
      }, null);

    const breakdownByAccount: AnalyticsAccountBreakdownRaw[] =
      scopedAccounts.map((account) => ({
        accountId: account.id,
        marketplace: account.marketplace,
        nickname: account.nickname,
        externalSellerId: account.externalSellerId,
        status: account.status,
        availability: account.availability,
        totals: hasProvenData(account.availability)
          ? (currentTotalsByAccount.get(account.id) ?? zeroAccountTotals())
          : null,
        lastSuccessfulSyncAt: account.lastSuccessfulSyncAt,
      }));

    const accountsByMarketplace = new Map<Marketplace, ClassifiedAccount[]>();
    for (const account of classifiedByAccountId.values()) {
      const list = accountsByMarketplace.get(account.marketplace) ?? [];
      list.push(account);
      accountsByMarketplace.set(account.marketplace, list);
    }
    const rawAccountsByMarketplace = new Map<Marketplace, number>();
    for (const account of allAccounts) {
      rawAccountsByMarketplace.set(
        account.marketplace,
        (rawAccountsByMarketplace.get(account.marketplace) ?? 0) + 1,
      );
    }

    const breakdownByMarketplace: AnalyticsMarketplaceBreakdownRaw[] =
      Object.values(Marketplace).map((marketplace) => {
        const accounts = accountsByMarketplace.get(marketplace) ?? [];
        const availability = bestAvailability(
          accounts.map((a) => a.availability),
        );
        const provenIds = accounts
          .filter((a) => hasProvenData(a.availability))
          .map((a) => a.id);
        return {
          marketplace,
          availability,
          accountsIncluded: accounts.length,
          accountsTotal: rawAccountsByMarketplace.get(marketplace) ?? 0,
          totals:
            provenIds.length > 0
              ? sumAccountTotals(provenIds, currentTotalsByAccount)
              : null,
          lastSuccessfulSyncAt: lastSyncOf(accounts.map((a) => a.id)),
        };
      });

    if (!hasProvenData(scopeAvailability)) {
      return {
        scope: { marketplace: marketplaceFilter, accountId: accountIdFilter },
        availability: scopeAvailability,
        currentWindow: windows.current,
        previousWindow: windows.previous,
        current: null,
        previous: null,
        bestDay: null,
        dailySeries: [],
        topProductsBySku: [],
        topListings: [],
        breakdownByMarketplace,
        breakdownByAccount,
        sources: [],
        dataCoverage: {
          status: 'unknown',
          intervals: [],
          selectedPeriodComplete: false,
          comparisonPeriodComplete: false,
        },
        lastSync: lastSyncOf(scopedAccountIds),
      };
    }

    const [
      current,
      previous,
      dailySeries,
      topProductsBySku,
      topListings,
      sources,
    ] = await Promise.all([
      this.fetchPeriodTotals(scopedAccountIds, windows.current),
      this.fetchPeriodTotals(scopedAccountIds, windows.previous),
      this.fetchDailySeries(scopedAccountIds, windows.current),
      this.fetchTopProductsBySku(scopedAccountIds, windows.current),
      this.fetchTopListings(scopedAccountIds, windows.current),
      this.fetchSourceCoverage(scopedAccounts, windows),
    ]);

    const dataCoverage = computeConsolidatedCoverage(
      sources.map((s) => s.coverage),
    );

    return {
      scope: { marketplace: marketplaceFilter, accountId: accountIdFilter },
      availability: scopeAvailability,
      currentWindow: windows.current,
      previousWindow: windows.previous,
      current,
      previous,
      bestDay: pickBestDay(dailySeries),
      dailySeries,
      topProductsBySku,
      topListings,
      breakdownByMarketplace,
      breakdownByAccount,
      sources,
      dataCoverage,
      lastSync: lastSyncOf(scopedAccountIds),
    };
  }

  private async fetchHasHistoryMap(): Promise<Map<string, boolean>> {
    const rows = await this.dataSource.query<
      Array<{ account_id: string; has_history: boolean }>
    >(
      `SELECT
          a.id AS account_id,
          (
            EXISTS (SELECT 1 FROM marketplace_orders o WHERE o.marketplace_account_id = a.id)
            OR EXISTS (
              SELECT 1 FROM sync_runs sr
              WHERE sr.marketplace_account_id = a.id AND sr.status = 'SUCCESS'
            )
          ) AS has_history
        FROM marketplace_accounts a`,
    );
    return new Map(rows.map((row) => [row.account_id, row.has_history]));
  }

  private async fetchAccountTotals(
    accountIds: string[],
    window: PeriodWindow,
  ): Promise<Map<string, AnalyticsAccountTotals>> {
    if (accountIds.length === 0) return new Map();

    const [orderRows, itemRows] = await Promise.all([
      this.dataSource.query<
        Array<{
          marketplace_account_id: string;
          gross_revenue: string;
          orders: string;
        }>
      >(
        `SELECT
            marketplace_account_id,
            COALESCE(SUM(total_amount) FILTER (WHERE status = $3), 0)::text AS gross_revenue,
            COUNT(*) FILTER (WHERE status = $3)::text AS orders
          FROM marketplace_orders
          WHERE marketplace_account_id = ANY($1)
            AND date_created >= $2::timestamptz
            AND date_created < $4::timestamptz
          GROUP BY marketplace_account_id`,
        [accountIds, window.from, PAID_ORDER_STATUS, window.to],
      ),
      this.dataSource.query<
        Array<{ marketplace_account_id: string; units: string }>
      >(
        `SELECT o.marketplace_account_id, COALESCE(SUM(oi.quantity), 0)::text AS units
          FROM marketplace_order_items oi
          INNER JOIN marketplace_orders o ON o.id = oi.order_id
          WHERE o.marketplace_account_id = ANY($1)
            AND o.status = $2
            AND o.date_created >= $3::timestamptz
            AND o.date_created < $4::timestamptz
          GROUP BY o.marketplace_account_id`,
        [accountIds, PAID_ORDER_STATUS, window.from, window.to],
      ),
    ]);

    const unitsByAccount = new Map(
      itemRows.map((row) => [row.marketplace_account_id, row.units]),
    );

    return new Map(
      orderRows.map((row) => [
        row.marketplace_account_id,
        {
          grossRevenueCents: decimalCurrencyToCents(row.gross_revenue),
          orders: Number(row.orders),
          units: Number(unitsByAccount.get(row.marketplace_account_id) ?? '0'),
        },
      ]),
    );
  }

  private async fetchPeriodTotals(
    accountIds: string[],
    window: PeriodWindow,
  ): Promise<AnalyticsPeriodTotals> {
    if (accountIds.length === 0) return zeroPeriodTotals();

    await this.assertSingleCurrencyOrThrow(accountIds, window);

    const [orderRow] = await this.dataSource.query<
      Array<{
        gross_revenue: string;
        orders: string;
        cancelled_orders: string;
        cancelled_revenue: string;
        gross_sales_revenue: string;
        gross_sales_orders: string;
      }>
    >(
      `SELECT
          COALESCE(SUM(total_amount) FILTER (WHERE status = $3), 0)::text AS gross_revenue,
          COUNT(*) FILTER (WHERE status = $3)::text AS orders,
          COUNT(*) FILTER (WHERE status = $4)::text AS cancelled_orders,
          COALESCE(SUM(total_amount) FILTER (WHERE status = $4), 0)::text AS cancelled_revenue,
          COALESCE(SUM(total_amount) FILTER (
            WHERE status = $3 OR (status = $4 AND total_amount > 0)
          ), 0)::text AS gross_sales_revenue,
          COUNT(*) FILTER (
            WHERE status = $3 OR (status = $4 AND total_amount > 0)
          )::text AS gross_sales_orders
        FROM marketplace_orders
        WHERE marketplace_account_id = ANY($1)
          AND date_created >= $2::timestamptz
          AND date_created < $5::timestamptz`,
      [
        accountIds,
        window.from,
        PAID_ORDER_STATUS,
        CANCELLED_ORDER_STATUS,
        window.to,
      ],
    );

    const [itemRow] = await this.dataSource.query<
      Array<{
        units: string;
        items_gross_revenue: string;
        distinct_products: string;
        cancelled_units: string;
        gross_sales_units: string;
      }>
    >(
      `SELECT
          COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = $2), 0)::text AS units,
          COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE o.status = $2), 0)::text AS items_gross_revenue,
          (COUNT(DISTINCT
            CASE WHEN NULLIF(UPPER(TRIM(oi.seller_sku)), '') IS NOT NULL
                 THEN 'sku:' || UPPER(TRIM(oi.seller_sku))
                 ELSE 'fallback:' || ma.marketplace || ':' || o.marketplace_account_id || ':' ||
                      oi.external_item_id || ':' || COALESCE(oi.variation_id, '')
            END
          ) FILTER (WHERE o.status = $2))::text AS distinct_products,
          COALESCE(SUM(oi.quantity) FILTER (WHERE o.status = $5), 0)::text AS cancelled_units,
          COALESCE(SUM(oi.quantity) FILTER (
            WHERE o.status = $2 OR (o.status = $5 AND o.total_amount > 0)
          ), 0)::text AS gross_sales_units
        FROM marketplace_order_items oi
        INNER JOIN marketplace_orders o ON o.id = oi.order_id
        INNER JOIN marketplace_accounts ma ON ma.id = o.marketplace_account_id
        WHERE o.marketplace_account_id = ANY($1)
          AND o.status IN ($2, $5)
          AND o.date_created >= $3::timestamptz
          AND o.date_created < $4::timestamptz`,
      [
        accountIds,
        PAID_ORDER_STATUS,
        window.from,
        window.to,
        CANCELLED_ORDER_STATUS,
      ],
    );

    return {
      grossRevenueCents: decimalCurrencyToCents(orderRow.gross_revenue),
      orders: Number(orderRow.orders),
      cancelledOrders: Number(orderRow.cancelled_orders),
      units: Number(itemRow.units),
      itemsGrossRevenueCents: decimalCurrencyToCents(
        itemRow.items_gross_revenue,
      ),
      distinctProducts: Number(itemRow.distinct_products),
      grossSalesRevenueCents: decimalCurrencyToCents(
        orderRow.gross_sales_revenue,
      ),
      grossSalesOrders: Number(orderRow.gross_sales_orders),
      grossSalesUnits: Number(itemRow.gross_sales_units),
      cancelledUnits: Number(itemRow.cancelled_units),
      cancelledRevenueCents: decimalCurrencyToCents(orderRow.cancelled_revenue),
    };
  }

  /**
   * Checkpoint 4-B: lança `MarketplaceAnalyticsCurrencyMismatchError` quando
   * o escopo (contas + janela) inclui pedidos pagos em MAIS de uma moeda —
   * nunca soma valores de moedas diferentes como se fossem a mesma. Sem
   * pedidos pagos no escopo, ou com uma única moeda, é um no-op.
   */
  private async assertSingleCurrencyOrThrow(
    accountIds: string[],
    window: PeriodWindow,
  ): Promise<void> {
    if (accountIds.length === 0) return;

    const rows = await this.dataSource.query<Array<{ currency_id: string }>>(
      `SELECT DISTINCT currency_id
        FROM marketplace_orders
        WHERE marketplace_account_id = ANY($1)
          AND status = $2
          AND date_created >= $3::timestamptz
          AND date_created < $4::timestamptz`,
      [accountIds, PAID_ORDER_STATUS, window.from, window.to],
    );

    if (rows.length > 1) {
      throw new MarketplaceAnalyticsCurrencyMismatchError();
    }
  }

  /**
   * Ranking consolidado por SKU MULTI-MARKETPLACE (Checkpoint 3, "SKU
   * multi-marketplace"): chave canônica `UPPER(TRIM(seller_sku))` — funde o
   * mesmo SKU entre contas e marketplaces diferentes, mas NUNCA confunde a
   * letra `O` com o dígito `0` (nenhuma correção ortográfica é aplicada).
   * Sem SKU, o fallback inclui marketplace + conta + anúncio + variação —
   * nunca mistura anúncios sem SKU de contas/marketplaces diferentes.
   */
  private async fetchTopProductsBySku(
    accountIds: string[],
    window: PeriodWindow,
  ): Promise<AnalyticsTopProductBySkuRaw[]> {
    if (accountIds.length === 0) return [];

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
            NULLIF(TRIM(oi.seller_sku), '') AS display_sku,
            NULLIF(UPPER(TRIM(oi.seller_sku)), '') AS canonical_sku,
            ma.marketplace,
            o.marketplace_account_id,
            o.date_created
          FROM marketplace_order_items oi
          INNER JOIN marketplace_orders o ON o.id = oi.order_id
          INNER JOIN marketplace_accounts ma ON ma.id = o.marketplace_account_id
          WHERE o.marketplace_account_id = ANY($1)
            AND o.status = $2
            AND o.date_created >= $3::timestamptz
            AND o.date_created < $4::timestamptz
        )
        SELECT
          (array_agg(display_sku ORDER BY date_created DESC))[1] AS sku,
          (array_agg(title ORDER BY date_created DESC))[1] AS title,
          COUNT(DISTINCT marketplace || ':' || marketplace_account_id || ':' ||
                external_item_id || ':' || COALESCE(variation_id, ''))::text AS distinct_listings,
          SUM(quantity)::text AS units,
          SUM(quantity * unit_price)::text AS gross_revenue
        FROM normalized
        GROUP BY COALESCE(
          canonical_sku,
          'fallback:' || marketplace || ':' || marketplace_account_id || ':' ||
            external_item_id || ':' || COALESCE(variation_id, '')
        )
        ORDER BY SUM(quantity * unit_price) DESC
        LIMIT $5`,
      [
        accountIds,
        PAID_ORDER_STATUS,
        window.from,
        window.to,
        TOP_RANKING_LIMIT,
      ],
    );

    return rows.map((row) => ({
      sku: row.sku,
      title: row.title,
      distinctListings: Number(row.distinct_listings),
      units: Number(row.units),
      grossRevenueCents: decimalCurrencyToCents(row.gross_revenue),
    }));
  }

  private async fetchTopListings(
    accountIds: string[],
    window: PeriodWindow,
  ): Promise<AnalyticsTopListingRaw[]> {
    if (accountIds.length === 0) return [];

    const rows = await this.dataSource.query<
      Array<{
        marketplace: Marketplace;
        marketplace_account_id: string;
        external_item_id: string;
        variation_id: string | null;
        sku: string | null;
        title: string;
        units: string;
        gross_revenue: string;
      }>
    >(
      `SELECT
          ma.marketplace,
          o.marketplace_account_id,
          oi.external_item_id,
          oi.variation_id,
          (array_agg(NULLIF(TRIM(oi.seller_sku), '') ORDER BY o.date_created DESC))[1] AS sku,
          (array_agg(oi.title ORDER BY o.date_created DESC))[1] AS title,
          SUM(oi.quantity)::text AS units,
          SUM(oi.quantity * oi.unit_price)::text AS gross_revenue
        FROM marketplace_order_items oi
        INNER JOIN marketplace_orders o ON o.id = oi.order_id
        INNER JOIN marketplace_accounts ma ON ma.id = o.marketplace_account_id
        WHERE o.marketplace_account_id = ANY($1)
          AND o.status = $2
          AND o.date_created >= $3::timestamptz
          AND o.date_created < $4::timestamptz
        GROUP BY ma.marketplace, o.marketplace_account_id, oi.external_item_id, oi.variation_id
        ORDER BY SUM(oi.quantity * oi.unit_price) DESC
        LIMIT $5`,
      [
        accountIds,
        PAID_ORDER_STATUS,
        window.from,
        window.to,
        TOP_RANKING_LIMIT,
      ],
    );

    return rows.map((row) => ({
      marketplace: row.marketplace,
      accountId: row.marketplace_account_id,
      externalItemId: row.external_item_id,
      variationId: row.variation_id,
      sku: row.sku,
      title: row.title,
      units: Number(row.units),
      grossRevenueCents: decimalCurrencyToCents(row.gross_revenue),
    }));
  }

  private async fetchDailySeries(
    accountIds: string[],
    window: PeriodWindow,
  ): Promise<AnalyticsDailyPointRaw[]> {
    const days = listDaysInWindow(window);
    if (accountIds.length === 0) {
      return days.map((date) => ({
        date,
        grossRevenueCents: 0n,
        paidOrders: 0,
        units: 0,
        cancelledOrders: 0,
      }));
    }

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
          WHERE marketplace_account_id = ANY($1)
            AND date_created >= $2::timestamptz
            AND date_created < $3::timestamptz
          GROUP BY day_index`,
        [
          accountIds,
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
          WHERE o.marketplace_account_id = ANY($1)
            AND o.status = $4
            AND o.date_created >= $2::timestamptz
            AND o.date_created < $3::timestamptz
          GROUP BY day_index`,
        [accountIds, window.from, window.to, PAID_ORDER_STATUS],
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

  private async fetchSourceCoverage(
    accounts: readonly ClassifiedAccount[],
    windows: KpiWindows,
  ): Promise<AnalyticsSourceCoverageRaw[]> {
    if (accounts.length === 0) return [];
    const accountIds = accounts.map((a) => a.id);

    const rows = await this.dataSource.query<
      Array<{ marketplace_account_id: string; date_from: Date; date_to: Date }>
    >(
      `SELECT marketplace_account_id, date_from, date_to
        FROM sync_runs
        WHERE marketplace_account_id = ANY($1)
          AND status = 'SUCCESS'
          AND date_from IS NOT NULL
          AND date_to IS NOT NULL`,
      [accountIds],
    );

    const runsByAccount = new Map<string, SyncedInterval[]>();
    for (const row of rows) {
      const list = runsByAccount.get(row.marketplace_account_id) ?? [];
      list.push({ from: row.date_from, to: row.date_to });
      runsByAccount.set(row.marketplace_account_id, list);
    }

    return accounts.map((account) => ({
      accountId: account.id,
      marketplace: account.marketplace,
      availability: account.availability,
      coverage: computeSourceCoverage(
        runsByAccount.get(account.id) ?? [],
        windows.current,
        windows.previous,
      ),
    }));
  }
}

function decimalCurrencyToCents(value: string): bigint {
  const normalized = value.includes('.') ? value : `${value}.00`;
  return decimalStringToCents(normalized);
}

function zeroPeriodTotals(): AnalyticsPeriodTotals {
  return {
    grossRevenueCents: 0n,
    orders: 0,
    units: 0,
    cancelledOrders: 0,
    distinctProducts: 0,
    itemsGrossRevenueCents: 0n,
    grossSalesRevenueCents: 0n,
    grossSalesOrders: 0,
    grossSalesUnits: 0,
    cancelledUnits: 0,
    cancelledRevenueCents: 0n,
  };
}

function zeroAccountTotals(): AnalyticsAccountTotals {
  return { grossRevenueCents: 0n, orders: 0, units: 0 };
}

function sumAccountTotals(
  accountIds: readonly string[],
  totalsByAccount: Map<string, AnalyticsAccountTotals>,
): AnalyticsAccountTotals {
  return accountIds.reduce<AnalyticsAccountTotals>((sum, id) => {
    const totals = totalsByAccount.get(id) ?? zeroAccountTotals();
    return {
      grossRevenueCents: sum.grossRevenueCents + totals.grossRevenueCents,
      orders: sum.orders + totals.orders,
      units: sum.units + totals.units,
    };
  }, zeroAccountTotals());
}

function pickBestDay(
  dailySeries: readonly AnalyticsDailyPointRaw[],
): AnalyticsDailyPointRaw | null {
  let best: AnalyticsDailyPointRaw | null = null;
  for (const day of dailySeries) {
    if (day.grossRevenueCents <= 0n) continue;
    if (best === null || day.grossRevenueCents > best.grossRevenueCents) {
      best = day;
    }
  }
  return best;
}
