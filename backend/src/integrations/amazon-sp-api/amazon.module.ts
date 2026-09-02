import { Module } from '@nestjs/common';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
// `AdvisoryLockService` mora em `integrations/shared/` desde o Checkpoint
// 4-B — uma instância própria deste módulo é criada aqui (a classe não
// guarda estado entre chamadas — cada `tryAcquire` abre sua própria conexão
// dedicada), sem depender de nenhum módulo do Mercado Livre.
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { AMAZON_FETCH, AmazonLwaClient } from './amazon-lwa.client';
import { AmazonAuthService } from './amazon-auth.service';
import { AmazonSpApiClient } from './amazon-sp-api.client';

/**
 * Módulo Amazon SP-API (Fase 4, fundação). Sem controller nesta fase — nada
 * é exposto por HTTP. Nunca importa nenhum client/serviço de NEGÓCIO
 * específico do Mercado Livre — só abstrações genéricas
 * (`MarketplaceAccountsService`, `EncryptionService` via `CommonModule`
 * global, `AdvisoryLockService`). Ver `amazon-architecture.spec.ts`.
 */
@Module({
  imports: [MarketplaceAccountsModule],
  providers: [
    { provide: AMAZON_FETCH, useValue: fetch },
    AdvisoryLockService,
    AmazonLwaClient,
    AmazonAuthService,
    AmazonSpApiClient,
  ],
  exports: [AmazonAuthService, AmazonSpApiClient],
})
export class AmazonModule {}
