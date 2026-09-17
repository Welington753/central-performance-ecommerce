import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
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
      refreshFailureCount: 0,
      refreshRetryAt: null,
      lastRefreshAttemptAt: null,
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

  findOne(options: {
    where: Partial<MarketplaceAccount>;
  }): Promise<MarketplaceAccount | null> {
    const entries = Object.entries(options.where) as Array<
      [keyof MarketplaceAccount, unknown]
    >;
    const found = this.rows.find((row) =>
      entries.every(([key, value]) => row[key] === value),
    );
    return Promise.resolve(found ?? null);
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
        {
          provide: DataSource,
          useValue: {},
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
    const account = await service.create({
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    expect(account.errorSummary).toBeNull();
    expect(account.failureCode).toBeNull();
    expect(account.connectedByUserId).toBeNull();
    expect(account.tokenVersion).toBe(0);
  });

  it('provisions a SHOPEE account (Checkpoint CP2E: allowlist widened) born DISCONNECTED, with externalSellerId null and a real backend-generated UUID', async () => {
    const account = await service.create({ marketplace: Marketplace.SHOPEE });

    expect(account.marketplace).toBe(Marketplace.SHOPEE);
    expect(account.status).toBe(MarketplaceAccountStatus.DISCONNECTED);
    expect(account.externalSellerId).toBeNull();
    expect(account.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
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

  it('findByIdOrFail returns the account when it exists', async () => {
    const created = await service.create({
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await expect(service.findByIdOrFail(created.id)).resolves.toEqual(created);
  });

  it('findByIdOrFail throws NotFoundException when the account does not exist', async () => {
    await expect(service.findByIdOrFail('does-not-exist')).rejects.toThrow(
      /não encontrada/i,
    );
  });

  it('findByMarketplaceAndExternalSellerId finds an existing connected account', async () => {
    await service.create({
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '999',
    });

    const found = await service.findByMarketplaceAndExternalSellerId(
      Marketplace.MERCADO_LIVRE,
      '999',
    );
    expect(found?.externalSellerId).toBe('999');
  });

  it('findByMarketplaceAndExternalSellerId returns null when no account matches', async () => {
    const found = await service.findByMarketplaceAndExternalSellerId(
      Marketplace.MERCADO_LIVRE,
      'nonexistent',
    );
    expect(found).toBeNull();
  });
});

describe('MarketplaceAccountsService CAS methods (real Postgres)', () => {
  let dataSource: DataSource;
  let service: MarketplaceAccountsService;
  let userId: string;

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

  async function seedAccount(overrides: Partial<Record<string, unknown>> = {}) {
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status, token_version, external_seller_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        overrides.marketplace ?? 'MERCADO_LIVRE',
        overrides.status ?? 'DISCONNECTED',
        overrides.tokenVersion ?? 0,
        overrides.externalSellerId ?? null,
      ],
    );
    return id;
  }

  beforeEach(async () => {
    // Mesma ordem de `oauth_authorization_requests.service.spec.ts` (Task
    // 12): `TRUNCATE ... CASCADE` em `marketplace_accounts` também tranca
    // `oauth_authorization_requests` (referencia `marketplace_accounts` por
    // FK). Quando duas suítes reais de Postgres truncam essas mesmas tabelas
    // em ordens diferentes sob os workers paralelos do Jest, o Postgres
    // detecta um deadlock real (ordem de locks cruzada) e derruba uma das
    // duas transações. Ordem consistente entre as suítes elimina a espera
    // circular.
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );
  });

  it('the Repository<MarketplaceAccount> correctly maps snake_case columns to camelCase properties (proves SnakeNamingStrategy is wired)', async () => {
    const tokenExpiresAt = new Date(Date.now() + 3600 * 1000);
    const id = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts
         (id, marketplace, status, token_version, external_seller_id, token_expires_at)
       VALUES ($1, 'MERCADO_LIVRE', 'CONNECTED', $2, $3, $4)`,
      [id, 3, 'seller-snake-case-proof', tokenExpiresAt],
    );

    // Sem `namingStrategy: new SnakeNamingStrategy()` no `DataSource` de
    // teste, este `findOneByOrFail` (que gera
    // `SELECT ... WHERE "id" = $1` usando os nomes de coluna derivados do
    // `@Entity`) leria colunas camelCase inexistentes e devolveria
    // `undefined`/erro em vez dos valores reais gravados acima em
    // snake_case — este teste falharia silenciosamente sem a estratégia
    // correta.
    const found = await dataSource
      .getRepository(MarketplaceAccount)
      .findOneByOrFail({ id });

    expect(found.tokenVersion).toBe(3);
    expect(found.externalSellerId).toBe('seller-snake-case-proof');
    expect(found.tokenExpiresAt?.getTime()).toBe(tokenExpiresAt.getTime());
  });

  it('applySuccessfulConnection applies when tokenVersion matches, increments it, sets CONNECTED', async () => {
    const id = await seedAccount();

    const outcome = await service.applySuccessfulConnection({
      id,
      expectedTokenVersion: 0,
      externalSellerId: 'seller-1',
      encryptedAccessToken: 'iv:tag:a',
      encryptedRefreshToken: 'iv:tag:r',
      tokenExpiresAt: new Date(Date.now() + 10800 * 1000),
      connectedByUserId: userId,
    });

    expect(outcome).toBe('applied');

    const rows: Array<{
      status: string;
      token_version: number;
      external_seller_id: string | null;
    }> = await dataSource.query(
      'SELECT status, token_version, external_seller_id FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(rows[0].status).toBe('CONNECTED');
    expect(rows[0].token_version).toBe(1);
    expect(rows[0].external_seller_id).toBe('seller-1');
  });

  it('applySuccessfulConnection returns version_conflict and writes nothing when tokenVersion is stale', async () => {
    const id = await seedAccount({ tokenVersion: 5 });

    const outcome = await service.applySuccessfulConnection({
      id,
      expectedTokenVersion: 0,
      externalSellerId: 'seller-2',
      encryptedAccessToken: 'iv:tag:a',
      encryptedRefreshToken: 'iv:tag:r',
      tokenExpiresAt: new Date(),
      connectedByUserId: userId,
    });

    expect(outcome).toBe('version_conflict');
    const rows: Array<{ status: string; token_version: number }> =
      await dataSource.query(
        'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
        [id],
      );
    expect(rows[0].status).toBe('DISCONNECTED');
    expect(rows[0].token_version).toBe(5);
  });

  it('applySuccessfulConnection returns external_seller_conflict and preserves the winning account when externalSellerId is already taken', async () => {
    await seedAccount({
      status: 'CONNECTED',
      externalSellerId: 'taken-seller',
    });
    const losingId = await seedAccount();

    const outcome = await service.applySuccessfulConnection({
      id: losingId,
      expectedTokenVersion: 0,
      externalSellerId: 'taken-seller',
      encryptedAccessToken: 'iv:tag:a',
      encryptedRefreshToken: 'iv:tag:r',
      tokenExpiresAt: new Date(),
      connectedByUserId: userId,
    });

    expect(outcome).toBe('external_seller_conflict');
    const losingRow: Array<{
      status: string;
      external_seller_id: string | null;
    }> = await dataSource.query(
      'SELECT status, external_seller_id FROM marketplace_accounts WHERE id = $1',
      [losingId],
    );
    expect(losingRow[0].status).toBe('DISCONNECTED');
    expect(losingRow[0].external_seller_id).toBeNull();
  });

  it('applySuccessfulConnection, given an external QueryRunner, does NOT commit or roll back itself — the caller controls the transaction (Task 19 relies on this for atomicity with the request finalization)', async () => {
    const id = await seedAccount();
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const outcome = await service.applySuccessfulConnection(
        {
          id,
          expectedTokenVersion: 0,
          externalSellerId: 'seller-shared-tx',
          encryptedAccessToken: 'iv:tag:a',
          encryptedRefreshToken: 'iv:tag:r',
          tokenExpiresAt: new Date(Date.now() + 10800 * 1000),
          connectedByUserId: userId,
        },
        queryRunner,
      );
      expect(outcome).toBe('applied');

      // Visível dentro da mesma transação (mesmo QueryRunner)...
      const withinTx = (await queryRunner.query(
        'SELECT status FROM marketplace_accounts WHERE id = $1',
        [id],
      )) as Array<{ status: string }>;
      expect(withinTx[0].status).toBe('CONNECTED');

      // ...mas ainda NÃO commitada — outra conexão não vê a mudança.
      const outsideTx: Array<{ status: string }> = await dataSource.query(
        'SELECT status FROM marketplace_accounts WHERE id = $1',
        [id],
      );
      expect(outsideTx[0].status).toBe('DISCONNECTED');

      // O chamador decide: aqui, propositalmente, faz ROLLBACK em vez de commit.
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }

    const afterRollback: Array<{ status: string; token_version: number }> =
      await dataSource.query(
        'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
        [id],
      );
    expect(afterRollback[0].status).toBe('DISCONNECTED');
    expect(afterRollback[0].token_version).toBe(0);
  });

  it('provisionCredentials applies when tokenVersion matches: sets CONNECTED, stores the refresh token, and clears access token/expiry (Fase 4, Amazon)', async () => {
    const id = await seedAccount({ marketplace: 'AMAZON' });

    const outcome = await service.provisionCredentials({
      id,
      expectedTokenVersion: 0,
      externalSellerId: 'A1SELLERPARTNERID',
      encryptedRefreshToken: 'iv:tag:amazon-refresh',
      connectedByUserId: userId,
    });

    expect(outcome).toBe('applied');

    const rows: Array<{
      status: string;
      token_version: number;
      external_seller_id: string | null;
      encrypted_refresh_token: string | null;
      encrypted_access_token: string | null;
      token_expires_at: Date | null;
    }> = await dataSource.query(
      `SELECT status, token_version, external_seller_id, encrypted_refresh_token, encrypted_access_token, token_expires_at
         FROM marketplace_accounts WHERE id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('CONNECTED');
    expect(rows[0].token_version).toBe(1);
    expect(rows[0].external_seller_id).toBe('A1SELLERPARTNERID');
    expect(rows[0].encrypted_refresh_token).toBe('iv:tag:amazon-refresh');
    // Nunca escreve um access token no provisionamento: só existe após a
    // primeira renovação real via AmazonAuthService.ensureValidAccessToken.
    expect(rows[0].encrypted_access_token).toBeNull();
    expect(rows[0].token_expires_at).toBeNull();
  });

  it('provisionCredentials returns version_conflict and writes nothing when tokenVersion is stale', async () => {
    const id = await seedAccount({ marketplace: 'AMAZON', tokenVersion: 3 });

    const outcome = await service.provisionCredentials({
      id,
      expectedTokenVersion: 0,
      externalSellerId: 'A1SELLERPARTNERID',
      encryptedRefreshToken: 'iv:tag:amazon-refresh',
      connectedByUserId: userId,
    });

    expect(outcome).toBe('version_conflict');
    const rows: Array<{ status: string; token_version: number }> =
      await dataSource.query(
        'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
        [id],
      );
    expect(rows[0].status).toBe('DISCONNECTED');
    expect(rows[0].token_version).toBe(3);
  });

  it('provisionCredentials returns external_seller_conflict and preserves the winning account when externalSellerId is already taken', async () => {
    await seedAccount({
      marketplace: 'AMAZON',
      status: 'CONNECTED',
      externalSellerId: 'taken-seller-partner-id',
    });
    const losingId = await seedAccount({ marketplace: 'AMAZON' });

    const outcome = await service.provisionCredentials({
      id: losingId,
      expectedTokenVersion: 0,
      externalSellerId: 'taken-seller-partner-id',
      encryptedRefreshToken: 'iv:tag:amazon-refresh',
      connectedByUserId: userId,
    });

    expect(outcome).toBe('external_seller_conflict');
    const losingRow: Array<{
      status: string;
      external_seller_id: string | null;
    }> = await dataSource.query(
      'SELECT status, external_seller_id FROM marketplace_accounts WHERE id = $1',
      [losingId],
    );
    expect(losingRow[0].status).toBe('DISCONNECTED');
    expect(losingRow[0].external_seller_id).toBeNull();
  });

  it('markError applies only when tokenVersion matches, and is a no-op otherwise', async () => {
    const id = await seedAccount();

    expect(
      await service.markError({
        id,
        expectedTokenVersion: 0,
        failureCode: 'ACCOUNT_ALREADY_CONNECTED',
        errorSummary: 'Conflito de identidade.',
      }),
    ).toBe(true);

    expect(
      await service.markError({
        id,
        expectedTokenVersion: 0, // stale now, row wasn't versioned up by markError itself
        failureCode: 'ACCOUNT_ALREADY_CONNECTED',
        errorSummary: 'Conflito de identidade.',
      }),
    ).toBe(true); // markError does not bump tokenVersion by design, so this is still valid

    const rows: Array<{
      status: string;
      failure_code: string | null;
      error_summary: string | null;
    }> = await dataSource.query(
      'SELECT status, failure_code, error_summary FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(rows[0].status).toBe('ERROR');
    expect(rows[0].failure_code).toBe('ACCOUNT_ALREADY_CONNECTED');
  });

  it('applyRefreshedTokens applies atomically and clears failureCode/errorSummary', async () => {
    const id = await seedAccount({ status: 'CONNECTED' });
    await dataSource.query(
      `UPDATE marketplace_accounts SET failure_code = 'REFRESH_RESULT_UNKNOWN', error_summary = 'x' WHERE id = $1`,
      [id],
    );

    const applied = await service.applyRefreshedTokens({
      id,
      expectedTokenVersion: 0,
      encryptedAccessToken: 'iv:tag:new-a',
      encryptedRefreshToken: 'iv:tag:new-r',
      tokenExpiresAt: new Date(Date.now() + 10800 * 1000),
    });

    expect(applied).toBe(true);
    const rows: Array<{
      status: string;
      token_version: number;
      failure_code: string | null;
      error_summary: string | null;
    }> = await dataSource.query(
      'SELECT status, token_version, failure_code, error_summary FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(rows[0].status).toBe('CONNECTED');
    expect(rows[0].token_version).toBe(1);
    expect(rows[0].failure_code).toBeNull();
    expect(rows[0].error_summary).toBeNull();
  });

  it('applyRefreshedTokens returns false and writes nothing on a stale tokenVersion (REFRESH_RESULT_NOT_COMMITTED case)', async () => {
    const id = await seedAccount({ status: 'CONNECTED', tokenVersion: 2 });

    const applied = await service.applyRefreshedTokens({
      id,
      expectedTokenVersion: 0,
      encryptedAccessToken: 'iv:tag:new-a',
      encryptedRefreshToken: 'iv:tag:new-r',
      tokenExpiresAt: new Date(),
    });

    expect(applied).toBe(false);
    const rows: Array<{ token_version: number }> = await dataSource.query(
      'SELECT token_version FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(rows[0].token_version).toBe(2);
  });

  it('markTokenExpired sets TOKEN_EXPIRED conditionally on tokenVersion', async () => {
    const id = await seedAccount({ status: 'CONNECTED' });

    expect(
      await service.markTokenExpired({
        id,
        expectedTokenVersion: 0,
        failureCode: 'REFRESH_TOKEN_REJECTED',
        errorSummary: 'Refresh token rejeitado. Reconexão necessária.',
      }),
    ).toBe(true);

    const rows: Array<{
      status: string;
      failure_code: string | null;
    }> = await dataSource.query(
      'SELECT status, failure_code FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(rows[0].status).toBe('TOKEN_EXPIRED');
    expect(rows[0].failure_code).toBe('REFRESH_TOKEN_REJECTED');
  });

  it('findConnectedDueForRenewal returns only CONNECTED accounts expiring before the cutoff, limited', async () => {
    const dueSoon = await seedAccount({ status: 'CONNECTED' });
    const dueLater = await seedAccount({ status: 'CONNECTED' });
    const disconnected = await seedAccount({ status: 'DISCONNECTED' });

    await dataSource.query(
      `UPDATE marketplace_accounts SET token_expires_at = now() + interval '1 minute' WHERE id = $1`,
      [dueSoon],
    );
    await dataSource.query(
      `UPDATE marketplace_accounts SET token_expires_at = now() + interval '1 day' WHERE id = $1`,
      [dueLater],
    );
    await dataSource.query(
      `UPDATE marketplace_accounts SET token_expires_at = now() + interval '1 minute' WHERE id = $1`,
      [disconnected],
    );

    const dueBefore = new Date(Date.now() + 15 * 60 * 1000);
    const due = await service.findConnectedDueForRenewal(dueBefore, 25);

    expect(due.map((a) => a.id)).toEqual([dueSoon]);
  });

  it('findConnectedDueForRenewal orders results by tokenExpiresAt ascending (most urgent first) — matters when the batch is limited', async () => {
    const latest = await seedAccount({ status: 'CONNECTED' });
    const earliest = await seedAccount({ status: 'CONNECTED' });
    const middle = await seedAccount({ status: 'CONNECTED' });

    await dataSource.query(
      `UPDATE marketplace_accounts SET token_expires_at = now() + interval '10 minutes' WHERE id = $1`,
      [latest],
    );
    await dataSource.query(
      `UPDATE marketplace_accounts SET token_expires_at = now() + interval '1 minute' WHERE id = $1`,
      [earliest],
    );
    await dataSource.query(
      `UPDATE marketplace_accounts SET token_expires_at = now() + interval '5 minutes' WHERE id = $1`,
      [middle],
    );

    const dueBefore = new Date(Date.now() + 15 * 60 * 1000);
    const due = await service.findConnectedDueForRenewal(dueBefore, 25);

    expect(due.map((a) => a.id)).toEqual([earliest, middle, latest]);
  });

  it('disconnect transitions a CONNECTED account to DISCONNECTED, clears tokens/expiry, bumps token_version, and preserves externalSellerId/nickname', async () => {
    const id = await seedAccount({
      status: 'CONNECTED',
      externalSellerId: 'shop-live-123',
      tokenVersion: 2,
    });
    await dataSource.query(
      `UPDATE marketplace_accounts
          SET encrypted_access_token = 'iv:tag:access',
              encrypted_refresh_token = 'iv:tag:refresh',
              token_expires_at = now() + interval '1 hour',
              nickname = 'Loja Live',
              error_summary = 'algo antigo',
              failure_code = 'ALGO_ANTIGO'
        WHERE id = $1`,
      [id],
    );

    const result = await service.disconnect(id);

    expect(result.status).toBe(MarketplaceAccountStatus.DISCONNECTED);

    const rows: Array<{
      status: string;
      token_version: number;
      external_seller_id: string | null;
      nickname: string | null;
      encrypted_access_token: string | null;
      encrypted_refresh_token: string | null;
      token_expires_at: Date | null;
      error_summary: string | null;
      failure_code: string | null;
    }> = await dataSource.query(
      `SELECT status, token_version, external_seller_id, nickname,
              encrypted_access_token, encrypted_refresh_token, token_expires_at,
              error_summary, failure_code
         FROM marketplace_accounts WHERE id = $1`,
      [id],
    );
    expect(rows[0].status).toBe('DISCONNECTED');
    expect(rows[0].token_version).toBe(3);
    expect(rows[0].external_seller_id).toBe('shop-live-123');
    expect(rows[0].nickname).toBe('Loja Live');
    expect(rows[0].encrypted_access_token).toBeNull();
    expect(rows[0].encrypted_refresh_token).toBeNull();
    expect(rows[0].token_expires_at).toBeNull();
    expect(rows[0].error_summary).toBeNull();
    expect(rows[0].failure_code).toBeNull();
  });

  it('disconnect is idempotent: calling it twice on an already-DISCONNECTED account does not error and does not bump token_version again', async () => {
    const id = await seedAccount({ status: 'DISCONNECTED', tokenVersion: 1 });

    const first = await service.disconnect(id);
    const second = await service.disconnect(id);

    expect(first.status).toBe(MarketplaceAccountStatus.DISCONNECTED);
    expect(second.status).toBe(MarketplaceAccountStatus.DISCONNECTED);

    const rows: Array<{ token_version: number }> = await dataSource.query(
      'SELECT token_version FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(rows[0].token_version).toBe(1);
  });

  it('disconnect never touches sync_runs or marketplace_orders rows belonging to the account', async () => {
    const id = await seedAccount({ status: 'CONNECTED' });
    const runId = await dataSource.query(
      `INSERT INTO sync_runs (marketplace_account_id, marketplace, type, status, started_at, date_from, date_to)
         VALUES ($1, 'SHOPEE', 'MANUAL', 'SUCCESS', now(), now(), now())
       RETURNING id`,
      [id],
    );
    const orderRows = await dataSource.query(
      `INSERT INTO marketplace_orders
         (marketplace_account_id, external_order_id, status, currency_id, total_amount,
          date_created, marketplace_last_updated, updated_at)
       VALUES ($1, 'order-sn-1', 'paid', 'BRL', '100.00', now(), now(), now())
       RETURNING id`,
      [id],
    );

    await service.disconnect(id);

    const runsAfter: Array<{ count: string }> = await dataSource.query(
      'SELECT count(*) FROM sync_runs WHERE id = $1',
      [runId[0].id],
    );
    const ordersAfter: Array<{ count: string }> = await dataSource.query(
      'SELECT count(*) FROM marketplace_orders WHERE id = $1',
      [orderRows[0].id],
    );
    expect(Number(runsAfter[0].count)).toBe(1);
    expect(Number(ordersAfter[0].count)).toBe(1);
  });

  it('disconnect fails PENDING oauth_authorization_requests for the account, never touches PROCESSING ones, never touches another account\'s PENDING request', async () => {
    const id = await seedAccount({ status: 'CONNECTED' });
    const otherId = await seedAccount({ status: 'CONNECTED' });
    const processingAccountId = await seedAccount({ status: 'CONNECTED' });

    const pendingId = randomUUID();
    const processingId = randomUUID();
    const otherPendingId = randomUUID();
    await dataSource.query(
      `INSERT INTO oauth_authorization_requests
         (id, marketplace_account_id, initiated_by_user_id, marketplace, state_hash, status, expires_at, processing_started_at)
       VALUES
         ($1, $4, $5, 'SHOPEE', $7, 'PENDING', now() + interval '10 minutes', NULL),
         ($2, $8, $5, 'SHOPEE', $9, 'PROCESSING', now() + interval '10 minutes', now()),
         ($3, $6, $5, 'SHOPEE', $10, 'PENDING', now() + interval '10 minutes', NULL)`,
      [pendingId, processingId, otherPendingId, id, userId, otherId, randomUUID(), processingAccountId, randomUUID(), randomUUID()],
    );

    await service.disconnect(id);

    const rows: Array<{ id: string; status: string; failure_code: string | null }> =
      await dataSource.query(
        `SELECT id, status, failure_code FROM oauth_authorization_requests
          WHERE id IN ($1, $2, $3) ORDER BY id`,
        [pendingId, processingId, otherPendingId],
      );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[pendingId].status).toBe('FAILED');
    expect(byId[pendingId].failure_code).toBe('ACCOUNT_DISCONNECTED');
    expect(byId[processingId].status).toBe('PROCESSING');
    expect(byId[otherPendingId].status).toBe('PENDING');
  });

  it('disconnect never touches a PROCESSING oauth_authorization_request when the SAME account has no PENDING request at all (disconnect arriving mid-OAuth-callback)', async () => {
    const id = await seedAccount({ status: 'CONNECTED' });

    const processingId = randomUUID();
    await dataSource.query(
      `INSERT INTO oauth_authorization_requests
         (id, marketplace_account_id, initiated_by_user_id, marketplace, state_hash, status, expires_at, processing_started_at)
       VALUES ($1, $2, $3, 'SHOPEE', $4, 'PROCESSING', now() + interval '10 minutes', now())`,
      [processingId, id, userId, randomUUID()],
    );

    await service.disconnect(id);

    const rows: Array<{ status: string; failure_code: string | null }> =
      await dataSource.query(
        `SELECT status, failure_code FROM oauth_authorization_requests WHERE id = $1`,
        [processingId],
      );
    expect(rows[0].status).toBe('PROCESSING');
    expect(rows[0].failure_code).toBeNull();
  });

  it('disconnect throws NotFoundException for a non-existent account id', async () => {
    await expect(service.disconnect('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      /não encontrada/i,
    );
  });

  describe('disconnect retry sob corrida de concorrência', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('perde exatamente UMA corrida de CAS e se recupera na releitura seguinte: não lança, termina DISCONNECTED com tokens limpos', async () => {
      const id = await seedAccount({ status: 'CONNECTED', tokenVersion: 0 });

      // Simula uma única escrita concorrente que avança token_version (ex.:
      // uma renovação de token) entre a leitura inicial de `disconnect` e a
      // sua primeira tentativa de CAS — só na PRIMEIRA chamada a
      // `findByIdOrFail` (mockImplementationOnce): a releitura de retry que
      // `disconnect` faz em seguida já usa a implementação real, sem mais
      // interferência.
      const originalFindByIdOrFail = service.findByIdOrFail.bind(service);
      jest
        .spyOn(service, 'findByIdOrFail')
        .mockImplementationOnce(async (accId: string) => {
          const account = await originalFindByIdOrFail(accId);
          await dataSource.query(
            `UPDATE marketplace_accounts SET token_version = token_version + 1, updated_at = now() WHERE id = $1`,
            [accId],
          );
          return account;
        });

      const result = await service.disconnect(id);

      expect(result.status).toBe(MarketplaceAccountStatus.DISCONNECTED);

      const rows: Array<{
        status: string;
        encrypted_access_token: string | null;
        encrypted_refresh_token: string | null;
      }> = await dataSource.query(
        'SELECT status, encrypted_access_token, encrypted_refresh_token FROM marketplace_accounts WHERE id = $1',
        [id],
      );
      expect(rows[0].status).toBe('DISCONNECTED');
      expect(rows[0].encrypted_access_token).toBeNull();
      expect(rows[0].encrypted_refresh_token).toBeNull();
    });

    it('perde 3 corridas de CAS consecutivas: lança em vez de devolver uma conta ainda CONNECTED, e nunca escreve nada no banco', async () => {
      const id = await seedAccount({ status: 'CONNECTED', tokenVersion: 0 });

      // Simula uma escrita concorrente ANTES de cada releitura de
      // `disconnect` (inicial + as duas releituras do retry) — o CAS de
      // cada tentativa sempre usa uma `token_version` já defasada quando
      // chega no `UPDATE ... WHERE token_version = $2`.
      const originalFindByIdOrFail = service.findByIdOrFail.bind(service);
      jest
        .spyOn(service, 'findByIdOrFail')
        .mockImplementation(async (accId: string) => {
          const account = await originalFindByIdOrFail(accId);
          await dataSource.query(
            `UPDATE marketplace_accounts SET token_version = token_version + 1, updated_at = now() WHERE id = $1`,
            [accId],
          );
          return account;
        });

      await expect(service.disconnect(id)).rejects.toThrow(
        /conflito de concorrência/i,
      );

      const rows: Array<{ status: string; token_version: number }> =
        await dataSource.query(
          'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
          [id],
        );
      // `disconnect` nunca aplicou seu próprio CAS: a conta continua
      // CONNECTED, e `token_version` só reflete os 3 avanços concorrentes
      // simulados acima (0 -> 3), nunca um incremento do próprio método.
      expect(rows[0].status).toBe('CONNECTED');
      expect(rows[0].token_version).toBe(3);
    });
  });
});
