import { Module } from '@nestjs/common';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { OAuthAuthorizationRequestsService } from '../mercado-livre-oauth/oauth-authorization-requests.service';
import {
  SHOPEE_CLOCK,
  SHOPEE_FETCH,
  ShopeeHttpClient,
} from './shopee-http.client';
import { ShopeeCredentialsService } from './shopee-credentials.service';
import { SHOPEE_OAUTH_CLOCK, ShopeeOAuthService } from './shopee-oauth.service';

/**
 * Módulo específico da Shopee (Checkpoint CP2C) — sem controller/rota
 * pública ainda. `OAuthAuthorizationRequestsService`/`AdvisoryLockService`
 * são declarados como providers PRÓPRIOS deste módulo (não importados de
 * `MercadoLivreOAuthModule`, que não os exporta) — ambos são stateless e
 * só operam sobre o `DataSource` compartilhado, então ter uma instância
 * própria por módulo é seguro e mantém os dois módulos de marketplace
 * totalmente desacoplados entre si.
 *
 * `EncryptionService` vem do `CommonModule` (`@Global()`), não precisa ser
 * importado explicitamente. Sem `TypeOrmModule.forFeature`: nenhuma classe
 * aqui injeta um `Repository` próprio — `MarketplaceAccountsService` (via
 * `MarketplaceAccountsModule`) e `OAuthAuthorizationRequestsService` usam
 * SQL cru/o repositório já registrado em outro módulo.
 *
 * Produção usa `globalThis.fetch` via provider controlado (`SHOPEE_FETCH`)
 * — nos testes, este provider é sempre sobrescrito por um mock; nenhum
 * teste chama rede real.
 */
@Module({
  imports: [MarketplaceAccountsModule],
  providers: [
    OAuthAuthorizationRequestsService,
    AdvisoryLockService,
    ShopeeCredentialsService,
    {
      provide: SHOPEE_FETCH,
      useValue: (...args: Parameters<typeof fetch>) => fetch(...args),
    },
    { provide: SHOPEE_CLOCK, useValue: () => Math.floor(Date.now() / 1000) },
    { provide: SHOPEE_OAUTH_CLOCK, useValue: () => Date.now() },
    ShopeeHttpClient,
    ShopeeOAuthService,
  ],
  exports: [ShopeeOAuthService],
})
export class ShopeeOAuthModule {}
