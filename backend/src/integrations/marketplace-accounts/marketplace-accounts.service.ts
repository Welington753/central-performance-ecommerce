import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Marketplace } from '../contracts/marketplace.enum';
import type { CreateMarketplaceAccountInput } from './dto/create-marketplace-account.input';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from './marketplace-account.entity';

export interface FindMarketplaceAccountsFilter {
  marketplace?: Marketplace;
}

@Injectable()
export class MarketplaceAccountsService {
  constructor(
    @InjectRepository(MarketplaceAccount)
    private readonly repository: Repository<MarketplaceAccount>,
  ) {}

  findAll(
    filter: FindMarketplaceAccountsFilter = {},
  ): Promise<MarketplaceAccount[]> {
    return this.repository.find({
      where: filter.marketplace ? { marketplace: filter.marketplace } : {},
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Pré-cadastra uma conta de marketplace, sempre em status DISCONNECTED e
   * sem nenhuma credencial. Nenhuma chamada externa é feita aqui — apenas a
   * criação do registro que uma futura fase de OAuth virá completar.
   *
   * A unicidade real de (marketplace, externalSellerId) quando não nulo é
   * garantida pelo índice único parcial no Postgres (ver migration inicial);
   * aqui apenas montamos e persistimos a entidade.
   */
  async create(
    input: CreateMarketplaceAccountInput,
  ): Promise<MarketplaceAccount> {
    const account = this.repository.create({
      marketplace: input.marketplace,
      externalSellerId: input.externalSellerId ?? null,
      nickname: input.nickname ?? null,
      status: MarketplaceAccountStatus.DISCONNECTED,
    });
    return this.repository.save(account);
  }
}
