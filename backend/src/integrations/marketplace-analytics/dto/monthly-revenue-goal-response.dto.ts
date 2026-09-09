import { ApiProperty } from '@nestjs/swagger';
import type { MonthlyRevenueGoal } from '../monthly-revenue-goal.entity';

/**
 * Nunca inclui `createdByUserId` bruto — expor "quem criou" não é pedido
 * pelo design deste checkpoint e evitaria vazar um UUID de usuário sem
 * necessidade.
 */
export class MonthlyRevenueGoalResponseDto {
  @ApiProperty()
  year!: number;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  currencyId!: string;

  @ApiProperty()
  targetAmount!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/**
 * `GET /marketplace-analytics/goals/monthly` — `configured: false` quando
 * não existe meta para o ano/mês/moeda pedido; nenhum `targetAmount`
 * inventado nesse caso (nunca `0`).
 */
export class MonthlyRevenueGoalLookupResponseDto {
  @ApiProperty()
  configured!: boolean;

  @ApiProperty()
  year!: number;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  currencyId!: string;

  @ApiProperty({ nullable: true })
  targetAmount!: string | null;

  @ApiProperty({ nullable: true })
  createdAt!: string | null;

  @ApiProperty({ nullable: true })
  updatedAt!: string | null;
}

export function toMonthlyRevenueGoalLookupResponse(
  year: number,
  month: number,
  currencyId: string,
  goal: MonthlyRevenueGoal | null,
): MonthlyRevenueGoalLookupResponseDto {
  const dto = new MonthlyRevenueGoalLookupResponseDto();
  dto.configured = goal !== null;
  dto.year = year;
  dto.month = month;
  dto.currencyId = currencyId;
  dto.targetAmount = goal?.targetAmount ?? null;
  dto.createdAt = goal ? goal.createdAt.toISOString() : null;
  dto.updatedAt = goal ? goal.updatedAt.toISOString() : null;
  return dto;
}

export function toMonthlyRevenueGoalResponse(
  goal: MonthlyRevenueGoal,
): MonthlyRevenueGoalResponseDto {
  const dto = new MonthlyRevenueGoalResponseDto();
  dto.year = goal.year;
  dto.month = goal.month;
  dto.currencyId = goal.currencyId;
  dto.targetAmount = goal.targetAmount;
  dto.createdAt = goal.createdAt.toISOString();
  dto.updatedAt = goal.updatedAt.toISOString();
  return dto;
}
