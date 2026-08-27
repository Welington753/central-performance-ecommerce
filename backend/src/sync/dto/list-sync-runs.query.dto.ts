import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Marketplace } from '../../integrations/contracts/marketplace.enum';

export class ListSyncRunsQueryDto {
  @IsOptional()
  @IsUUID()
  marketplaceAccountId?: string;

  @IsOptional()
  @IsEnum(Marketplace)
  marketplace?: Marketplace;
}
