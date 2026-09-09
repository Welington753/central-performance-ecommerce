import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { decimalStringToCents } from '../marketplace-orders/money.util';
import {
  PAID_ORDER_STATUS,
  PARTIALLY_REFUNDED_ORDER_STATUS,
} from '../marketplace-orders/order-status';
import {
  buildDailyPace,
  computeClosedDaysWindow,
  computeGoalProgress,
  monthWindowExclusiveEnd,
  type ClosedDaysWindow,
  type DailyPacePoint,
  type GoalProgressResult,
} from './goal-pace.util';
import {
  computeRefundCoverage,
  type RefundCoverage,
} from './refund-coverage.util';
import { MonthlyRevenueGoalsService } from './monthly-revenue-goals.service';
import type { MonthlyRevenueGoal } from './monthly-revenue-goal.entity';

/** Único suportado nesta fase — mesma restrição do cadastro de meta. */
const GOAL_CURRENCY = 'BRL';

export interface RefundStats {
  partiallyRefundedOrders: number;
  partiallyRefundedGrossAmountCents: bigint;
  coverage: RefundCoverage;
}

export interface MonthlyRevenueGoalProgress {
  year: number;
  month: number;
  currencyId: string;
  goal: MonthlyRevenueGoal | null;
  window: ClosedDaysWindow;
  progress: GoalProgressResult;
  dailyPace: DailyPacePoint[];
  refunds: RefundStats;
}

/**
 * Monta o progresso de meta/ritmo do mês (Checkpoint BI-1) — meta SEMPRE
 * CONSOLIDADA: as consultas abaixo NUNCA filtram por `marketplace_account_id`
 * nem por `marketplace` (design §5, "sem accountId; sem marketplace; sem
 * logisticsScope") — cobrem literalmente todo pedido persistido, de
 * qualquer conta/marketplace, diferente do isolamento por conta/marketplace
 * do endpoint `/marketplace-analytics/kpis`. Filtra só por moeda (`BRL`,
 * única suportada) — nunca soma valores de moedas diferentes como se fossem
 * a mesma.
 */
@Injectable()
export class MonthlyRevenueGoalProgressService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly goalsService: MonthlyRevenueGoalsService,
  ) {}

  async computeProgress(
    year: number,
    month: number,
    referenceNow: Date,
  ): Promise<MonthlyRevenueGoalProgress> {
    const goal = await this.goalsService.findByYearMonth(
      year,
      month,
      GOAL_CURRENCY,
    );
    const targetAmountCents = goal
      ? decimalStringToCents(goal.targetAmount)
      : null;

    const window = computeClosedDaysWindow(year, month, referenceNow);
    const monthEndExclusive = monthWindowExclusiveEnd(year, month);

    const [liveRevenueCents, closedRevenueCents, dailyRevenueCents, refunds] =
      await Promise.all([
        this.fetchRevenueCents(window.windowFromUtc, monthEndExclusive),
        this.fetchRevenueCents(
          window.windowFromUtc,
          window.windowToExclusiveUtc,
        ),
        this.fetchDailyRevenueCents(
          window.windowFromUtc,
          window.windowToExclusiveUtc,
        ),
        this.fetchRefundStats(window.windowFromUtc, monthEndExclusive),
      ]);

    const progress = computeGoalProgress({
      window,
      targetAmountCents,
      liveEligibleRevenueCents: liveRevenueCents,
      closedDaysRevenueCents: closedRevenueCents,
    });
    const dailyPace = buildDailyPace(
      year,
      month,
      window,
      targetAmountCents,
      dailyRevenueCents,
    );

    return {
      year,
      month,
      currencyId: GOAL_CURRENCY,
      goal,
      window,
      progress,
      dailyPace,
      refunds,
    };
  }

  private async fetchRevenueCents(
    fromUtc: Date,
    toExclusiveUtc: Date,
  ): Promise<bigint> {
    const [row] = await this.dataSource.query<Array<{ gross_revenue: string }>>(
      `SELECT COALESCE(SUM(total_amount), 0)::text AS gross_revenue
         FROM marketplace_orders
        WHERE status = $1
          AND currency_id = $2
          AND date_created >= $3::timestamptz
          AND date_created < $4::timestamptz`,
      [PAID_ORDER_STATUS, GOAL_CURRENCY, fromUtc, toExclusiveUtc],
    );
    return decimalStringToCents(row.gross_revenue);
  }

  private async fetchDailyRevenueCents(
    fromUtc: Date,
    toExclusiveUtc: Date,
  ): Promise<Map<number, bigint>> {
    if (fromUtc.getTime() >= toExclusiveUtc.getTime()) return new Map();

    const rows = await this.dataSource.query<
      Array<{ local_day: Date; revenue: string }>
    >(
      `SELECT (date_created AT TIME ZONE 'America/Sao_Paulo')::date AS local_day,
              SUM(total_amount)::text AS revenue
         FROM marketplace_orders
        WHERE status = $1
          AND currency_id = $2
          AND date_created >= $3::timestamptz
          AND date_created < $4::timestamptz
        GROUP BY local_day`,
      [PAID_ORDER_STATUS, GOAL_CURRENCY, fromUtc, toExclusiveUtc],
    );

    const map = new Map<number, bigint>();
    for (const row of rows) {
      map.set(row.local_day.getUTCDate(), decimalStringToCents(row.revenue));
    }
    return map;
  }

  private async fetchRefundStats(
    fromUtc: Date,
    toExclusiveUtc: Date,
  ): Promise<RefundStats> {
    const [row] = await this.dataSource.query<
      Array<{ orders: string; gross_amount: string }>
    >(
      `SELECT COUNT(*)::text AS orders,
              COALESCE(SUM(total_amount), 0)::text AS gross_amount
         FROM marketplace_orders
        WHERE status = $1
          AND currency_id = $2
          AND date_created >= $3::timestamptz
          AND date_created < $4::timestamptz`,
      [PARTIALLY_REFUNDED_ORDER_STATUS, GOAL_CURRENCY, fromUtc, toExclusiveUtc],
    );

    const partiallyRefundedOrders = Number(row.orders);
    return {
      partiallyRefundedOrders,
      partiallyRefundedGrossAmountCents: decimalStringToCents(row.gross_amount),
      coverage: computeRefundCoverage(partiallyRefundedOrders),
    };
  }
}
