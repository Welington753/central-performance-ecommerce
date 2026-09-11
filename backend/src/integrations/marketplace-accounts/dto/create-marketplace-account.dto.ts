import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Marketplace } from '../../contracts/marketplace.enum';

export class CreateMarketplaceAccountDto {
  // Checkpoint CP2E: Shopee entra na allowlist — o conector OAuth já existe
  // (`ShopeeOAuthService.startConnection`), que exige uma conta pré-existente
  // com `marketplace = SHOPEE` para conectar.
  @ApiProperty({
    enum: [Marketplace.MERCADO_LIVRE, Marketplace.AMAZON, Marketplace.SHOPEE],
  })
  @IsIn([Marketplace.MERCADO_LIVRE, Marketplace.AMAZON, Marketplace.SHOPEE])
  marketplace!:
    Marketplace.MERCADO_LIVRE | Marketplace.AMAZON | Marketplace.SHOPEE;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  nickname?: string;

  // Deliberadamente SEM campo `externalSellerId`: o `ValidationPipe` global
  // (`forbidNonWhitelisted: true`, main.ts) rejeita qualquer corpo que o
  // inclua. Só é preenchido pelo backend após a identidade ser confirmada
  // via `/users/me` (design §6.2) — nunca aceito do cliente.
}
