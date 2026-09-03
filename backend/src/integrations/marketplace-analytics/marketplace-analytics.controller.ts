import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { InvalidKpiPeriodError } from '../marketplace-orders/period.util';
import {
  toMarketplaceAnalyticsResponse,
  type MarketplaceAnalyticsKpisResponseDto,
} from './dto/marketplace-analytics-response.dto';
import { MarketplaceAnalyticsFilterError } from './marketplace-filter.util';
import {
  MarketplaceAnalyticsService,
  type MarketplaceAnalyticsQuery,
} from './marketplace-analytics.service';

@ApiTags('marketplace-analytics')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-analytics')
export class MarketplaceAnalyticsController {
  constructor(private readonly analyticsService: MarketplaceAnalyticsService) {}

  @Get('kpis')
  async getKpis(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('marketplace') marketplace?: string,
    @Query('accountId') accountId?: string,
    @Query('allTime') allTime?: string,
  ): Promise<MarketplaceAnalyticsKpisResponseDto> {
    const query: MarketplaceAnalyticsQuery = {
      from,
      to,
      marketplace,
      accountId,
      allTime: allTime === 'true',
    };
    try {
      const aggregate = await this.analyticsService.getAggregate(query);
      return toMarketplaceAnalyticsResponse(aggregate);
    } catch (error) {
      if (
        error instanceof InvalidKpiPeriodError ||
        error instanceof MarketplaceAnalyticsFilterError
      ) {
        // A mensagem da exceção É o código fechado — nunca a query string
        // bruta recebida (Checkpoint 3: "nunca inclua query string bruta na
        // mensagem ou log").
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }
}
