import {
  BadGatewayException,
  ConflictException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import {
  ShopeeShopInfoPublicDto,
  ShopeeShopService,
  ShopeeShopServiceError,
} from './shopee-shop.service';

/**
 * Rota autenticada de informações básicas de loja Shopee (Checkpoint CP2J)
 * — mesma autorização das demais rotas Shopee/`marketplace-accounts` (§6.1
 * já aplicado): `AccessTokenGuard` explícito, sem RBAC/ownership adicional
 * (`MarketplaceAccount` continua um recurso global). `accountId` validado
 * como UUID por `ParseUUIDPipe`. Assinatura do método só aceita `id` — nunca
 * `@Query()`/`@Body()`: não há como um cliente controlar `token`/`shopId`/
 * `environment`/`host`/`path`/`returnUrl` por esta rota.
 *
 * `id` validado explicitamente como UUID v4 (Checkpoint CP2J-R1) — nunca
 * aceita v1/v3/v5, mesmo sendo sintaticamente UUID.
 */
@ApiTags('shopee-shop')
@ApiCookieAuth()
@Controller()
export class ShopeeShopController {
  constructor(private readonly service: ShopeeShopService) {}

  @UseGuards(AccessTokenGuard)
  // Chama a Shop API da Shopee a cada requisição (sem cache) — mesmo limite
  // de `connect`/`verify` para conter abuso de uma API externa com rate
  // limit próprio.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  // `no-store`: reflete estado de loja/token que muda em runtime — nunca
  // pode ser servida de cache HTTP intermediário nem do bfcache.
  @Header('Cache-Control', 'no-store')
  @Get('marketplace-accounts/:id/shopee/shop-info')
  async getShopInfo(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ShopeeShopInfoPublicDto> {
    try {
      return await this.service.getShopInfo(id);
    } catch (error) {
      if (error instanceof ShopeeShopServiceError) {
        throw this.mapToHttpException(error);
      }
      throw error;
    }
  }

  private mapToHttpException(error: ShopeeShopServiceError): Error {
    switch (error.code) {
      case 'SHOPEE_NOT_CONNECTED':
      case 'SHOPEE_CONNECTION_BUSY':
      case 'SHOPEE_NOT_CONFIGURED':
        return new ConflictException(error.code);
      case 'SHOPEE_DATA_UNAVAILABLE':
        return new BadGatewayException(error.code);
      case 'SHOPEE_TEMPORARILY_UNAVAILABLE':
        return new ServiceUnavailableException(error.code);
    }
  }
}
