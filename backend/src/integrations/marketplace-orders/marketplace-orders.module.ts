import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketplaceOrder } from './marketplace-order.entity';
import { MarketplaceOrderItem } from './marketplace-order-item.entity';
import { MarketplaceOrdersPersistenceService } from './marketplace-orders-persistence.service';

/**
 * Núcleo compartilhado de pedidos normalizados (Checkpoint 4-B, "Commit 1"):
 * entidades + persistência genéricas, sem nenhuma dependência de negócio de
 * um marketplace específico. Importado tanto por `MercadoLivreOrdersModule`
 * quanto pelo módulo de pedidos da Amazon.
 */
@Module({
  imports: [TypeOrmModule.forFeature([MarketplaceOrder, MarketplaceOrderItem])],
  providers: [MarketplaceOrdersPersistenceService],
  exports: [MarketplaceOrdersPersistenceService, TypeOrmModule],
})
export class MarketplaceOrdersModule {}
