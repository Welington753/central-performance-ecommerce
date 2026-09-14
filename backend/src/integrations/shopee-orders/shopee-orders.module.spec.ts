import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../auth/auth.module';
import { UserSession } from '../../auth/user-session.entity';
import { CommonModule } from '../../common/common.module';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrder } from '../marketplace-orders/marketplace-order.entity';
import { MarketplaceOrderItem } from '../marketplace-orders/marketplace-order-item.entity';
import { SHOPEE_FETCH } from '../shopee-oauth/shopee-http.client';
import { ShopeeOrdersModule } from './shopee-orders.module';
import { ShopeeOrdersSyncController } from './shopee-orders-sync.controller';
import { ShopeeOrdersSyncService } from './shopee-orders-sync.service';

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: {
        createQueryRunner: jest.fn(),
        query: jest.fn(),
        entityMetadatas: [],
        getRepository: () => ({}),
        getTreeRepository: () => ({}),
        getMongoRepository: () => ({}),
        options: { type: 'postgres' },
      },
    },
  ],
  exports: [DataSource],
})
class FakeDataSourceModule {}

describe('ShopeeOrdersModule', () => {
  it('compila o grafo de dependências completo e registra o controller de sincronização', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
              ACCESS_TOKEN_SECRET: 'x'.repeat(32),
              SHOPEE_PARTNER_ID: '1000000',
              SHOPEE_PARTNER_KEY: 'partner-key-example',
              SHOPEE_REDIRECT_URI:
                'https://api.example.com/integrations/shopee/callback',
              SHOPEE_ENVIRONMENT: 'SANDBOX',
            }),
          ],
        }),
        FakeDataSourceModule,
        CommonModule,
        AuthModule,
        MarketplaceAccountsModule,
        ShopeeOrdersModule,
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
      .overrideProvider(SHOPEE_FETCH)
      .useValue(
        jest.fn(() => {
          throw new Error(
            'SHOPEE_FETCH não deveria ser chamado no teste de compilação do módulo.',
          );
        }),
      )
      .compile();

    expect(moduleRef.get(ShopeeOrdersSyncService)).toBeInstanceOf(
      ShopeeOrdersSyncService,
    );
    expect(moduleRef.get(ShopeeOrdersSyncController)).toBeInstanceOf(
      ShopeeOrdersSyncController,
    );
  });
});
