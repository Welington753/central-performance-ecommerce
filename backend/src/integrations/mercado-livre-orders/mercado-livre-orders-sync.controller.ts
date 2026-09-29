import {
  BadGatewayException,
  ConflictException,
  Controller,
  HttpCode,
  HttpException,
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
import {
  MercadoLivreOrdersSyncService,
  SyncOrdersError,
  type SyncOrdersSummary,
} from './mercado-livre-orders-sync.service';

/**
 * Checkpoint 5A: exige `sync.run` e conta dentro do `accountScope` do
 * usuário — checagem no controller, nunca em `syncOrders` (também chamado
 * direto por `MarketplaceAutoSyncService`, o worker automático).
 */
@ApiTags('mercado-livre-orders')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('marketplace-accounts/:id/mercado-livre')
export class MercadoLivreOrdersSyncController {
  constructor(
    private readonly syncService: MercadoLivreOrdersSyncService,
    private readonly scopedMarketplaceAccountService: ScopedMarketplaceAccountService,
  ) {}

  // Sem `@Body()`: a rota nunca aceita um corpo livre (design "Endpoints
  // autenticados") — o único parâmetro é o `:id` da própria URL.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('sync-orders')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_RUN)
  async syncOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<SyncOrdersSummary> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.syncService.syncOrders(id);
    } catch (error) {
      if (error instanceof SyncOrdersError) {
        throw this.mapSyncErrorToHttpException(error);
      }
      throw error;
    }
  }

  private mapSyncErrorToHttpException(error: SyncOrdersError): Error {
    switch (error.code) {
      case 'SYNC_ALREADY_RUNNING':
      case 'ACCOUNT_NOT_CONNECTED':
      case 'TOKEN_EXPIRED':
      case 'ACCOUNT_BUSY':
        return new ConflictException(error.code);
      case 'PROVIDER_RATE_LIMITED':
        return new HttpException(error.code, HttpStatus.TOO_MANY_REQUESTS);
      case 'INVALID_PROVIDER_RESPONSE':
        return new BadGatewayException(error.code);
      // TOKEN_REFRESH_PENDING/ML_APP_CONFIGURATION_ERROR (correção de
      // resiliência OAuth): falha RECUPERÁVEL de renovação — nunca a mesma
      // severidade de TOKEN_EXPIRED/ACCOUNT_BUSY, sempre um 503 "tente de
      // novo mais tarde" (a próxima tentativa automática já está agendada,
      // nenhuma ação do usuário é necessária agora).
      case 'PROVIDER_UNAVAILABLE':
      case 'SYNC_FAILED':
      case 'TOKEN_REFRESH_PENDING':
      case 'ML_APP_CONFIGURATION_ERROR':
      default:
        return new ServiceUnavailableException(error.code);
    }
  }
}
