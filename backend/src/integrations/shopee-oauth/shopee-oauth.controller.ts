import {
  Controller,
  Get,
  Header,
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
import { ShopeeOAuthService } from './shopee-oauth.service';

/**
 * Controller HTTP da Shopee (Checkpoint CP2D) — mesma autorização/proteção
 * do Mercado Livre (`MercadoLivreOAuthController`): `connect` exige
 * `AccessTokenGuard` (sem RBAC/ownership adicional nesta fase, design §6.1
 * já aplicado ao ML); `callback` é público (autorizado exclusivamente pelo
 * `state` reivindicado atomicamente dentro do service).
 */
@ApiTags('shopee-oauth')
@Controller()
export class ShopeeOAuthController {
  constructor(private readonly service: ShopeeOAuthService) {}

  @ApiCookieAuth()
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  // `no-store`: a resposta reflete estado de conta/configuração que muda em
  // runtime — nunca pode ser servida de um cache HTTP intermediário nem do
  // bfcache do navegador.
  @Header('Cache-Control', 'no-store')
  @Post('marketplace-accounts/:id/shopee/connect')
  @HttpCode(HttpStatus.OK)
  async connect(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<{ authorizationUrl: string }> {
    return this.service.startConnection({
      marketplaceAccountId: id,
      initiatedByUserId: user.sub,
    });
  }

  // Público, sem AccessTokenGuard (mesmo design do callback do Mercado
  // Livre) — autorizado exclusivamente pelo `state` reivindicado
  // atomicamente dentro do próprio service. `no-store` pela mesma razão do
  // `connect`; `no-referrer` para que a URL do redirect final (que nunca
  // carrega segredo, mas é específica da aplicação) não seja propagada via
  // cabeçalho `Referer` para o destino do redirect.
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Get('integrations/shopee/callback')
  async callback(
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const { redirectUrl } = await this.service.handleCallback({
      state: query.state,
      code: query.code,
      shopId: query.shop_id,
    });
    res.redirect(302, redirectUrl);
  }
}
