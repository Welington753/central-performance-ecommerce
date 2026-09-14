import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import type {
  ShopeeHttpClient,
  ShopeeTokenOutcome,
} from './shopee-http.client';
import { ShopeeAccessTokenService } from './shopee-access-token.service';

// Suíte de integração (Checkpoint CP2H) — prova em Postgres 16 REAL o que o
// spec unitário só pode simular: o CAS por `id + token_version` realmente
// incrementa `token_version` e zera `refresh_failure_count`/
// `refresh_retry_at` no banco, e o `AdvisoryLockService` (baseado em
// `pg_advisory_lock`, servidor real) realmente serializa duas chamadas
// concorrentes de `ensureValidAccessToken` para a MESMA conta — provando que
// a segunda chamada NUNCA reenvia o refresh_token antigo à Shopee. Nenhum
// teste aqui chama a Shopee real: só `ShopeeHttpClient` é mockado.

function fakeConfigService(
  overrides: Record<string, unknown> = {},
): ConfigService {
  const values: Record<string, unknown> = {
    ML_ACCOUNT_LOCK_WAIT_MS: 5000,
    SHOPEE_TOKEN_REFRESH_SKEW_SECONDS: 600,
    CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
    ...overrides,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function fakeHttpClient(refreshAccessToken: jest.Mock): ShopeeHttpClient {
  return { refreshAccessToken } as unknown as ShopeeHttpClient;
}

function successOutcome(
  overrides: Partial<{
    accessToken: string;
    refreshToken: string;
    expiresInSeconds: number;
  }> = {},
): ShopeeTokenOutcome {
  return {
    kind: 'success',
    token: {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresInSeconds: 14400,
      requestId: null,
      ...overrides,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ShopeeAccessTokenService — integração com Postgres 16 real (Checkpoint CP2H)', () => {
  let dataSource: DataSource;
  let encryptionService: EncryptionService;
  let marketplaceAccountsService: MarketplaceAccountsService;
  let advisoryLockService: AdvisoryLockService;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([MarketplaceAccount]);
    const configService = fakeConfigService();
    encryptionService = new EncryptionService(configService);
    marketplaceAccountsService = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
    advisoryLockService = new AdvisoryLockService(dataSource, configService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    accountId = randomUUID();
  });

  async function insertConnectedAccount(input: {
    tokenExpiresAt: Date;
    tokenVersion?: number;
    refreshFailureCount?: number;
  }): Promise<void> {
    await dataSource.query(
      `INSERT INTO marketplace_accounts
         (id, marketplace, status, external_seller_id, encrypted_access_token,
          encrypted_refresh_token, token_expires_at, token_version, refresh_failure_count)
       VALUES ($1, 'SHOPEE', 'CONNECTED', '555444333', $2, $3, $4, $5, $6)`,
      [
        accountId,
        encryptionService.encrypt('current-access-token'),
        encryptionService.encrypt('current-refresh-token'),
        input.tokenExpiresAt,
        input.tokenVersion ?? 0,
        input.refreshFailureCount ?? 0,
      ],
    );
  }

  interface AccountRow {
    status: string;
    token_version: number;
    refresh_failure_count: number;
    refresh_retry_at: Date | null;
    encrypted_access_token: string | null;
    encrypted_refresh_token: string | null;
  }

  async function readAccount(): Promise<AccountRow> {
    const rows: AccountRow[] = await dataSource.query(
      `SELECT status, token_version, refresh_failure_count, refresh_retry_at,
              encrypted_access_token, encrypted_refresh_token
         FROM marketplace_accounts WHERE id = $1`,
      [accountId],
    );
    return rows[0];
  }

  function buildService(
    refreshAccessToken: jest.Mock,
  ): ShopeeAccessTokenService {
    return new ShopeeAccessTokenService(
      marketplaceAccountsService,
      advisoryLockService,
      fakeHttpClient(refreshAccessToken),
      encryptionService,
      fakeConfigService(),
      () => Date.now(),
    );
  }

  it('sucesso: persiste access+refresh novos, incrementa token_version e zera os contadores de falha (banco real)', async () => {
    await insertConnectedAccount({
      tokenExpiresAt: new Date(Date.now() - 60_000),
      tokenVersion: 4,
      refreshFailureCount: 2,
    });
    const refreshAccessToken = jest.fn().mockResolvedValue(successOutcome());
    const service = buildService(refreshAccessToken);

    const token = await service.ensureValidAccessToken(accountId);

    expect(token).toBe('new-access-token');
    const row = await readAccount();
    expect(row.status).toBe('CONNECTED');
    expect(row.token_version).toBe(5);
    expect(row.refresh_failure_count).toBe(0);
    expect(row.refresh_retry_at).toBeNull();
    expect(
      encryptionService.decrypt(row.encrypted_access_token as string),
    ).toBe('new-access-token');
    expect(
      encryptionService.decrypt(row.encrypted_refresh_token as string),
    ).toBe('new-refresh-token');
  });

  it('duas chamadas concorrentes para a mesma conta: o advisory lock real serializa e a Shopee é chamada só UMA vez (refresh_token nunca reenviado)', async () => {
    await insertConnectedAccount({
      tokenExpiresAt: new Date(Date.now() - 60_000),
      tokenVersion: 0,
    });

    const calls: string[] = [];
    const refreshAccessToken = jest.fn(
      async (input: { refreshToken: string }) => {
        calls.push(input.refreshToken);
        // Atraso deliberado: garante que a segunda chamada concorrente
        // genuinamente espere o lock (não vença por coincidência de timing) —
        // enquanto esta primeira está "em voo", a segunda deve ficar
        // bloqueada em `pg_try_advisory_lock`, nunca chamando este mock de
        // novo com o mesmo (ou qualquer) refresh_token.
        await sleep(200);
        return successOutcome();
      },
    );

    const serviceA = buildService(refreshAccessToken);
    const serviceB = buildService(refreshAccessToken);

    const [tokenA, tokenB] = await Promise.all([
      serviceA.ensureValidAccessToken(accountId),
      serviceB.ensureValidAccessToken(accountId),
    ]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['current-refresh-token']);
    expect(tokenA).toBe('new-access-token');
    expect(tokenB).toBe('new-access-token');

    const row = await readAccount();
    expect(row.token_version).toBe(1);
  });

  it('resultado ambíguo: marca ERROR no banco real e uma chamada seguinte falha fechado (nunca reconecta sozinha)', async () => {
    await insertConnectedAccount({
      tokenExpiresAt: new Date(Date.now() - 60_000),
    });
    const refreshAccessToken = jest
      .fn()
      .mockResolvedValue({ kind: 'unknown_result' });
    const service = buildService(refreshAccessToken);

    await expect(
      service.ensureValidAccessToken(accountId),
    ).rejects.toBeInstanceOf(ConflictException);

    const row = await readAccount();
    expect(row.status).toBe('ERROR');

    await expect(
      service.ensureValidAccessToken(accountId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('rate_limited (CP2H-R1): marca ERROR no banco real (não backoff) e não reenvia o mesmo refresh_token numa chamada seguinte', async () => {
    await insertConnectedAccount({
      tokenExpiresAt: new Date(Date.now() - 60_000),
      tokenVersion: 0,
    });
    const refreshAccessToken = jest
      .fn()
      .mockResolvedValue({ kind: 'rate_limited', retryAfterMs: 1000 });
    const service = buildService(refreshAccessToken);

    await expect(
      service.ensureValidAccessToken(accountId),
    ).rejects.toMatchObject({ message: 'REFRESH_RESULT_AMBIGUOUS' });

    const row = await readAccount();
    expect(row.status).toBe('ERROR');
    expect(row.refresh_retry_at).toBeNull();

    await expect(
      service.ensureValidAccessToken(accountId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'current-refresh-token' }),
    );
  });
});
