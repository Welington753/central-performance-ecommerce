import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AmazonModule } from '../amazon-sp-api/amazon.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { MarketplaceOrdersModule } from '../marketplace-orders/marketplace-orders.module';
import { AMAZON_ORDERS_SLEEP } from './amazon-orders-sync.service';
import { AmazonOrdersSyncController } from './amazon-orders-sync.controller';
import { AmazonOrdersSyncService } from './amazon-orders-sync.service';

/**
 * Módulo de sincronização de pedidos Amazon (Checkpoint 4-B). Reaproveita
 * `AmazonModule` (Checkpoint 4-A, `AmazonAuthService`/`AmazonSpApiClient`) e
 * `MarketplaceOrdersModule` (genérico, Checkpoint 4-B "Commit 1") — nunca
 * duplica nem importa nada específico do Mercado Livre.
 */
@Module({
  imports: [
    MarketplaceAccountsModule,
    MarketplaceOrdersModule,
    AmazonModule,
    AuthModule,
  ],
  controllers: [AmazonOrdersSyncController],
  providers: [
    {
      provide: AMAZON_ORDERS_SLEEP,
      useValue: (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms)),
    },
    AmazonOrdersSyncService,
  ],
})
export class AmazonOrdersModule {}
