import {
  BadGatewayException,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthorizationContext } from '../../auth/decorators/authorization-context.decorator';
import {
  PermissionGuard,
  RequirePermissions,
} from '../../auth/guards/permission.guard';
import type { AuthorizationContext as AuthorizationContextType } from '../../users/authorization-context.interface';
import { PERMISSIONS } from '../../users/permissions.catalog';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { ShopeeOrdersSyncError } from './shopee-orders-sync-error';
import {
  ShopeeOrdersSyncService,
  type ShopeeOrdersSyncSummary,
} from './shopee-orders-sync.service';

/**
 * `POST /marketplace-accounts/:id/shopee/sync-orders` (Checkpoint CP2K-3B) —
 * mesmo padrão de `MercadoLivreOrdersSyncController`/
 * `AmazonOrdersSyncController`: sem `@Body()` (a rota nunca aceita corpo
 * livre), `id` validado como UUID v4 (mesma exigência de
 * `ShopeeShopController`, Checkpoint CP2J-R1 — nunca aceita v1/v3/v5, mesmo
 * sendo sintaticamente UUID). Vocabulário de erro fechado próprio
 * (`ShopeeOrdersSyncErrorCode`) mapeado para EXATAMENTE três status HTTP
 * (409/502/503), nunca a mensagem/código bruto de um provedor externo.
 *
 * `NOT_CONFIGURED` → 409 (Checkpoint CP2K-3B-R1): ML (`ML_APP_CONFIGURATION_ERROR`
 * → 503) e Amazon (`AMAZON_NOT_CONFIGURED` → 412) divergem entre si, então
 * nenhum dos dois é "o padrão do projeto" — o precedente vinculante é
 * `ShopeeShopController` (`SHOPEE_NOT_CONFIGURED` → 409, Checkpoint CP2J),
 * mesma família Shopee, mesmo significado exato de código. Mantém a API
 * Shopee internamente consistente.
 */
/**
 * Checkpoint 5A: exige `sync.run` e conta dentro do `accountScope` do
 * usuário — checagem no controller, nunca em `syncOrders` (também chamado
 * direto por `MarketplaceAutoSyncService`, o worker automático).
 */
@ApiTags('shopee-orders')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('marketplace-accounts/:id/shopee')
export class ShopeeOrdersSyncController {
  constructor(
    private readonly syncService: ShopeeOrdersSyncService,
    private readonly scopedMarketplaceAccountService: ScopedMarketplaceAccountService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('sync-orders')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_RUN)
  async syncOrders(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<ShopeeOrdersSyncSummary> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.syncService.syncOrders(id);
    } catch (error) {
      if (error instanceof ShopeeOrdersSyncError) {
        throw this.mapSyncErrorToHttpException(error);
      }
      throw error;
    }
  }

  private mapSyncErrorToHttpException(error: ShopeeOrdersSyncError): Error {
    switch (error.code) {
      case 'SYNC_ALREADY_RUNNING':
      case 'NOT_CONNECTED':
      case 'CONNECTION_BUSY':
      case 'NOT_CONFIGURED':
        return new ConflictException(error.code);
      case 'DATA_UNAVAILABLE':
        return new BadGatewayException(error.code);
      case 'TEMPORARILY_UNAVAILABLE':
      case 'SYNC_FAILED':
        return new ServiceUnavailableException(error.code);
      default: {
        // Vocabulário fechado defensivo — `ShopeeOrdersSyncErrorCode` é
        // exaustivo, `code` nunca deveria chegar aqui; nunca propaga cru.
        const exhaustiveCheck: never = error.code;
        return new ServiceUnavailableException(exhaustiveCheck);
      }
    }
  }
}
