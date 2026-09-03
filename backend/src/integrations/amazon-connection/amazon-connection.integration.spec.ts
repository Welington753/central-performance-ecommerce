import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AmazonAuthService } from '../amazon-sp-api/amazon-auth.service';
import { AmazonConnectionService } from './amazon-connection.service';

const ENCRYPTION_KEY = 'cd'.repeat(32); // 32 bytes em hex — fictícia, só para teste

function buildEncryptionService(): EncryptionService {
  const configService = {
    get: (key: string) =>
      key === 'CREDENTIAL_ENCRYPTION_KEY' ? ENCRYPTION_KEY : undefined,
  } as unknown as ConfigService;
  return new EncryptionService(configService);
}

interface RawAccountRow {
  encrypted_refresh_token: string | null;
  encrypted_access_token: string | null;
  token_expires_at: Date | null;
  status: string;
  token_version: number;
  external_seller_id: string | null;
}

/**
 * Testes contra Postgres REAL (Checkpoint 4-C) — provam que o refresh token
 * chega CIFRADO na coluna (nunca texto plano), que o reprovisionamento
 * limpa o access token antigo de fato na linha, e que o CAS por
 * `tokenVersion` funciona contra o banco de verdade, não apenas mockado.
 */
describe('AmazonConnectionService.provision (Postgres real)', () => {
  let dataSource: DataSource;
  let marketplaceAccountsService: MarketplaceAccountsService;
  let authService: AmazonAuthService;
  let service: AmazonConnectionService;
  let accountId: string;
  let userId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([MarketplaceAccount]);
    marketplaceAccountsService = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
    const encryptionService = buildEncryptionService();
    // `provisionAccount` nunca usa `AdvisoryLockService`/`AmazonLwaClient`
    // (só `ensureValidAccessToken`/`refreshAccessTokenAfterUnauthorized`
    // usam) — stubs bastam aqui, sem enfraquecer o que está sendo provado.
    authService = new AmazonAuthService(
      marketplaceAccountsService,
      { tryAcquire: jest.fn() } as never,
      { refreshAccessToken: jest.fn() } as never,
      encryptionService,
      { get: () => undefined } as unknown as ConfigService,
    );
    service = new AmazonConnectionService(
      marketplaceAccountsService,
      authService,
      { searchOrders: jest.fn() } as never,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    const account = await dataSource.getRepository(MarketplaceAccount).save({
      id: randomUUID(),
      marketplace: Marketplace.AMAZON,
      status: MarketplaceAccountStatus.DISCONNECTED,
      tokenVersion: 0,
    });
    accountId = account.id;
  });

  async function rawRow(): Promise<RawAccountRow> {
    const [row] = await dataSource.query<RawAccountRow[]>(
      `SELECT encrypted_refresh_token, encrypted_access_token,
              token_expires_at, status, token_version, external_seller_id
         FROM marketplace_accounts WHERE id = $1`,
      [accountId],
    );
    return row;
  }

  it('stores the refresh token ENCRYPTED — the raw column value never equals or contains the plaintext, and decrypting it round-trips correctly', async () => {
    const plainToken = 'Atzr|REAL-POSTGRES-INTEGRATION-TEST-TOKEN';
    const encryptionService = buildEncryptionService();

    await service.provision(
      accountId,
      { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: plainToken },
      userId,
    );

    const row = await rawRow();
    expect(row.encrypted_refresh_token).not.toBeNull();
    expect(row.encrypted_refresh_token).not.toBe(plainToken);
    expect(row.encrypted_refresh_token as string).not.toContain(plainToken);
    expect(
      encryptionService.decrypt(row.encrypted_refresh_token as string),
    ).toBe(plainToken);
    expect(row.status).toBe('CONNECTED');
    expect(row.external_seller_id).toBe('A1SELLERPARTNERID');
  });

  it('never leaks the plaintext refresh token into any thrown error when provisioning fails (e.g. a non-Amazon account)', async () => {
    const plainToken = 'Atzr|SHOULD-NEVER-APPEAR-IN-ANY-ERROR';
    await dataSource.query(
      `UPDATE marketplace_accounts SET marketplace = 'MERCADO_LIVRE' WHERE id = $1`,
      [accountId],
    );

    let caught: unknown;
    try {
      await service.provision(
        accountId,
        { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: plainToken },
        userId,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(JSON.stringify(caught)).not.toContain(plainToken);
  });

  it('reprovisioning clears the old access token/expiry on the REAL row and bumps tokenVersion (CAS)', async () => {
    await service.provision(
      accountId,
      { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: 'Atzr|first' },
      userId,
    );
    // Simula um access token já obtido por uma renovação anterior — o que
    // o reprovisionamento precisa limpar.
    await dataSource.query(
      `UPDATE marketplace_accounts
          SET encrypted_access_token = 'iv:tag:stale-access-token',
              token_expires_at = now() + interval '1 hour'
        WHERE id = $1`,
      [accountId],
    );
    const beforeReprovision = await rawRow();
    expect(beforeReprovision.encrypted_access_token).not.toBeNull();

    await service.provision(
      accountId,
      { sellingPartnerId: 'A1SELLERPARTNERID', refreshToken: 'Atzr|second' },
      userId,
    );

    const after = await rawRow();
    expect(after.encrypted_access_token).toBeNull();
    expect(after.token_expires_at).toBeNull();
    expect(after.token_version).toBe(beforeReprovision.token_version + 1);
    const encryptionService = buildEncryptionService();
    expect(
      encryptionService.decrypt(after.encrypted_refresh_token as string),
    ).toBe('Atzr|second');
  });

  it('a duplicate Selling Partner ID (already used by another Amazon account) is rejected — never silently overwrites the other account', async () => {
    const otherAccount = await dataSource
      .getRepository(MarketplaceAccount)
      .save({
        id: randomUUID(),
        marketplace: Marketplace.AMAZON,
        status: MarketplaceAccountStatus.CONNECTED,
        externalSellerId: 'A1SELLERPARTNERID',
        tokenVersion: 0,
      });

    await expect(
      service.provision(
        accountId,
        {
          sellingPartnerId: 'A1SELLERPARTNERID',
          refreshToken: 'Atzr|duplicate-attempt',
        },
        userId,
      ),
    ).rejects.toMatchObject({ message: 'AMAZON_ACCOUNT_ALREADY_CONNECTED' });

    const untouchedOther = await dataSource.query<RawAccountRow[]>(
      `SELECT encrypted_refresh_token, encrypted_access_token, token_expires_at, status, token_version, external_seller_id
         FROM marketplace_accounts WHERE id = $1`,
      [otherAccount.id],
    );
    expect(untouchedOther[0].encrypted_refresh_token).toBeNull();
  });
});
