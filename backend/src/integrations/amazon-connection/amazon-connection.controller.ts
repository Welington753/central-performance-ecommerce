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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import type { MarketplaceAccountResponseDto } from '../marketplace-accounts/dto/marketplace-account-response.dto';
import { AmazonConnectionService } from './amazon-connection.service';
import { ProvisionAmazonAccountDto } from './dto/provision-amazon-account.dto';
import type { AmazonSetupStatusResponseDto } from './dto/amazon-setup-status-response.dto';
import type { AmazonVerifyConnectionResponseDto } from './dto/amazon-verify-connection-response.dto';

/**
 * Conexão/configuração da conta Amazon (Checkpoint 4-C) — protegido pelo
 * MESMO `AccessTokenGuard` usado para gerenciar conexões do Mercado Livre
 * (`MercadoLivreOAuthController`). Nunca expõe nenhum valor de credencial:
 * ver os DTOs de resposta em `dto/`.
 */
@ApiTags('amazon-connection')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller()
export class AmazonConnectionController {
  constructor(private readonly service: AmazonConnectionService) {}

  // `no-store` (não só `no-cache`): esta resposta reflete configuração de
  // servidor e estado de conta que muda em runtime — nunca deve ser servida
  // de um cache HTTP intermediário nem do bfcache do navegador.
  @Header('Cache-Control', 'no-store')
  @Get('integrations/amazon/setup-status')
  async setupStatus(): Promise<AmazonSetupStatusResponseDto> {
    return this.service.getSetupStatus();
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('marketplace-accounts/:id/amazon/provision')
  @HttpCode(HttpStatus.OK)
  async provision(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProvisionAmazonAccountDto,
    // `AccessTokenGuard` (acima) garante que a requisição nunca chega aqui
    // sem um usuário autenticado válido.
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<MarketplaceAccountResponseDto> {
    return this.service.provision(id, dto, user.sub);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('marketplace-accounts/:id/amazon/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AmazonVerifyConnectionResponseDto> {
    return this.service.verify(id);
  }
}
