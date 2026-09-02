import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../auth/auth.module';
import { UserSession } from '../../auth/user-session.entity';
import { CommonModule } from '../../common/common.module';
import { User } from '../../users/user.entity';
import { AMAZON_FETCH } from '../amazon-sp-api/amazon-lwa.client';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { AmazonOrdersModule } from './amazon-orders.module';
import { AmazonOrdersSyncController } from './amazon-orders-sync.controller';
import { AmazonOrdersSyncService } from './amazon-orders-sync.service';

@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
  ],
  exports: [DataSource],
})
class FakeDataSourceModule {}

describe('AmazonOrdersModule', () => {
  it('compiles the full dependency graph and registers the sync controller — backend boots with zero Amazon env vars set', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
              ACCESS_TOKEN_SECRET: 'x'.repeat(32),
            }),
          ],
        }),
        ScheduleModule.forRoot(),
        FakeDataSourceModule,
        CommonModule,
        AuthModule,
        MarketplaceAccountsModule,
        AmazonOrdersModule,
      ],
    })
      .overrideProvider(getRepositoryToken(MarketplaceAccount))
      .useValue({})
      .overrideProvider(getRepositoryToken(MarketplaceOrder))
      .useValue({})
      .overrideProvider(getRepositoryToken(MarketplaceOrderItem))
      .useValue({})
      .overrideProvider(getRepositoryToken(UserSession))
      .useValue({})
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(AMAZON_FETCH)
      .useValue(
        jest.fn(() => {
          throw new Error(
            'AMAZON_FETCH não deveria ser chamado no teste de compilação do módulo.',
          );
        }),
      )
      .compile();

    expect(moduleRef.get(AmazonOrdersSyncService)).toBeInstanceOf(
      AmazonOrdersSyncService,
    );
    expect(moduleRef.get(AmazonOrdersSyncController)).toBeInstanceOf(
      AmazonOrdersSyncController,
    );
  });
});
