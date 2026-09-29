import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
  BackfillError,
  MarketplaceBackfillService,
  type BackfillChunkResult,
  type BackfillStatus,
} from './marketplace-backfill.service';

/**
 * Checkpoint 5A: leitura (`status`) exige `sync.view`; ações (`start`/
 * `pause`/`resume`/`next-chunk`) exigem `sync.backfill`. Toda rota valida a
 * conta via `ScopedMarketplaceAccountService` (404 genérico se fora do
 * escopo) ANTES de chamar o service — inclusive `next-chunk`, também
 * chamado direto por `MarketplaceBackfillWorkerService` (o worker nunca
 * passa por este controller, então seu método interno nunca muda de
 * assinatura).
 */
@ApiTags('marketplace-sync')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('marketplace-accounts/:id/backfill')
export class MarketplaceBackfillController {
  constructor(
    private readonly backfillService: MarketplaceBackfillService,
    private readonly scopedMarketplaceAccountService: ScopedMarketplaceAccountService,
  ) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<BackfillStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    return this.backfillService.getStatus(id);
  }

  /**
   * Cria (ou, idempotentemente, devolve) o job durável de backfill desta
   * conta (Fase 4, "Backfill durável") — o worker do BACKEND processa dali
   * em diante, mesmo com a aba fechada. Rate-limited (não `next-chunk`, mas
   * ainda um endpoint que muda estado) para nunca virar um vetor de clique
   * duplo em rajada.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_BACKFILL)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<BackfillStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.backfillService.startBackfill(id);
    } catch (error) {
      if (error instanceof BackfillError) {
        throw this.mapErrorToHttpException(error);
      }
      throw error;
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_BACKFILL)
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<BackfillStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    return this.backfillService.pauseBackfill(id);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_BACKFILL)
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<BackfillStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.backfillService.resumeBackfill(id);
    } catch (error) {
      if (error instanceof BackfillError) {
        throw this.mapErrorToHttpException(error);
      }
      throw error;
    }
  }

  // Preservado por compatibilidade (Fase 4, "Backfill durável") — o
  // frontend não chama mais isto em loop; só o worker do backend usa
  // `MarketplaceBackfillService.runNextChunk` diretamente (em processo, sem
  // HTTP). Sem `@Body()`: um chunk por chamada.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('next-chunk')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_BACKFILL)
  async nextChunk(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<BackfillChunkResult> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.backfillService.runNextChunk(id);
    } catch (error) {
      if (error instanceof BackfillError) {
        throw this.mapErrorToHttpException(error);
      }
      throw error;
    }
  }

  private mapErrorToHttpException(error: BackfillError): Error {
    switch (error.code) {
      case 'ACCOUNT_NOT_CONNECTED':
      case 'NO_INITIAL_SYNC_YET':
      case 'MARKETPLACE_NOT_SUPPORTED':
        return new NotFoundException(error.code);
      // MODE_CONFLICT: enriquecimento de compradores ativo na mesma conta (mesma fila).
      case 'BACKFILL_ALREADY_RUNNING':
      case 'BACKFILL_JOB_MODE_CONFLICT':
        return new ConflictException(error.code);
      case 'AMAZON_NOT_CONFIGURED':
      case 'SYNC_FAILED':
      default:
        return new ServiceUnavailableException(error.code);
    }
  }
}
