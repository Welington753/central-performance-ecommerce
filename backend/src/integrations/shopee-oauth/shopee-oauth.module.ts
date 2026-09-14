import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { OAuthAuthorizationRequestsService } from '../mercado-livre-oauth/oauth-authorization-requests.service';
import {
  SHOPEE_CLOCK,
  SHOPEE_FETCH,
  ShopeeHttpClient,
} from './shopee-http.client';
import {
  SHOPEE_ACCESS_TOKEN_CLOCK,
  ShopeeAccessTokenService,
} from './shopee-access-token.service';
import { ShopeeCredentialsService } from './shopee-credentials.service';
import { ShopeeOAuthController } from './shopee-oauth.controller';
import { ShopeeShopApiClient } from './shopee-shop-api.client';
import { ShopeeShopController } from './shopee-shop.controller';
import { ShopeeShopService } from './shopee-shop.service';
import { SHOPEE_OAUTH_CLOCK, ShopeeOAuthService } from './shopee-oauth.service';

/**
 * Módulo específico da Shopee (Checkpoint CP2C, controller HTTP adicionado
 * no CP2D) — `OAuthAuthorizationRequestsService`/`AdvisoryLockService` são
 * declarados como providers PRÓPRIOS deste módulo (não importados de
 * `MercadoLivreOAuthModule`, que não os exporta) — ambos são stateless e
 * só operam sobre o `DataSource` compartilhado, então ter uma instância
 * própria por módulo é seguro e mantém os dois módulos de marketplace
 * totalmente desacoplados entre si.
 *
 * `AuthModule` importado só pelo `AccessTokenGuard` do endpoint de conexão
 * (`connect`) — mesma dependência que `MercadoLivreOAuthModule` já tem pelo
 * mesmo motivo. `EncryptionService` vem do `CommonModule` (`@Global()`),
 * não precisa ser importado explicitamente. Sem `TypeOrmModule.forFeature`:
 * nenhuma classe aqui injeta um `Repository` próprio —
 * `MarketplaceAccountsService` (via `MarketplaceAccountsModule`) e
 * `OAuthAuthorizationRequestsService` usam SQL cru/o repositório já
 * registrado em outro módulo.
 *
 * Produção usa `globalThis.fetch` via provider controlado (`SHOPEE_FETCH`)
 * — nos testes, este provider é sempre sobrescrito por um mock; nenhum
 * teste chama rede real.
 *
 * `ShopeeAccessTokenService` (Checkpoint CP2H) exportado para uso futuro por
 * clientes internos da Shopee (ex.: a Shop API) — nenhum controller/rota
 * pública o expõe ainda.
 *
 * `ShopeeShopApiClient` (Checkpoint CP2I, `GET /api/v2/shop/get_shop_info`)
 * reaproveita os mesmos `SHOPEE_FETCH`/`SHOPEE_CLOCK` do cliente de token —
 * exportado para o próximo checkpoint consumir; nenhum controller/rota
 * pública o expõe ainda.
 *
 * `ShopeeShopController`/`ShopeeShopService` (Checkpoint CP2J) expõem
 * `GET marketplace-accounts/:id/shopee/shop-info` — primeira rota pública
 * que efetivamente chama a Shop API. Mesmo escopo arquitetural do restante
 * de `integrations/shopee-oauth/` (ver `shopee-architecture.spec.ts`):
 * nenhum connector concreto nem o registro central de connectors.
 */
@Module({
  imports: [MarketplaceAccountsModule, AuthModule],
  controllers: [ShopeeOAuthController, ShopeeShopController],
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
    { provide: SHOPEE_ACCESS_TOKEN_CLOCK, useValue: () => Date.now() },
    ShopeeHttpClient,
    ShopeeOAuthService,
    ShopeeAccessTokenService,
    ShopeeShopApiClient,
    ShopeeShopService,
  ],
  exports: [ShopeeOAuthService, ShopeeAccessTokenService, ShopeeShopApiClient],
})
export class ShopeeOAuthModule {}
