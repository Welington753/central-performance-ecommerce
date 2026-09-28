import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../password-policy';

/**
 * Sem campo de confirmação: nenhum outro endpoint deste projeto usa o
 * padrão "digite a senha duas vezes" hoje — decisão documentada, não uma
 * omissão (ver relatório do Checkpoint 3).
 */
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword!: string;
}
