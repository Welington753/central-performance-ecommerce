import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccount } from './marketplace-account.entity';
import { MarketplaceAccountsController } from './marketplace-accounts.controller';
import { MarketplaceAccountsService } from './marketplace-accounts.service';

@Module({
  imports: [TypeOrmModule.forFeature([MarketplaceAccount]), AuthModule],
  controllers: [MarketplaceAccountsController],
  providers: [MarketplaceAccountsService],
  exports: [MarketplaceAccountsService],
})
export class MarketplaceAccountsModule {}
