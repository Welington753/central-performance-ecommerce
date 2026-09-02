import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  ): Promise<MercadoLivreKpisResponseDto> {
    const account = await this.marketplaceAccountsService.findByIdOrFail(id);
    const aggregate = await this.kpiService.getAggregate(id);

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
}
