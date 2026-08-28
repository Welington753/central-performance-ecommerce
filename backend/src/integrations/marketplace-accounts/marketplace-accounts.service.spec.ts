import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from './marketplace-account.entity';
import { MarketplaceAccountsService } from './marketplace-accounts.service';

/**
 * Repositório fake em memória que replica, de forma simplificada, o índice
 * único parcial do Postgres:
 *   CREATE UNIQUE INDEX ... ON marketplace_accounts (marketplace, external_seller_id)
 *   WHERE external_seller_id IS NOT NULL
 *
 * Ou seja: duas contas do mesmo marketplace SEM externalSellerId podem
 * coexistir, mas duas contas do mesmo marketplace COM o mesmo
 * externalSellerId (não nulo) devem ser rejeitadas.
 */
class FakeMarketplaceAccountRepository {
  private readonly rows: MarketplaceAccount[] = [];

  create(partial: Partial<MarketplaceAccount>): MarketplaceAccount {
    return {
      id: randomUUID(),
      marketplace: partial.marketplace as Marketplace,
      externalSellerId: partial.externalSellerId ?? null,
      nickname: partial.nickname ?? null,
      status: partial.status ?? MarketplaceAccountStatus.DISCONNECTED,
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      encryptedCredentialMetadata: null,
      tokenExpiresAt: null,
      lastSuccessfulSyncAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      errorSummary: null,
      failureCode: null,
      connectedByUserId: null,
      tokenVersion: 0,
    };
  }

  save(entity: MarketplaceAccount): Promise<MarketplaceAccount> {
    if (entity.externalSellerId !== null) {
      const conflict = this.rows.find(
        (row) =>
          row.id !== entity.id &&
          row.marketplace === entity.marketplace &&
          row.externalSellerId === entity.externalSellerId,
      );
      if (conflict) {
        return Promise.reject(
          new Error(
            'duplicate key value violates unique constraint "UQ_marketplace_accounts_marketplace_external_seller_id"',
          ),
        );
      }
    }
    this.rows.push(entity);
    return Promise.resolve(entity);
  }

  find(): Promise<MarketplaceAccount[]> {
    return Promise.resolve([...this.rows]);
  }
}

describe('MarketplaceAccountsService', () => {
  let service: MarketplaceAccountsService;
  let fakeRepository: FakeMarketplaceAccountRepository;

  beforeEach(async () => {
    fakeRepository = new FakeMarketplaceAccountRepository();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MarketplaceAccountsService,
        {
          provide: getRepositoryToken(MarketplaceAccount),
          useValue: fakeRepository,
        },
      ],
    }).compile();

    service = moduleRef.get(MarketplaceAccountsService);
  });

  it('registers two accounts of different marketplaces without conflict', async () => {
    const mercadoLivre = await service.create({
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    const amazon = await service.create({ marketplace: Marketplace.AMAZON });

    expect(mercadoLivre.status).toBe(MarketplaceAccountStatus.DISCONNECTED);
    expect(amazon.status).toBe(MarketplaceAccountStatus.DISCONNECTED);
    await expect(service.findAll()).resolves.toHaveLength(2);
  });

  it('registers more than one account of the same marketplace when externalSellerId is absent', async () => {
    await service.create({ marketplace: Marketplace.MERCADO_LIVRE });
    await service.create({ marketplace: Marketplace.MERCADO_LIVRE });

    await expect(service.findAll()).resolves.toHaveLength(2);
  });

  it('allows one connected account (with externalSellerId) and one pending account (without) for the same marketplace', async () => {
    await service.create({
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '123456',
    });
    await service.create({ marketplace: Marketplace.MERCADO_LIVRE });

    await expect(service.findAll()).resolves.toHaveLength(2);
  });

  it('creates a new account with the OAuth bookkeeping fields at their defaults', async () => {
    const account = await service.create({ marketplace: Marketplace.MERCADO_LIVRE });

    expect(account.errorSummary).toBeNull();
    expect(account.failureCode).toBeNull();
    expect(account.connectedByUserId).toBeNull();
    expect(account.tokenVersion).toBe(0);
  });

  it('rejects two accounts of the same marketplace with the same non-null externalSellerId', async () => {
    await service.create({
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '123456',
    });

    await expect(
      service.create({
        marketplace: Marketplace.MERCADO_LIVRE,
        externalSellerId: '123456',
      }),
    ).rejects.toThrow(/unique constraint/i);
  });
});
