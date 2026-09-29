import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MercadoLivreClaimsHttpClient } from './mercado-livre-claims-http.client';
import { MercadoLivreClaimsModule } from './mercado-livre-claims.module';

describe('MercadoLivreClaimsModule', () => {
  it('compila e resolve MercadoLivreClaimsHttpClient via DI real', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MercadoLivreClaimsModule,
      ],
    })
      .overrideProvider(ML_FETCH)
      .useValue(
        jest.fn(() => {
          throw new Error(
            'ML_FETCH não deveria ser chamado no teste de compilação do módulo.',
          );
        }),
      )
      .compile();

    expect(moduleRef.get(MercadoLivreClaimsHttpClient)).toBeInstanceOf(
      MercadoLivreClaimsHttpClient,
    );
  });
});
