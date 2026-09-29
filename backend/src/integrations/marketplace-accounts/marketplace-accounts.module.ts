import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccount } from './marketplace-account.entity';
import { MarketplaceAccountsController } from './marketplace-accounts.controller';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { ScopedMarketplaceAccountService } from './scoped-marketplace-account.service';

@Module({
  imports: [TypeOrmModule.forFeature([MarketplaceAccount]), AuthModule],
  controllers: [MarketplaceAccountsController],
  providers: [MarketplaceAccountsService, ScopedMarketplaceAccountService],
  exports: [MarketplaceAccountsService, ScopedMarketplaceAccountService],
})
export class MarketplaceAccountsModule {}
