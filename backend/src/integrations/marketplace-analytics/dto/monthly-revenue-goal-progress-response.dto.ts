import { ApiProperty } from '@nestjs/swagger';
import { centsToDecimalString } from '../../marketplace-orders/money.util';
import type { RefundCoverage } from '../refund-coverage.util';
import type { MonthlyRevenueGoalProgress } from '../monthly-revenue-goal-progress.service';

export class MonthlyRevenueGoalDto {
  @ApiProperty()
  configured!: boolean;

  @ApiProperty({ nullable: true })
  targetAmount!: string | null;
}

export class MonthlyRevenueGoalLiveDto {
  /** "Faturamento realizado ao vivo" — pedidos pagos, PODE incluir hoje. Nunca lucro nem receita líquida de estornos. */
  @ApiProperty()
  eligibleRevenue!: string;

  /** Pode passar de 100. `null` sem meta configurada (UNAVAILABLE). */
  @ApiProperty({ nullable: true })
  achievementPercentage!: number | null;

  @ApiProperty({ nullable: true })
  remainingAmount!: string | null;
}

export class MonthlyRevenueGoalClosedDaysDto {
  @ApiProperty()
  cutoffDate!: string;

  @ApiProperty()
  daysCompleted!: number;

  @ApiProperty()
  daysInMonth!: number;

  @ApiProperty()
  revenue!: string;

  @ApiProperty({ nullable: true })
  currentDailyAverage!: string | null;

  @ApiProperty({ nullable: true })
  expectedRevenue!: string | null;

  @ApiProperty({ nullable: true })
  projectedRevenue!: string | null;

  @ApiProperty({ nullable: true })
  requiredDailyRevenue!: string | null;
}

export class MonthlyRevenueGoalRefundsDto {
  @ApiProperty()
  partiallyRefundedOrders!: number;

  @ApiProperty()
  partiallyRefundedGrossAmount!: string;

  @ApiProperty()
  coverage!: RefundCoverage;
}

export class MonthlyRevenueGoalDailyPacePointDto {
  @ApiProperty()
  day!: number;

  @ApiProperty()
  date!: string;

  @ApiProperty({ nullable: true })
  targetCumulative!: string | null;

  @ApiProperty({ nullable: true })
  realizedCumulative!: string | null;
}

/**
 * `GET /marketplace-analytics/goals/monthly-progress` (Checkpoint BI-1) —
 * meta CONSOLIDADA (nunca por conta/marketplace; ver
 * `MonthlyRevenueGoalProgressService`). Todo valor monetário é string
 * decimal (nunca float); todo KPI dependente de meta ausente sai `null`,
 * nunca `0` fingindo ser um dado medido.
 */
export class MonthlyRevenueGoalProgressResponseDto {
  @ApiProperty()
  year!: number;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  currencyId!: string;

  @ApiProperty()
  goal!: MonthlyRevenueGoalDto;

  @ApiProperty()
  live!: MonthlyRevenueGoalLiveDto;

  @ApiProperty()
  closedDays!: MonthlyRevenueGoalClosedDaysDto;

  @ApiProperty()
  refunds!: MonthlyRevenueGoalRefundsDto;

  @ApiProperty({ type: [MonthlyRevenueGoalDailyPacePointDto] })
  dailyPace!: MonthlyRevenueGoalDailyPacePointDto[];
}

function centsOrNull(value: bigint | null): string | null {
  return value === null ? null : centsToDecimalString(value);
}

export function toMonthlyRevenueGoalProgressResponse(
  data: MonthlyRevenueGoalProgress,
): MonthlyRevenueGoalProgressResponseDto {
  const dto = new MonthlyRevenueGoalProgressResponseDto();
  dto.year = data.year;
  dto.month = data.month;
  dto.currencyId = data.currencyId;

  dto.goal = {
    configured: data.goal !== null,
    targetAmount: data.goal?.targetAmount ?? null,
  };

  dto.live = {
    eligibleRevenue: centsToDecimalString(
      data.progress.live.eligibleRevenueCents,
    ),
    achievementPercentage: data.progress.live.achievementPercentage,
    remainingAmount: centsOrNull(data.progress.live.remainingAmountCents),
  };

  dto.closedDays = {
    cutoffDate: data.window.cutoffDate,
    daysCompleted: data.window.daysCompleted,
    daysInMonth: data.window.daysInMonth,
    revenue: centsToDecimalString(data.progress.closedDays.revenueCents),
    currentDailyAverage: centsOrNull(
      data.progress.closedDays.currentDailyAverageCents,
    ),
    expectedRevenue: centsOrNull(data.progress.closedDays.expectedRevenueCents),
    projectedRevenue: centsOrNull(
      data.progress.closedDays.projectedRevenueCents,
    ),
    requiredDailyRevenue: centsOrNull(
      data.progress.closedDays.requiredDailyRevenueCents,
    ),
  };

  dto.refunds = {
    partiallyRefundedOrders: data.refunds.partiallyRefundedOrders,
    partiallyRefundedGrossAmount: centsToDecimalString(
      data.refunds.partiallyRefundedGrossAmountCents,
    ),
    coverage: data.refunds.coverage,
  };

  dto.dailyPace = data.dailyPace.map((point) => ({
    day: point.day,
    date: point.date,
    targetCumulative: centsOrNull(point.targetCumulativeCents),
    realizedCumulative: centsOrNull(point.realizedCumulativeCents),
  }));

  return dto;
}
