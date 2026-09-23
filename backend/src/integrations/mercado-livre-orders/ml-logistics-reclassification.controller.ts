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
@ApiTags('mercado-livre-orders')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-accounts')
export class MlLogisticsReclassificationController {
  constructor(private readonly service: MlLogisticsReclassificationService) {}

  @Get('mercado-livre/logistics-reclassification/status')
  async statusAll(): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.getStatusForAllAccounts();
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mercado-livre/logistics-reclassification/start')
  @HttpCode(HttpStatus.OK)
  async startAll(): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.startAll();
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mercado-livre/logistics-reclassification/pause')
  @HttpCode(HttpStatus.OK)
  async pauseAll(): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.pauseAll();
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('mercado-livre/logistics-reclassification/resume')
  @HttpCode(HttpStatus.OK)
  async resumeAll(): Promise<MlLogisticsReclassificationAccountStatus[]> {
    return this.service.resumeAll();
  }

  @Get(':id/logistics-reclassification/status')
  async status(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    try {
      return await this.service.getStatus(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/logistics-reclassification/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    try {
      return await this.service.start(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/logistics-reclassification/pause')
  @HttpCode(HttpStatus.OK)
  async pause(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
    try {
      return await this.service.pause(id);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post(':id/logistics-reclassification/resume')
  @HttpCode(HttpStatus.OK)
  async resume(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MlLogisticsReclassificationAccountStatus> {
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
