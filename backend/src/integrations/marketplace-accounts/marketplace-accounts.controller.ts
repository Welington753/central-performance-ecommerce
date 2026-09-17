import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { CreateMarketplaceAccountDto } from './dto/create-marketplace-account.dto';
import { RenameMarketplaceAccountDto } from './dto/rename-marketplace-account.dto';
import { toMarketplaceAccountResponse } from './dto/marketplace-account-response.dto';
import type { MarketplaceAccountResponseDto } from './dto/marketplace-account-response.dto';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import {
  InvalidNicknameError,
  NicknameAlreadyInUseError,
} from './nickname.util';

@ApiTags('marketplace-accounts')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-accounts')
export class MarketplaceAccountsController {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
  ) {}

  @Get()
  async findAll(): Promise<MarketplaceAccountResponseDto[]> {
    const accounts = await this.marketplaceAccountsService.findAll();
    return accounts.map(toMarketplaceAccountResponse);
  }

  @Post()
  async create(
    @Body() dto: CreateMarketplaceAccountDto,
  ): Promise<MarketplaceAccountResponseDto> {
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
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameMarketplaceAccountDto,
  ): Promise<MarketplaceAccountResponseDto> {
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
  async disconnect(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MarketplaceAccountResponseDto> {
    const account = await this.marketplaceAccountsService.disconnect(id);
    return toMarketplaceAccountResponse(account);
  }
}
