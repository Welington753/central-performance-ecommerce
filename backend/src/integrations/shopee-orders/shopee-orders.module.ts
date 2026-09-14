import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { SHOPEE_CLOCK, SHOPEE_FETCH } from '../shopee-oauth/shopee-http.client';
import { ShopeeCredentialsService } from '../shopee-oauth/shopee-credentials.service';
import { ShopeeOAuthModule } from '../shopee-oauth/shopee-oauth.module';
import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
import { ShopeeOrdersSyncController } from './shopee-orders-sync.controller';
import { ShopeeOrdersSyncService } from './shopee-orders-sync.service';

/**
 * Módulo de sincronização de pedidos Shopee (Checkpoint CP2K-3B) — mesmo
 * padrão estrutural de `MercadoLivreOrdersModule`/`AmazonOrdersModule`:
 * reaproveita `MarketplaceAccountsModule`/`MarketplaceOrdersModule`
 * (genéricos) e `ShopeeOAuthModule` (`ShopeeAccessTokenService`, único jeito
 * permitido de obter accessToken+shopId — Checkpoint CP2H/CP2J), nunca uma
 * cópia de nenhum dos dois.
 *
 * `SHOPEE_FETCH`/`SHOPEE_CLOCK`/`ShopeeCredentialsService` precisam de
 * providers PRÓPRIOS aqui (mesmo símbolo/mesmo valor de
 * `ShopeeOAuthModule`) — DI do Nest é escopada por módulo, e
 * `ShopeeOAuthModule` não os exporta (só `ShopeeOAuthService`/
 * `ShopeeAccessTokenService`/`ShopeeShopApiClient`); `ShopeeOrdersApiClient`
 * (declarado neste módulo) precisa deles diretamente. Mesma duplicação já
 * aceita entre `MercadoLivreOAuthModule`/`MercadoLivreOrdersModule`
 * (`ML_FETCH`) — nunca comportamento divergente, só o mesmo provider
 * redeclarado por exigência de escopo do Nest.
 *
 * `ShopeeOrdersSyncService` nunca é registrado/exportado antes deste
 * checkpoint (CP2K-1/CP2K-2/CP2K-3A eram somente-biblioteca, sem módulo, por
 * design explícito daqueles checkpoints).
 */
@Module({
  imports: [
    MarketplaceAccountsModule,
    MarketplaceOrdersModule,
    ShopeeOAuthModule,
    AuthModule,
  ],
  controllers: [ShopeeOrdersSyncController],
  providers: [
    {
      provide: SHOPEE_FETCH,
      useValue: (...args: Parameters<typeof fetch>) => fetch(...args),
    },
    { provide: SHOPEE_CLOCK, useValue: () => Math.floor(Date.now() / 1000) },
    ShopeeCredentialsService,
    ShopeeOrdersApiClient,
    ShopeeOrdersSyncService,
  ],
  // Exportado para um futuro orquestrador de sincronização automática/
  // backfill reaproveitar a MESMA implementação — nenhum controller/rota
  // adicional neste checkpoint.
  exports: [ShopeeOrdersSyncService],
})
export class ShopeeOrdersModule {}
