import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
  MlLogisticsReclassificationError,
  MlLogisticsReclassificationService,
  type MlLogisticsReclassificationAccountStatus,
} from './ml-logistics-reclassification.service';

/**
 * API autenticada da reclassificação histórica Full (correção da auditoria
 * Full — Render free sem Shell). MESMO padrão de
 * `MarketplaceBackfillController`: `AccessTokenGuard` (qualquer usuário
 * interno autenticado — este sistema não tem conceito de conta por usuário,
 * ver `marketplace_accounts`, nunca vinculada a `userId`) + `Throttle` nos
 * endpoints que mudam estado. `:id` é sempre validado contra uma conta REAL
 * do Mercado Livre (`findByIdOrFail` + checagem de marketplace) — um UUID de
 * outra conta/marketplace nunca é aceito. Nunca devolve token,
 * `external_shipment_id`, `external_order_id` ou resposta do provedor — só
 * os campos já sanitizados de `MlLogisticsReclassificationAccountStatus`.
 *
 * As rotas `mercado-livre/logistics-reclassification/*` ("todas as contas")
 * são declaradas ANTES das rotas `:id/logistics-reclassification/*` de
 * propósito: o Express resolve `:id` como qualquer segmento único de path
 * na ordem de registro dos métodos — sem essa ordem, uma requisição para
 * `.../mercado-livre/logistics-reclassification/status` cairia na rota
 * `:id` com `id = "mercado-livre"` e falharia em `ParseUUIDPipe`.
 */
/**
 * Checkpoint 5A: leitura (`status`/`statusAll`) exige `sync.view`; ações
 * (`start`/`pause`/`resume`/`*All`) exigem `sync.full_history`. Rotas por
 * `:id` validam a conta via `ScopedMarketplaceAccountService` (404 genérico
 * se fora do escopo); rotas `*All` repassam `accountScope` ao service, que
 * filtra via `findAllForScope` — operações globais só alcançam contas ML
 * que o usuário pode ver.
 */
@ApiTags('mercado-livre-orders')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('marketplace-accounts')
export class MlLogisticsReclassificationController {
  constructor(
    private readonly service: MlLogisticsReclassificationService,
    private readonly scopedMarketplaceAccountService: ScopedMarketplaceAccountService,
  ) {}

  @Get('mercado-livre/logistics-reclassification/status')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  async statusAll(
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.getStatusForAllAccounts(context.accountScope);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mercado-livre/logistics-reclassification/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_FULL_HISTORY)
  async startAll(
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.startAll(context.accountScope);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mercado-livre/logistics-reclassification/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_FULL_HISTORY)
  async pauseAll(
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.pauseAll(context.accountScope);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mercado-livre/logistics-reclassification/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_FULL_HISTORY)
  async resumeAll(
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.resumeAll(context.accountScope);
  }

  @Get(':id/logistics-reclassification/status')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  async status(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.service.getStatus(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/logistics-reclassification/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_FULL_HISTORY)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.service.start(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/logistics-reclassification/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_FULL_HISTORY)
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.service.pause(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/logistics-reclassification/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.SYNC_FULL_HISTORY)
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      return await this.service.resume(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): Error {
    if (error instanceof MlLogisticsReclassificationError) {
      return new BadRequestException(error.code);
    }
    return error as Error;
  }
}
