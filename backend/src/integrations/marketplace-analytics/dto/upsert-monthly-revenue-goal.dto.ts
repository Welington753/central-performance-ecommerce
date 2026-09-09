import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';

export const MONTHLY_REVENUE_GOAL_MIN_YEAR = 2020;
export const MONTHLY_REVENUE_GOAL_MAX_YEAR = 2100;

/**
 * `PUT /marketplace-analytics/goals/monthly` (Checkpoint BI-1) — meta
 * mensal CONSOLIDADA, sempre `BRL` nesta fase (design "inicialmente somente
 * BRL"). `targetAmount` chega como `number` (JSON não tem tipo decimal),
 * validado com no máximo 2 casas — convertido para `numeric` só no serviço,
 * nunca aritmética de ponto flutuante depois disso.
 */
export class UpsertMonthlyRevenueGoalDto {
  @ApiProperty({
    minimum: MONTHLY_REVENUE_GOAL_MIN_YEAR,
    maximum: MONTHLY_REVENUE_GOAL_MAX_YEAR,
  })
  @IsInt()
  @Min(MONTHLY_REVENUE_GOAL_MIN_YEAR)
  @Max(MONTHLY_REVENUE_GOAL_MAX_YEAR)
  year!: number;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({ enum: ['BRL'] })
  @IsIn(['BRL'])
  currencyId!: string;

  @ApiProperty({ minimum: 0.01 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  targetAmount!: number;
}
