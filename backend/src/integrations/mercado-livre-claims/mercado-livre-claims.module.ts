import { Module } from '@nestjs/common';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MercadoLivreClaimsHttpClient } from './mercado-livre-claims-http.client';

/**
 * Módulo do cliente HTTP de Claims (CP1 da funcionalidade "Problemas") —
 * mesmo padrão local-provider de `ML_FETCH` já usado por
 * `MercadoLivreOrdersModule` (`MercadoLivreOAuthModule` não exporta o
 * símbolo, cada módulo consumidor precisa do seu próprio provider). Ainda
 * sem nenhum consumidor real (sync/repository ficam para o CP2) — só
 * garante que o cliente é resolvível por DI desde já, sem refatoração de
 * wiring depois.
 */
@Module({
  providers: [
    { provide: ML_FETCH, useValue: fetch },
    MercadoLivreClaimsHttpClient,
  ],
  exports: [MercadoLivreClaimsHttpClient],
})
export class MercadoLivreClaimsModule {}
