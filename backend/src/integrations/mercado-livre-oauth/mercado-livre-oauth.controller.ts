import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import type { CallbackQuery } from './callback-params.validator';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

@ApiTags('mercado-livre-oauth')
@Controller()
export class MercadoLivreOAuthController {
  constructor(private readonly service: MercadoLivreOAuthService) {}

  @ApiCookieAuth()
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('marketplace-accounts/:id/mercado-livre/connect')
  @HttpCode(HttpStatus.OK)
  async connect(
    // `ParseUUIDPipe` rejeita IDs inválidos com 400 antes de chegarem ao
    // Postgres — sem isso, um `:id` mal formado vira erro 500 (sintaxe
    // inválida para `uuid`) em vez de um 404/400 previsível.
    @Param('id', ParseUUIDPipe) id: string,
    // `AccessTokenGuard` (acima) garante que a requisição nunca chega aqui
    // sem um usuário autenticado válido — por isso `user` não é opcional, e
    // não há `user!` escondendo essa garantia do compilador.
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<{ authorizationUrl: string }> {
    return this.service.startConnection({
      marketplaceAccountId: id,
      initiatedByUserId: user.sub,
    });
  }

  // Público, sem AccessTokenGuard (design §6.2) — autorizado exclusivamente
  // pelo `state` reivindicado atomicamente dentro do próprio service.
  @Get('integrations/mercado-livre/callback')
  async callback(
    @Query() query: CallbackQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { redirectUrl } = await this.service.handleCallback(query);
    res.redirect(302, redirectUrl);
  }
}
