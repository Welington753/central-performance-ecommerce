import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  MANUAL_RESPONSIBILITIES,
  type ManualProblemResponsibility,
} from '../marketplace-problems.types';

export class UpdateProblemResponsibilityDto {
  @IsIn(MANUAL_RESPONSIBILITIES)
  responsibility!: ManualProblemResponsibility;

  /** Obrigatório — texto livre do usuário (nunca logado nem enviado a terceiros). */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
