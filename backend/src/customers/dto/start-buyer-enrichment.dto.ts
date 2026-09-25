import { IsOptional, IsUUID } from 'class-validator';

export class StartBuyerEnrichmentDto {
  /** Ausente = todas as contas Mercado Livre/Shopee conectadas. */
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
