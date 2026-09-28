import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AccountScopeInputDto } from './account-scope-input.dto';
import { PermissionOverrideInputDto } from './permission-override-input.dto';

/**
 * Todo campo é opcional — só o que for enviado é alterado. `overrides`
 * (quando enviado) SUBSTITUI a lista inteira, nunca faz merge parcial;
 * mesma regra para `accountScope`. Ver `UsersManagementService.update`.
 */
export class UpdateUserDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @ApiProperty({ enum: ['ADMIN', 'ANALYST', 'VIEWER'], required: false })
  @IsOptional()
  @IsIn(['ADMIN', 'ANALYST', 'VIEWER'])
  role?: 'ADMIN' | 'ANALYST' | 'VIEWER';

  @ApiProperty({ type: [PermissionOverrideInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideInputDto)
  overrides?: PermissionOverrideInputDto[];

  @ApiProperty({ type: AccountScopeInputDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => AccountScopeInputDto)
  accountScope?: AccountScopeInputDto;
}
