import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserSession } from '../../auth/user-session.entity';
import { CommonModule } from '../../common/common.module';
import { User } from '../../users/user.entity';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { AMAZON_FETCH } from './amazon-lwa.client';
import { AmazonAuthService } from './amazon-auth.service';
import { AmazonModule } from './amazon.module';
import { AmazonSpApiClient } from './amazon-sp-api.client';

/**
 * Mesmo padrão de `mercado-livre-oauth.module.spec.ts`: um `DataSource` fake
 * via módulo `@Global()`, já que este `TestingModule` não registra um
 * `TypeOrmModule.forRootAsync()` real.
 */
@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
  ],
  exports: [DataSource],
})
class FakeDataSourceModule {}

describe('AmazonModule', () => {
  it('compiles the full dependency graph and exports AmazonAuthService and AmazonSpApiClient — backend boots with zero Amazon env vars set', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              // Propositalmente SEM nenhuma variável AMAZON_* — prova que o
              // módulo compila (o backend sobe) mesmo sem configuração
              // Amazon (Etapa 2).
              CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
              ACCESS_TOKEN_SECRET: 'x'.repeat(32),
            }),
          ],
        }),
        ScheduleModule.forRoot(),
        FakeDataSourceModule,
        CommonModule,
        MarketplaceAccountsModule,
        AmazonModule,
      ],
    })
      .overrideProvider(getRepositoryToken(MarketplaceAccount))
      .useValue({})
      // `MarketplaceAccountsModule` importa `AuthModule` (para o guard de
      // rotas), que por sua vez traz `TypeOrmModule.forFeature([UserSession])`
      // e, via `UsersModule`, `TypeOrmModule.forFeature([User])` — sem um
      // `TypeOrmModule.forRootAsync()` real neste `TestingModule`, essas duas
      // Repository também precisam de override explícito (mesmo padrão de
      // `mercado-livre-oauth.module.spec.ts`).
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

    expect(moduleRef.get(AmazonAuthService)).toBeInstanceOf(AmazonAuthService);
    expect(moduleRef.get(AmazonSpApiClient)).toBeInstanceOf(AmazonSpApiClient);
  });
});
