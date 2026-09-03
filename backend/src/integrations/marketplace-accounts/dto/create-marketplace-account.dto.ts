import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Marketplace } from '../../contracts/marketplace.enum';

export class CreateMarketplaceAccountDto {
  // Checkpoint 4-C: Amazon também tem conector wired (Fase 4) — Shopee
  // continua fora da allowlist (nenhum conector existe ainda).
  @ApiProperty({ enum: [Marketplace.MERCADO_LIVRE, Marketplace.AMAZON] })
  @IsIn([Marketplace.MERCADO_LIVRE, Marketplace.AMAZON])
  marketplace!: Marketplace.MERCADO_LIVRE | Marketplace.AMAZON;

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
