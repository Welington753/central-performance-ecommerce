import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { ML_FETCH } from '../mercado-livre-oauth/mercado-livre-http.client';
import { MercadoLivreOAuthModule } from '../mercado-livre-oauth/mercado-livre-oauth.module';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { MercadoLivreOrdersSyncController } from './mercado-livre-orders-sync.controller';
import { MercadoLivreOrdersKpisController } from './mercado-livre-orders-kpis.controller';
import { MercadoLivreOrdersHttpClient } from './mercado-livre-orders-http.client';
import { MercadoLivreShipmentClient } from './mercado-livre-shipment.client';
import {
  ML_SHIPMENT_RETRY_SLEEP,
  MercadoLivreShipmentLookupService,
  type ShipmentRetrySleep,
} from './mercado-livre-shipment-lookup.service';
import { MercadoLivreOrderDetailClient } from './mercado-livre-order-detail.client';
import { MercadoLivreOrderDetailLookupService } from './mercado-livre-order-detail-lookup.service';
import { MercadoLivreLogisticsReclassificationService } from './mercado-livre-logistics-reclassification.service';
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
    // Espera real entre tentativas de consulta ao envio. Injetada como
    // provider para que os testes de retry rodem sem nenhum atraso real.
    {
      provide: ML_SHIPMENT_RETRY_SLEEP,
      useValue: ((delayMs: number) =>
        new Promise<void>((resolve) =>
          setTimeout(resolve, delayMs),
        )) satisfies ShipmentRetrySleep,
    },
    MercadoLivreOrdersHttpClient,
    MercadoLivreShipmentClient,
    MercadoLivreShipmentLookupService,
    // Fallback de recuperação de `shipping.id` (revisão crítica da
    // auditoria Full) — usado SÓ pela reclassificação, e só em `--apply`.
    MercadoLivreOrderDetailClient,
    MercadoLivreOrderDetailLookupService,
    // Mesmo padrão de lock já adotado pelo módulo OAuth: provider local,
    // serializando operações por `accountId` entre processos.
    AdvisoryLockService,
    MercadoLivreOrdersSyncService,
    MercadoLivreOrdersKpiService,
    // Reclassificação de histórico `UNKNOWN` (correção da auditoria Full).
    // É apenas um provider — NUNCA roda sozinho no boot, nunca é agendado e
    // nenhum controller o expõe: só a CLI operacional dedicada o aciona.
    MercadoLivreLogisticsReclassificationService,
  ],
  // `MercadoLivreOrdersSyncService` exportado (Fase 4) para o backfill
  // histórico e o orquestrador de sincronização automática reaproveitarem a
  // MESMA implementação — nunca uma cópia.
  exports: [
    MercadoLivreOrdersSyncService,
    MercadoLivreLogisticsReclassificationService,
  ],
})
export class MercadoLivreOrdersModule {}
