import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AccountScopeInputDto } from './account-scope-input.dto';
import { PermissionOverrideInputDto } from './permission-override-input.dto';

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['ADMIN', 'ANALYST', 'VIEWER'] })
  @IsIn(['ADMIN', 'ANALYST', 'VIEWER'])
  role!: 'ADMIN' | 'ANALYST' | 'VIEWER';

  @ApiProperty({ type: [PermissionOverrideInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideInputDto)
  overrides?: PermissionOverrideInputDto[];

  @ApiProperty({ type: AccountScopeInputDto })
  @ValidateNested()
  @Type(() => AccountScopeInputDto)
  accountScope!: AccountScopeInputDto;
}
