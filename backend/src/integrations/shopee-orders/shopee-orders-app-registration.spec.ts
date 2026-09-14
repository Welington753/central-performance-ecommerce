import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { envValidationSchema } from '../../config/env.validation';
import { requireTestDatabaseUrl } from '../../test-utils/require-test-database-url';
import { SHOPEE_FETCH } from '../shopee-oauth/shopee-http.client';

/**
 * Checkpoint CP2K-3B-R1 — prova de que
 * `POST /marketplace-accounts/:id/shopee/sync-orders` está registrada
 * quando a aplicação REAL sobe (`AppModule`, o mesmo usado por `main.ts`),
 * não apenas quando um teste importa `ShopeeOrdersModule` isoladamente. A
 * topologia de módulos é 100% real (`AppModule` → `IntegrationsModule` →
 * `ShopeeOrdersModule`, sem nenhuma substituição) — só o `ConfigModule` é
 * trocado por um equivalente com `ignoreEnvFile: true` para nunca ler o
 * `.env` real do repositório (mesma proibição de todos os outros
 * checkpoints Shopee), fornecendo em memória exatamente as variáveis
 * `.required()` de `envValidationSchema`.
 *
 * Uma chamada SEM autenticação prova o registro da rota: 401 (guard
 * disparou, logo a rota existe) é a prova positiva; 404 seria prova de que
 * a rota não está no grafo real.
 */
describe('Registro real da rota Shopee sync-orders (Checkpoint CP2K-3B-R1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideModule(ConfigModule)
      .useModule(
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: envValidationSchema,
          validationOptions: { abortEarly: false, allowUnknown: true },
          load: [
            () => ({
              NODE_ENV: 'test',
              DATABASE_URL: requireTestDatabaseUrl(),
              ACCESS_TOKEN_SECRET: 'x'.repeat(32),
              CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
              ML_CLIENT_ID: 'ml-client-id',
              ML_CLIENT_SECRET: 'ml-client-secret',
              ML_REDIRECT_URI:
                'https://api.example.com/integrations/mercado-livre/callback',
              FRONTEND_URL: 'https://app.example.com',
              COOKIE_SECURE: 'false',
              MARKETPLACE_AUTO_SYNC_ENABLED: 'false',
            }),
          ],
        }),
      )
      .overrideProvider(SHOPEE_FETCH)
      .useValue(
        jest.fn(() => {
          throw new Error(
            'SHOPEE_FETCH não deveria ser chamado neste teste de registro de rota.',
          );
        }),
      )
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /marketplace-accounts/:id/shopee/sync-orders sem cookie devolve 401 (rota registrada, guard ativo) — nunca 404', async () => {
    const response = await request(app.getHttpServer()).post(
      '/marketplace-accounts/11111111-1111-4111-8111-111111111111/shopee/sync-orders',
    );

    expect(response.status).toBe(401);
  });
});
