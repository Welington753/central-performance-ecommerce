import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import {
  MonthlyRevenueGoalLookupResponseDto,
  MonthlyRevenueGoalResponseDto,
  toMonthlyRevenueGoalLookupResponse,
  toMonthlyRevenueGoalResponse,
} from './dto/monthly-revenue-goal-response.dto';
import {
  MonthlyRevenueGoalProgressResponseDto,
  toMonthlyRevenueGoalProgressResponse,
} from './dto/monthly-revenue-goal-progress-response.dto';
import { UpsertMonthlyRevenueGoalDto } from './dto/upsert-monthly-revenue-goal.dto';
import { MonthlyRevenueGoalProgressService } from './monthly-revenue-goal-progress.service';
import { MonthlyRevenueGoalsService } from './monthly-revenue-goals.service';
import {
  YearMonthQueryError,
  parseYearMonthQuery,
} from './parse-year-month-query.util';

const GOAL_CURRENCY = 'BRL';

/**
 * Meta mensal CONSOLIDADA de faturamento (Checkpoint BI-1, "Metas e
 * Ritmo") — nunca por conta/marketplace individual. Leitura para qualquer
 * usuário autenticado; criação/alteração restrita a administrador
 * (`AdminGuard`, sempre composto DEPOIS de `AccessTokenGuard`).
 */
@ApiTags('marketplace-analytics-goals')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-analytics/goals')
export class MonthlyRevenueGoalsController {
  constructor(
    private readonly goalsService: MonthlyRevenueGoalsService,
    private readonly progressService: MonthlyRevenueGoalProgressService,
  ) {}

  @Get('monthly')
  async getMonthlyGoal(
    @Query('year') yearRaw?: string,
    @Query('month') monthRaw?: string,
  ): Promise<MonthlyRevenueGoalLookupResponseDto> {
    const { year, month } = this.parseYearMonthOrThrow(yearRaw, monthRaw);
    const goal = await this.goalsService.findByYearMonth(
      year,
      month,
      GOAL_CURRENCY,
    );
    return toMonthlyRevenueGoalLookupResponse(year, month, GOAL_CURRENCY, goal);
  }

  @Put('monthly')
  @UseGuards(AdminGuard)
  async upsertMonthlyGoal(
    @Body() dto: UpsertMonthlyRevenueGoalDto,
    @CurrentUser() user?: AccessTokenPayload,
  ): Promise<MonthlyRevenueGoalResponseDto> {
    const goal = await this.goalsService.upsert({
      year: dto.year,
      month: dto.month,
      currencyId: dto.currencyId,
      // Convertido para string decimal de 2 casas AQUI, na fronteira —
      // nunca mais aritmética de ponto flutuante depois disso.
      targetAmount: dto.targetAmount.toFixed(2),
      createdByUserId: user?.sub ?? null,
    });
    return toMonthlyRevenueGoalResponse(goal);
  }

  @Get('monthly-progress')
  async getMonthlyProgress(
    @Query('year') yearRaw?: string,
    @Query('month') monthRaw?: string,
  ): Promise<MonthlyRevenueGoalProgressResponseDto> {
    const { year, month } = this.parseYearMonthOrThrow(yearRaw, monthRaw);
    const progress = await this.progressService.computeProgress(
      year,
      month,
      new Date(),
    );
    return toMonthlyRevenueGoalProgressResponse(progress);
  }

  private parseYearMonthOrThrow(
    yearRaw: string | undefined,
    monthRaw: string | undefined,
  ): { year: number; month: number } {
    try {
      return parseYearMonthQuery(yearRaw, monthRaw);
    } catch (error) {
      if (error instanceof YearMonthQueryError) {
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }
}
