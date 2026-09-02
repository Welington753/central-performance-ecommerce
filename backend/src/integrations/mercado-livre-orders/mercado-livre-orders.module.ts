import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MercadoLivreOAuthModule } from '../mercado-livre-oauth/mercado-livre-oauth.module';
import { MercadoLivreOrdersSyncController } from './mercado-livre-orders-sync.controller';
import { MercadoLivreOrdersKpisController } from './mercado-livre-orders-kpis.controller';
import { MercadoLivreOrdersHttpClient } from './mercado-livre-orders-http.client';
import { MercadoLivreOrdersKpiService } from './mercado-livre-orders-kpi.service';
import { MercadoLivreOrdersPersistenceService } from './mercado-livre-orders-persistence.service';
import { MercadoLivreOrdersSyncService } from './mercado-livre-orders-sync.service';

/**
 * Módulo da Fase 3 (coleta real de pedidos e KPIs de vendas do Mercado
 * Livre). Reusa o MESMO símbolo `ML_FETCH` já definido pelo módulo OAuth
 * (Fase 2) — a mesma fronteira HTTP injetável — mas precisa provê-lo de novo
 * aqui: DI do Nest é escopada por módulo, e `MercadoLivreOAuthModule` não
 * exporta `ML_FETCH` (só `MercadoLivreOAuthService`), então
 * `MercadoLivreOrdersHttpClient` (declarado neste módulo) precisa do seu
 * próprio provider local para o mesmo token. `MercadoLivreOAuthModule` é
 * importado só para expor `MercadoLivreOAuthService.ensureValidAccessToken`,
 * o único jeito permitido de obter o access token aqui.
 */
@Module({
  imports: [MarketplaceAccountsModule, MercadoLivreOAuthModule, AuthModule],
  controllers: [
    MercadoLivreOrdersSyncController,
    MercadoLivreOrdersKpisController,
  ],
  providers: [
    { provide: ML_FETCH, useValue: fetch },
    MercadoLivreOrdersHttpClient,
    MercadoLivreOrdersPersistenceService,
    MercadoLivreOrdersSyncService,
    MercadoLivreOrdersKpiService,
  ],
})
export class MercadoLivreOrdersModule {}
