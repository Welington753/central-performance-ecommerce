import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, ValidateIf } from 'class-validator';

/**
 * `nickname: null` restaura o nome padrão (limpa o apelido). `undefined`
 * (campo ausente) é rejeitado pelo `ValidationPipe` global
 * (`forbidNonWhitelisted`) antes mesmo de chegar aqui — o corpo sempre
 * precisa declarar o campo, com `null` explícito quando a intenção é
 * remover o apelido.
 */
export class RenameMarketplaceAccountDto {
  @ApiProperty({ nullable: true, maxLength: 60 })
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(60)
  nickname!: string | null;
}
