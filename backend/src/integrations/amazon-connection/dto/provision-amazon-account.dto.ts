import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body fechado (Checkpoint 4-C) — allowlist estrita, exatamente estes dois
 * campos. O `ValidationPipe` global (`forbidNonWhitelisted: true`, main.ts)
 * rejeita qualquer campo extra (ex.: `lwaClientSecret`, `accessToken`)
 * antes mesmo de chegar ao controller. Nunca aceita LWA Client Secret pelo
 * frontend — essa credencial é exclusivamente de aplicação, vive só no
 * `.env` do backend (`AMAZON_LWA_CLIENT_SECRET`).
 */
export class ProvisionAmazonAccountDto {
  @ApiProperty({ description: 'Selling Partner ID da conta Amazon.' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'sellingPartnerId deve conter apenas letras e números.',
  })
  sellingPartnerId!: string;

  @ApiProperty({
    description:
      'Refresh token obtido pela autoautorização da aplicação privada Amazon.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  refreshToken!: string;
}
