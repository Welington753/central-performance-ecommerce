import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Marketplace } from '../../contracts/marketplace.enum';

export class CreateMarketplaceAccountDto {
  @ApiProperty({ enum: [Marketplace.MERCADO_LIVRE] })
  @IsIn([Marketplace.MERCADO_LIVRE])
  marketplace!: Marketplace.MERCADO_LIVRE;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nickname?: string;

  // Deliberadamente SEM campo `externalSellerId`: o `ValidationPipe` global
  // (`forbidNonWhitelisted: true`, main.ts) rejeita qualquer corpo que o
  // inclua. Só é preenchido pelo backend após a identidade ser confirmada
  // via `/users/me` (design §6.2) — nunca aceito do cliente.
}
