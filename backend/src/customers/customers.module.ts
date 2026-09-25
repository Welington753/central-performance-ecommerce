import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketplaceSyncModule } from '../integrations/marketplace-sync/marketplace-sync.module';
import { CustomerPermissionGuard } from './customer-permissions';
import { CustomersExportService } from './customers-export.service';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuthModule, MarketplaceSyncModule],
  controllers: [CustomersController],
  providers: [
    CustomersRepository,
    CustomersService,
    CustomersExportService,
    CustomerPermissionGuard,
  ],
})
export class CustomersModule {}
