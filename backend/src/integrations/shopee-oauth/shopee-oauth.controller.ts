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
import { AuthorizationContext } from '../../auth/decorators/authorization-context.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  PermissionGuard,
  RequirePermissions,
} from '../../auth/guards/permission.guard';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import type { AuthorizationContext as AuthorizationContextType } from '../../users/authorization-context.interface';
import { PERMISSIONS } from '../../users/permissions.catalog';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { ShopeeOAuthService } from './shopee-oauth.service';

/**
 * Controller HTTP da Shopee (Checkpoint CP2D). Checkpoint 5A: `connect`
 * exige `integrations.manage` e a conta estar no `accountScope` do usuário
 * (`ScopedMarketplaceAccountService`, 404 genérico antes de iniciar o OAuth);
 * `callback` continua público, autorizado exclusivamente pelo `state`
 * reivindicado atomicamente dentro do service — nunca guardado.
 */
@ApiTags('shopee-oauth')
@Controller()
export class ShopeeOAuthController {
  constructor(
    private readonly service: ShopeeOAuthService,
    private readonly scopedMarketplaceAccountService: ScopedMarketplaceAccountService,
  ) {}

  @ApiCookieAuth()
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
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
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<{ authorizationUrl: string }> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
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
