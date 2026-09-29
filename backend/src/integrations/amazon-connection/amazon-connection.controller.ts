import {
  Body,
  Controller,
  Get,
  Header,
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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import {
  PermissionGuard,
  RequirePermissions,
} from '../../auth/guards/permission.guard';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import type { AuthorizationContext as AuthorizationContextType } from '../../users/authorization-context.interface';
import { PERMISSIONS } from '../../users/permissions.catalog';
import type { MarketplaceAccountResponseDto } from '../marketplace-accounts/dto/marketplace-account-response.dto';
import { ScopedMarketplaceAccountService } from '../marketplace-accounts/scoped-marketplace-account.service';
import { AmazonConnectionService } from './amazon-connection.service';
import { ProvisionAmazonAccountDto } from './dto/provision-amazon-account.dto';
import type { AmazonSetupStatusResponseDto } from './dto/amazon-setup-status-response.dto';
import type { AmazonVerifyConnectionResponseDto } from './dto/amazon-verify-connection-response.dto';

/**
 * Conexão/configuração da conta Amazon (Checkpoint 4-C). Checkpoint 5A:
 * `setup-status` (sem conta específica) exige `integrations.view`;
 * `provision`/`verify` (têm `:id`) exigem `integrations.manage` **e** a
 * conta estar no `accountScope` do usuário (`ScopedMarketplaceAccountService`
 * — 404 genérico se não estiver, antes de qualquer chamada à Amazon). Nunca
 * expõe nenhum valor de credencial: ver os DTOs de resposta em `dto/`.
 */
@ApiTags('amazon-connection')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller()
export class AmazonConnectionController {
  constructor(
    private readonly service: AmazonConnectionService,
    private readonly scopedMarketplaceAccountService: ScopedMarketplaceAccountService,
  ) {}

  // `no-store` (não só `no-cache`): esta resposta reflete configuração de
  // servidor e estado de conta que muda em runtime — nunca deve ser servida
  // de um cache HTTP intermediário nem do bfcache do navegador.
  @Header('Cache-Control', 'no-store')
  @Get('integrations/amazon/setup-status')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_VIEW)
  async setupStatus(): Promise<AmazonSetupStatusResponseDto> {
    return this.service.getSetupStatus();
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('marketplace-accounts/:id/amazon/provision')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async provision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProvisionAmazonAccountDto,
    // `AccessTokenGuard` (acima) garante que a requisição nunca chega aqui
    // sem um usuário autenticado válido.
    @CurrentUser() user: AccessTokenPayload,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MarketplaceAccountResponseDto> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    return this.service.provision(id, dto, user.sub);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('marketplace-accounts/:id/amazon/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<AmazonVerifyConnectionResponseDto> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    return this.service.verify(id);
  }
}
