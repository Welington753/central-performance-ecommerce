import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MercadoLivreOAuthModule } from '../mercado-livre-oauth/mercado-livre-oauth.module';
import { MercadoLivreOrdersSyncController } from './mercado-livre-orders-sync.controller';
import { MercadoLivreOrdersKpisController } from './mercado-livre-orders-kpis.controller';
import { MercadoLivreOrdersHttpClient } from './mercado-livre-orders-http.client';
import { MercadoLivreShipmentClient } from './mercado-livre-shipment.client';
import { MercadoLivreOrdersKpiService } from './mercado-livre-orders-kpi.service';
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
 * o único jeito permitido de obter o access token aqui. `MarketplaceOrdersModule`
 * (Checkpoint 4-B, "Commit 1") provê as entidades e o serviço de persistência
 * genéricos — reaproveitados, nunca duplicados.
 */
@Module({
  imports: [
    MarketplaceAccountsModule,
    MarketplaceOrdersModule,
    MercadoLivreOAuthModule,
    AuthModule,
  ],
  controllers: [
    MercadoLivreOrdersSyncController,
    MercadoLivreOrdersKpisController,
  ],
  providers: [
    { provide: ML_FETCH, useValue: fetch },
    MercadoLivreOrdersHttpClient,
    MercadoLivreShipmentClient,
    MercadoLivreOrdersSyncService,
    MercadoLivreOrdersKpiService,
  ],
  // `MercadoLivreOrdersSyncService` exportado (Fase 4) para o backfill
  // histórico e o orquestrador de sincronização automática reaproveitarem a
  // MESMA implementação — nunca uma cópia.
  exports: [MercadoLivreOrdersSyncService],
})
export class MercadoLivreOrdersModule {}
