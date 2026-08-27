import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { MarketplaceAccount } from './marketplace-account.entity';
import { MarketplaceAccountsService } from './marketplace-accounts.service';

@ApiTags('marketplace-accounts')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-accounts')
export class MarketplaceAccountsController {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
  ) {}

  @Get()
  findAll(): Promise<MarketplaceAccount[]> {
    return this.marketplaceAccountsService.findAll();
  }
}
