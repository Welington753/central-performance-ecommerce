import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

export class AccountScopeInputDto {
  @ApiProperty({ enum: ['ALL', 'SELECTED', 'NONE'] })
  @IsIn(['ALL', 'SELECTED', 'NONE'])
  mode!: 'ALL' | 'SELECTED' | 'NONE';

  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  accountIds?: string[];
}
