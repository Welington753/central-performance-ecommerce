import { readFileSync } from 'fs';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../auth/auth.module';
import { UserSession } from '../../auth/user-session.entity';
import { CommonModule } from '../../common/common.module';
import { User } from '../../users/user.entity';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MercadoLivreClaimsHttpClient } from '../mercado-livre-claims/mercado-livre-claims-http.client';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MercadoLivreOAuthModule } from '../mercado-livre-oauth/mercado-livre-oauth.module';
import { MarketplaceProblemsSyncJobsPersistenceService } from './marketplace-problems-sync-jobs-persistence.service';
import { MarketplaceProblemsSyncTickService } from './marketplace-problems-sync-tick.service';
import { MarketplaceProblemsSyncWorkerService } from './marketplace-problems-sync-worker.service';
import { MarketplaceProblemsModule } from './marketplace-problems.module';
import { MercadoLivreProblemsSyncService } from './mercado-livre-problems-sync.service';

// Mesmo padrão de `mercado-livre-orders.module.spec.ts`: nada neste
// `TestingModule` provê o token `DataSource` — um módulo `@Global()` fake supre.
const fakeDataSource = {
  createQueryRunner: jest.fn(),
  query: jest.fn(),
  // Usados pelo factory de `TypeOrmModule.forFeature` de qualquer módulo importado.
  entityMetadatas: [],
  options: { type: 'postgres' },
  getRepository: jest.fn(() => ({})),
};

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: fakeDataSource }],
  exports: [DataSource],
})
class FakeDataSourceModule {}

async function compile(extraConfig: Record<string, unknown> = {}) {
  return Test.createTestingModule({
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
            ...extraConfig,
          }),
        ],
      }),
      ScheduleModule.forRoot(),
      FakeDataSourceModule,
      CommonModule,
      AuthModule,
      MarketplaceAccountsModule,
      MercadoLivreOAuthModule,
      MarketplaceProblemsModule,
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
}

describe('MarketplaceProblemsModule', () => {
  it('compila o grafo de DI real e resolve sync, tick, persistência do job e worker', async () => {
    const moduleRef = await compile();
    expect(moduleRef.get(MercadoLivreProblemsSyncService)).toBeInstanceOf(
      MercadoLivreProblemsSyncService,
    );
    expect(moduleRef.get(MercadoLivreClaimsHttpClient)).toBeInstanceOf(
      MercadoLivreClaimsHttpClient,
    );
    expect(
      moduleRef.get(MarketplaceProblemsSyncJobsPersistenceService),
    ).toBeInstanceOf(MarketplaceProblemsSyncJobsPersistenceService);
    expect(moduleRef.get(MarketplaceProblemsSyncTickService)).toBeInstanceOf(
      MarketplaceProblemsSyncTickService,
    );
    expect(moduleRef.get(MarketplaceProblemsSyncWorkerService)).toBeInstanceOf(
      MarketplaceProblemsSyncWorkerService,
    );
  });

  it('worker desabilitado por padrão: init/destroy do módulo nunca tocam o banco nem criam timer', async () => {
    const moduleRef = await compile();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const before = setIntervalSpy.mock.calls.length;
    await moduleRef.init();
    expect(setIntervalSpy.mock.calls.length).toBe(before);
    expect(fakeDataSource.query).not.toHaveBeenCalled();
    await moduleRef.close();
    setIntervalSpy.mockRestore();
  });

  it('flag ligada mas NODE_ENV=test: continua sem timer', async () => {
    const moduleRef = await compile({
      PROBLEMS_SYNC_WORKER_ENABLED: 'true',
      NODE_ENV: 'test',
    });
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const before = setIntervalSpy.mock.calls.length;
    await moduleRef.init();
    expect(setIntervalSpy.mock.calls.length).toBe(before);
    await moduleRef.close();
    setIntervalSpy.mockRestore();
  });

  it('não é importado pelo AppModule nesta etapa', () => {
    const source = readFileSync(require.resolve('../../app.module'), 'utf8');
    expect(source).not.toContain('MarketplaceProblemsModule');
  });
});
