import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Marketplace } from '../../contracts/marketplace.enum';
import {
  PROBLEM_ACTION_DUE_FILTERS,
  PROBLEM_REPUTATION_IMPACTS,
  PROBLEM_RESPONSIBILITIES,
  PROBLEM_SORT_FIELDS,
  type ProblemActionDueFilter,
  type ProblemResponsibility,
  type ProblemSortField,
} from '../marketplace-problems.types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros compartilhados por `GET /problems`, `/problems/summary` e `/problems/reasons`. */
export class ProblemsFilterQueryDto {
  @IsOptional()
  @IsEnum(Marketplace)
  marketplace?: Marketplace;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @Matches(DATE_ONLY)
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  stage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reasonId?: string;

  @IsOptional()
  @IsIn(PROBLEM_RESPONSIBILITIES)
  responsibility?: ProblemResponsibility;

  @IsOptional()
  @IsIn(PROBLEM_REPUTATION_IMPACTS)
  reputationImpact?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  pendingAction?: boolean;

  @IsOptional()
  @IsIn(PROBLEM_ACTION_DUE_FILTERS)
  actionDue?: ProblemActionDueFilter;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  orderId?: string;
}

export class ListProblemsQueryDto extends ProblemsFilterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(PROBLEM_SORT_FIELDS)
  sortBy?: ProblemSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
