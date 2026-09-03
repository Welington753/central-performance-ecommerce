import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../auth/auth.module';
import { UserSession } from '../../auth/user-session.entity';
import { CommonModule } from '../../common/common.module';
import { User } from '../../users/user.entity';
import { AMAZON_FETCH } from '../amazon-sp-api/amazon-lwa.client';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { AmazonConnectionModule } from './amazon-connection.module';
import { AmazonConnectionController } from './amazon-connection.controller';
import { AmazonConnectionService } from './amazon-connection.service';

@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: { createQueryRunner: jest.fn() } },
  ],
  exports: [DataSource],
})
class FakeDataSourceModule {}

describe('AmazonConnectionModule', () => {
  it('compiles the full dependency graph and registers the connection controller — backend boots with zero Amazon env vars set', async () => {
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
        FakeDataSourceModule,
        CommonModule,
        AuthModule,
        MarketplaceAccountsModule,
        AmazonConnectionModule,
      ],
    })
      .overrideProvider(getRepositoryToken(MarketplaceAccount))
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

    expect(moduleRef.get(AmazonConnectionService)).toBeInstanceOf(
      AmazonConnectionService,
    );
    expect(moduleRef.get(AmazonConnectionController)).toBeInstanceOf(
      AmazonConnectionController,
    );
  });
});
