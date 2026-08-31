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
import { ML_FETCH } from './mercado-livre-http.client';
import { MercadoLivreOAuthModule } from './mercado-livre-oauth.module';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

/**
 * Divergência mínima do plano: `.overrideProvider(DataSource)` só substitui
 * um provider JÁ registrado em algum módulo do grafo — sem um
 * `TypeOrmModule.forRootAsync()` real neste `TestingModule`, nada provê o
 * token `DataSource` (o `TypeOrmModule.forFeature([MarketplaceAccount])` de
 * `MarketplaceAccountsModule` só registra o `Repository`, não o
 * `DataSource`), então o override não tinha nada para substituir e o
 * `.compile()` falhava com "Nest can't resolve dependencies... DataSource".
 * Corrigido registrando um `DataSource` fake através de um módulo `@Global()`
 * dedicado — módulos globais no NestJS ficam visíveis em toda a árvore de
 * compilação sem exigir import explícito de cada consumidor, exatamente o
 * comportamento que o `.overrideProvider` presumia incorretamente já existir.
 */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: { createQueryRunner: jest.fn() } }],
  exports: [DataSource],
})
class FakeDataSourceModule {}

describe('MercadoLivreOAuthModule', () => {
  it('compiles the full dependency graph and exports MercadoLivreOAuthService', async () => {
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
        // CommonModule é @Global(), mas isso só vale para módulos que
        // pertencem à mesma árvore de compilação — na produção ela sempre
        // inclui CommonModule porque AppModule o importa (design §1), mas
        // este TestingModule NÃO importa AppModule, então o efeito global
        // não se aplica automaticamente. Sem esta linha, EncryptionService
        // (consumido por MercadoLivreOAuthService e
        // OAuthAuthorizationRequestsService) ficaria irresolvível e o
        // .compile() falharia — é exatamente esse encadeamento real que este
        // teste precisa provar, não simular.
        CommonModule,
        AuthModule,
        MarketplaceAccountsModule,
        MercadoLivreOAuthModule,
      ],
    })
      .overrideProvider(getRepositoryToken(MarketplaceAccount))
      .useValue({})
      // AuthModule importa TypeOrmModule.forFeature([UserSession]) e, por
      // meio de UsersModule, TypeOrmModule.forFeature([User]) — sem um
      // TypeOrmModule.forRoot() real neste TestingModule, essas duas
      // Repository também precisam de override explícito, senão o .compile()
      // falha ao resolver AuthService/UsersService antes mesmo de chegar ao
      // módulo do Mercado Livre.
      .overrideProvider(getRepositoryToken(UserSession))
      .useValue({})
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      // Nunca o `fetch` real: mesmo com o guard global de rede (Task 11)
      // bloqueando `global.fetch` antes de qualquer import, este teste
      // sobrescreve ML_FETCH explicitamente para não depender implicitamente
      // da ordem de carregamento do Jest — se algo aqui chamar a função,
      // o teste falha imediatamente com um erro claro, nunca com uma
      // tentativa real de acesso à rede.
      .overrideProvider(ML_FETCH)
      .useValue(
        jest.fn(() => {
          throw new Error(
            'ML_FETCH não deveria ser chamado no teste de compilação do módulo.',
          );
        }),
      )
      .compile();

    expect(moduleRef.get(MercadoLivreOAuthService)).toBeInstanceOf(
      MercadoLivreOAuthService,
    );
  });
});
