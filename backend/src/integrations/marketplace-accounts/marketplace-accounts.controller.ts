import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AuthorizationContext } from '../../auth/decorators/authorization-context.decorator';
import {
  PermissionGuard,
  RequirePermissions,
} from '../../auth/guards/permission.guard';
import type { AuthorizationContext as AuthorizationContextType } from '../../users/authorization-context.interface';
import { PERMISSIONS } from '../../users/permissions.catalog';
import { CreateMarketplaceAccountDto } from './dto/create-marketplace-account.dto';
import { RenameMarketplaceAccountDto } from './dto/rename-marketplace-account.dto';
import { toMarketplaceAccountResponse } from './dto/marketplace-account-response.dto';
import type { MarketplaceAccountResponseDto } from './dto/marketplace-account-response.dto';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { ScopedMarketplaceAccountService } from './scoped-marketplace-account.service';
import {
  InvalidNicknameError,
  NicknameAlreadyInUseError,
} from './nickname.util';

/**
 * Checkpoint 5A: `GET` exige `integrations.view` e devolve só as contas do
 * `accountScope` resolvido (nunca todas — ver `findAllForScope`). Mutações
 * exigem `integrations.manage` **e** que a conta esteja no escopo do usuário
 * (`ScopedMarketplaceAccountService`, 404 genérico se não estiver — nunca
 * distinguível de "não existe"). `POST` (criação, sem `:accountId` ainda) é a
 * ÚNICA rota sem conta prévia para validar — por isso exige explicitamente
 * `accountScope.mode === 'ALL'`; `SELECTED`/`NONE` nunca podem criar contas
 * novas "às cegas" fora do que já enxergam.
 */
@ApiTags('marketplace-accounts')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard, PermissionGuard)
@Controller('marketplace-accounts')
export class MarketplaceAccountsController {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly scopedMarketplaceAccountService: ScopedMarketplaceAccountService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_VIEW)
  async findAll(
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MarketplaceAccountResponseDto[]> {
    const accounts = await this.marketplaceAccountsService.findAllForScope(
      context.accountScope,
    );
    return accounts.map(toMarketplaceAccountResponse);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async create(
    @Body() dto: CreateMarketplaceAccountDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MarketplaceAccountResponseDto> {
    // Nenhum `:accountId` existe ainda para validar escopo contra — só
    // `accountScope.mode === 'ALL'` pode criar. `integrations.manage`
    // sozinho nunca é interpretado como autorização para criar fora do
    // escopo (documentado no plano do Checkpoint 5A).
    if (context.accountScope.mode !== 'ALL') {
      throw new ForbiddenException('ACCOUNT_SCOPE_DENIED');
    }
    // Mapeamento explícito (nunca `...dto`): garante que, mesmo que o DTO
    // ganhe campos novos no futuro, só o que está listado aqui chega ao
    // serviço — `externalSellerId` nunca é aceito nesta rota.
    const account = await this.marketplaceAccountsService.create({
      marketplace: dto.marketplace,
      nickname: dto.nickname ?? null,
    });
    return toMarketplaceAccountResponse(account);
  }

  @Patch(':id/nickname')
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameMarketplaceAccountDto,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MarketplaceAccountResponseDto> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    try {
      const account = await this.marketplaceAccountsService.rename(
        id,
        dto.nickname,
      );
      return toMarketplaceAccountResponse(account);
    } catch (error) {
      if (error instanceof InvalidNicknameError) {
        throw new UnprocessableEntityException(error.code);
      }
      if (error instanceof NicknameAlreadyInUseError) {
        throw new ConflictException(error.code);
      }
      throw error;
    }
  }

  @Post(':id/disconnect')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INTEGRATIONS_MANAGE)
  async disconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @AuthorizationContext() context: AuthorizationContextType,
  ): Promise<MarketplaceAccountResponseDto> {
    await this.scopedMarketplaceAccountService.assertAllowedAndFindOrFail(
      context.accountScope,
      id,
    );
    const account = await this.marketplaceAccountsService.disconnect(id);
    return toMarketplaceAccountResponse(account);
  }
}
