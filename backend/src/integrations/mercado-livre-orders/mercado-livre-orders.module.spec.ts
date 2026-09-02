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
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MercadoLivreOAuthModule } from '../mercado-livre-oauth/mercado-livre-oauth.module';
import { MercadoLivreOrdersSyncController } from './mercado-livre-orders-sync.controller';
import { MercadoLivreOrdersKpisController } from './mercado-livre-orders-kpis.controller';
import { MercadoLivreOrdersModule } from './mercado-livre-orders.module';

// Mesmo padrão de `mercado-livre-oauth.module.spec.ts` (Fase 2): sem um
// `TypeOrmModule.forRootAsync()` real neste `TestingModule`, nada provê o
// token `DataSource` — um módulo `@Global()` dedicado supre isso.
@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: { createQueryRunner: jest.fn(), query: jest.fn() },
    },
  ],
  exports: [DataSource],
})
class FakeDataSourceModule {}

describe('MercadoLivreOrdersModule', () => {
  it('compiles the full dependency graph and registers the sync and kpis controllers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              CREDENTIAL_ENCRYPTION_KEY:
                '3132333435363738393031323334353637383930313233343536373839303a3b',
              ACCESS_TOKEN_SECRET: 'x'.repeat(32),
              ML_CLIENT_ID: 'app-id',
              ML_CLIENT_SECRET: 'app-secret',
              ML_REDIRECT_URI:
                'https://api.example.com/integrations/mercado-livre/callback',
            }),
          ],
        }),
        ScheduleModule.forRoot(),
        FakeDataSourceModule,
        CommonModule,
        AuthModule,
        MarketplaceAccountsModule,
        MercadoLivreOAuthModule,
        MercadoLivreOrdersModule,
      ],
    })
      .overrideProvider(getRepositoryToken(MarketplaceAccount))
      .useValue({})
      .overrideProvider(getRepositoryToken(UserSession))
      .useValue({})
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(ML_FETCH)
      .useValue(
        jest.fn(() => {
          throw new Error(
            'ML_FETCH não deveria ser chamado no teste de compilação do módulo.',
          );
        }),
      )
      .compile();

    expect(moduleRef.get(MercadoLivreOrdersSyncController)).toBeInstanceOf(
      MercadoLivreOrdersSyncController,
    );
    expect(moduleRef.get(MercadoLivreOrdersKpisController)).toBeInstanceOf(
      MercadoLivreOrdersKpisController,
    );
  });
});
