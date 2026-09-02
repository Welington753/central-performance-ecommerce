import { Module } from '@nestjs/common';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
// Ver comentário em `amazon-auth.service.ts`: `AdvisoryLockService` é o
// utilitário GENÉRICO de lock por accountId já usado pelo OAuth do Mercado
// Livre — reaproveitado diretamente (não duplicado). Uma segunda instância
// própria deste módulo é criada aqui (a classe não guarda estado entre
// chamadas — cada `tryAcquire` abre sua própria conexão dedicada), evitando
// qualquer alteração em `MercadoLivreOAuthModule`.
import { AdvisoryLockService } from '../mercado-livre-oauth/advisory-lock.service';
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
