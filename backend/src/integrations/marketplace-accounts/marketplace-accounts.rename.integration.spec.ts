import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from './marketplace-account.entity';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { toMarketplaceAccountResponse } from './dto/marketplace-account-response.dto';
import {
  InvalidNicknameError,
  NicknameAlreadyInUseError,
} from './nickname.util';

describe('MarketplaceAccountsService.rename (Postgres real)', () => {
  let dataSource: DataSource;
  let service: MarketplaceAccountsService;

  beforeAll(async () => {
    dataSource = await createTestDataSource([MarketplaceAccount]);
    service = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
  });

  async function seedAccount(
    overrides: {
      marketplace?: Marketplace;
      status?: MarketplaceAccountStatus;
      externalSellerId?: string | null;
      nickname?: string | null;
      tokenVersion?: number;
    } = {},
  ): Promise<MarketplaceAccount> {
    return dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: overrides.marketplace ?? Marketplace.MERCADO_LIVRE,
      externalSellerId: overrides.externalSellerId ?? null,
      nickname: overrides.nickname ?? null,
      status: overrides.status ?? MarketplaceAccountStatus.DISCONNECTED,
      encryptedAccessToken: 'secret-access-token',
      encryptedRefreshToken: 'secret-refresh-token',
      tokenVersion: overrides.tokenVersion ?? 3,
    });
  }

  it('rejects renaming a nonexistent account', async () => {
    await expect(service.rename(randomUUID(), 'Meli 1')).rejects.toThrow(
      'Conta de marketplace não encontrada.',
    );
  });

  it('renames a connected account', async () => {
    const account = await seedAccount({
      status: MarketplaceAccountStatus.CONNECTED,
      externalSellerId: '111',
    });

    const renamed = await service.rename(account.id, 'Meli 1');

    expect(renamed.nickname).toBe('Meli 1');
  });

  it('renames a disconnected account', async () => {
    const account = await seedAccount();

    const renamed = await service.rename(account.id, 'Meli 2');

    expect(renamed.nickname).toBe('Meli 2');
  });

  it('persists the nickname after reload', async () => {
    const account = await seedAccount();
    await service.rename(account.id, 'Loja Principal');

    const reloaded = await service.findByIdOrFail(account.id);

    expect(reloaded.nickname).toBe('Loja Principal');
  });

  it('trims and collapses repeated internal spaces', async () => {
    const account = await seedAccount();

    const renamed = await service.rename(account.id, '  Meli   Loja   1  ');

    expect(renamed.nickname).toBe('Meli Loja 1');
  });

  it('restores the default name when nickname is set back to null', async () => {
    const account = await seedAccount({ nickname: 'Meli 1' });

    const renamed = await service.rename(account.id, null);

    expect(renamed.nickname).toBeNull();
  });

  it('rejects an empty nickname', async () => {
    const account = await seedAccount();

    await expect(service.rename(account.id, '   ')).rejects.toThrow(
      InvalidNicknameError,
    );
  });

  it('rejects a nickname longer than 60 characters', async () => {
    const account = await seedAccount();

    await expect(service.rename(account.id, 'a'.repeat(61))).rejects.toThrow(
      InvalidNicknameError,
    );
  });

  it('rejects a nickname with disallowed characters', async () => {
    const account = await seedAccount();

    await expect(service.rename(account.id, 'Meli <script>')).rejects.toThrow(
      InvalidNicknameError,
    );
  });

  it('accepts accents, numbers, hyphen and simple punctuation', async () => {
    const account = await seedAccount();

    const renamed = await service.rename(
      account.id,
      'Loja São Paulo - Filial nº 2, oficial!',
    );

    expect(renamed.nickname).toBe('Loja São Paulo - Filial nº 2, oficial!');
  });

  it('rejects a duplicate nickname within the same marketplace, case-insensitively', async () => {
    await seedAccount({ nickname: 'Meli 1' });
    const other = await seedAccount();

    await expect(service.rename(other.id, 'meli 1')).rejects.toThrow(
      NicknameAlreadyInUseError,
    );
  });

  it('allows the same nickname across different marketplaces', async () => {
    await seedAccount({
      marketplace: Marketplace.MERCADO_LIVRE,
      nickname: 'Loja 1',
    });
    const amazonAccount = await seedAccount({
      marketplace: Marketplace.AMAZON,
    });

    const renamed = await service.rename(amazonAccount.id, 'Loja 1');

    expect(renamed.nickname).toBe('Loja 1');
  });

  it('allows keeping/reassigning the same nickname the account already has', async () => {
    const account = await seedAccount({ nickname: 'Meli 1' });

    const renamed = await service.rename(account.id, 'Meli 1');

    expect(renamed.nickname).toBe('Meli 1');
  });

  it('rejects a concurrent rename to the same nickname at the database level', async () => {
    await seedAccount({ nickname: 'Meli 1' });
    const other = await seedAccount();

    // Simula a corrida: dois processos passam pela checagem em memória antes
    // de qualquer um commitar — o INSERT/UPDATE direto no repositório
    // contorna a checagem de `rename()` para provar que o índice único do
    // Postgres é a barreira final, não apenas a leitura prévia do service.
    await expect(
      dataSource
        .getRepository(MarketplaceAccount)
        .save({ ...other, nickname: 'meli 1' }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);
  });

  it('never changes externalSellerId, status, or tokenVersion when renaming', async () => {
    const account = await seedAccount({
      status: MarketplaceAccountStatus.CONNECTED,
      externalSellerId: '222',
      tokenVersion: 7,
    });

    const renamed = await service.rename(account.id, 'Meli 1');

    expect(renamed.externalSellerId).toBe('222');
    expect(renamed.status).toBe(MarketplaceAccountStatus.CONNECTED);
    expect(renamed.tokenVersion).toBe(7);
    expect(renamed.encryptedAccessToken).toBe('secret-access-token');
    expect(renamed.encryptedRefreshToken).toBe('secret-refresh-token');
  });

  it('never exposes tokens through the public DTO after renaming', async () => {
    const account = await seedAccount({
      status: MarketplaceAccountStatus.CONNECTED,
    });

    const renamed = await service.rename(account.id, 'Meli 1');
    const dto = toMarketplaceAccountResponse(renamed);

    expect(dto).not.toHaveProperty('encryptedAccessToken');
    expect(dto).not.toHaveProperty('encryptedRefreshToken');
    expect(dto).not.toHaveProperty('tokenVersion');
    expect(dto.nickname).toBe('Meli 1');
  });

  it('falls back to no nickname for accounts that were never renamed', async () => {
    const account = await seedAccount();

    expect(account.nickname).toBeNull();
  });
});
