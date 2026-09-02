import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import {
  toMercadoLivreKpisResponse,
  type MercadoLivreKpisResponseDto,
} from './dto/mercado-livre-kpis-response.dto';
import { MercadoLivreOrdersKpiService } from './mercado-livre-orders-kpi.service';
import {
  InvalidKpiPeriodError,
  resolveKpiPeriod,
} from '../marketplace-orders/period.util';

@ApiTags('mercado-livre-orders')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-accounts/:id/mercado-livre')
export class MercadoLivreOrdersKpisController {
  constructor(
    private readonly kpiService: MercadoLivreOrdersKpiService,
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
  ) {}

  @Get('kpis')
  async getKpis(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<MercadoLivreKpisResponseDto> {
    const windows = this.resolvePeriodOrThrow(from, to);
    const account = await this.marketplaceAccountsService.findByIdOrFail(id);
    const aggregate = await this.kpiService.getAggregate(id, windows);

    return toMercadoLivreKpisResponse({
      account: {
        id: account.id,
        externalSellerId: account.externalSellerId,
        nickname: account.nickname,
      },
      aggregate,
      lastSync: account.lastSuccessfulSyncAt,
    });
  }

  /**
   * Checkpoint 2 ("Filtro por data") — a mensagem do 400 É o código fechado
   * de `KpiPeriodErrorCode`, nunca a query string bruta recebida.
   */
  private resolvePeriodOrThrow(from?: string, to?: string) {
    try {
      return resolveKpiPeriod({ from, to }, new Date());
    } catch (error) {
      if (error instanceof InvalidKpiPeriodError) {
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }
}
