import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';
import { OAuthAuthorizationRequest } from './oauth-authorization-request.entity';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

function fakeConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    FRONTEND_URL: 'https://app.example.com',
    ML_ACCOUNT_LOCK_WAIT_MS: 500,
    ML_TOKEN_REFRESH_LEEWAY_MS: 900000,
    CREDENTIAL_ENCRYPTION_KEY:
      '3132333435363738393031323334353637383930313233343536373839303a3b',
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

/**
 * Correção de resiliência OAuth — testes contra um Postgres real (nunca
 * mocks) para as garantias que só fazem sentido com CAS/colunas
 * persistidas de verdade: retomada após reinício, recuperação isolada de
 * múltiplas contas, e uma escrita de falha que chega atrasada nunca
 * sobrescrever um sucesso concorrente. Nenhuma chamada real ao Mercado
 * Livre — `httpClient` é sempre um fake local.
 */
describe('MercadoLivreOAuthService — resiliência de renovação (Postgres real)', () => {
  let dataSource: DataSource;
  let encryptionService: EncryptionService;
  let marketplaceAccountsService: MarketplaceAccountsService;
  let authorizationRequestsService: OAuthAuthorizationRequestsService;
  let configService: ConfigService;
  let advisoryLockService: AdvisoryLockService;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      OAuthAuthorizationRequest,
      MarketplaceAccount,
    ]);

    configService = fakeConfigService();
    encryptionService = new EncryptionService(configService);
    marketplaceAccountsService = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
    authorizationRequestsService = new OAuthAuthorizationRequestsService(
      dataSource,
      encryptionService,
    );
    advisoryLockService = new AdvisoryLockService(dataSource, configService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
  });

  async function seedAccount(overrides: {
    id?: string;
    externalSellerId: string;
    status?: string;
    failureCode?: string | null;
    tokenExpiresAt?: Date;
    tokenVersion?: number;
    refreshRetryAt?: Date | null;
  }): Promise<string> {
    const id = overrides.id ?? randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts
         (id, marketplace, status, failure_code, external_seller_id,
          encrypted_access_token, encrypted_refresh_token, token_expires_at,
          token_version, refresh_retry_at)
       VALUES ($1, 'MERCADO_LIVRE', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        overrides.status ?? 'CONNECTED',
        overrides.failureCode ?? null,
        overrides.externalSellerId,
        encryptionService.encrypt(`access-${overrides.externalSellerId}`),
        encryptionService.encrypt(`refresh-${overrides.externalSellerId}`),
        overrides.tokenExpiresAt ?? new Date(Date.now() - 60_000),
        overrides.tokenVersion ?? 0,
        overrides.refreshRetryAt ?? null,
      ],
    );
    return id;
  }

  function buildService(httpClient: unknown): MercadoLivreOAuthService {
    return new MercadoLivreOAuthService(
      marketplaceAccountsService,
      authorizationRequestsService,
      advisoryLockService,
      httpClient as never,
      encryptionService,
      configService,
      dataSource,
    );
  }

  it('respects a persisted refresh_retry_at across a brand-new service instance (survives a backend restart) — never calls the network before it', async () => {
    const accountId = await seedAccount({
      externalSellerId: 'A',
      status: 'CONNECTED',
      failureCode: 'REFRESH_TEMPORARY_FAILURE',
      tokenExpiresAt: new Date(Date.now() + 60_000), // ainda válido
      refreshRetryAt: new Date(Date.now() + 5 * 60_000), // agendado para o futuro
    });

    // Instância NOVA, sem nenhum estado em memória — simula o processo
    // reiniciado. O httpClient falharia o teste se fosse chamado.
    const httpClient = {
      refreshToken: jest
        .fn()
        .mockRejectedValue(new Error('network should never be called')),
    };
    const freshService = buildService(httpClient);

    const token = await freshService.ensureValidAccessToken(accountId);

    expect(token).toBe('access-A');
    expect(httpClient.refreshToken).not.toHaveBeenCalled();
  });

  it('recovers two distinct ERROR/REFRESH_RESULT_UNKNOWN accounts (the real incident state) independently — no cross-account contamination', async () => {
    const accountA = await seedAccount({
      externalSellerId: 'A',
      status: 'ERROR',
      failureCode: 'REFRESH_RESULT_UNKNOWN',
      tokenVersion: 7,
    });
    const accountB = await seedAccount({
      externalSellerId: 'B',
      status: 'ERROR',
      failureCode: 'REFRESH_RESULT_UNKNOWN',
      tokenVersion: 1,
    });

    const httpClient = {
      refreshToken: jest
        .fn()
        .mockImplementation(({ refreshToken }: { refreshToken: string }) => {
          // Prova que cada recuperação usa o refresh token da PRÓPRIA conta —
          // nunca o de outra (isolamento Meli 1/Meli 2).
          const owner = refreshToken.startsWith('refresh-A') ? 'A' : 'B';
          return Promise.resolve({
            kind: 'success',
            token: {
              accessToken: `APP_USR-recovered-${owner}`,
              refreshToken: `TG-recovered-${owner}`,
              expiresInSeconds: 10800,
              userId: 1,
              tokenType: 'bearer',
              scope: 'offline_access read',
            },
          });
        }),
    };
    const service = buildService(httpClient);

    const [outcomeA, outcomeB] = await Promise.all([
      service.recoverConnection(accountA),
      service.recoverConnection(accountB),
    ]);

    expect(outcomeA).toBe('RECOVERED');
    expect(outcomeB).toBe('RECOVERED');

    const rows = await dataSource.query<
      Array<{
        id: string;
        status: string;
        failure_code: string | null;
        encrypted_access_token: string;
      }>
    >(
      `SELECT id, status, failure_code, encrypted_access_token
         FROM marketplace_accounts WHERE id = ANY($1) ORDER BY id`,
      [[accountA, accountB]],
    );
    for (const row of rows) {
      expect(row.status).toBe('CONNECTED');
      expect(row.failure_code).toBeNull();
    }
    const decryptedA = encryptionService.decrypt(
      rows.find((r) => r.id === accountA)!.encrypted_access_token,
    );
    const decryptedB = encryptionService.decrypt(
      rows.find((r) => r.id === accountB)!.encrypted_access_token,
    );
    expect(decryptedA).toBe('APP_USR-recovered-A');
    expect(decryptedB).toBe('APP_USR-recovered-B');
  });

  it('a stale markRefreshDeferred write (CAS mismatch, real Postgres) never overwrites a newer state — a delayed failure response is simply discarded', async () => {
    const accountId = await seedAccount({
      externalSellerId: 'A',
      status: 'CONNECTED',
      tokenVersion: 5,
    });

    // Simula uma renovação bem-sucedida concorrente que já rodou e
    // incrementou token_version ANTES desta escrita atrasada chegar.
    await dataSource.query(
      `UPDATE marketplace_accounts SET token_version = 6 WHERE id = $1`,
      [accountId],
    );

    const applied = await marketplaceAccountsService.markRefreshDeferred({
      id: accountId,
      expectedTokenVersion: 5, // desatualizado
      failureCode: 'REFRESH_TEMPORARY_FAILURE',
      errorSummary: 'atrasada — nunca deveria aplicar',
      refreshRetryAt: new Date(Date.now() + 60_000),
    });

    expect(applied).toBe(false);

    const [row] = await dataSource.query<
      Array<{ failure_code: string | null; token_version: number }>
    >(
      `SELECT failure_code, token_version FROM marketplace_accounts WHERE id = $1`,
      [accountId],
    );
    // O estado mais novo (sucesso concorrente) continua intocado.
    expect(row.failure_code).toBeNull();
    expect(row.token_version).toBe(6);
  });

  it('never persists the plaintext refresh/access token in failure_code or error_summary', async () => {
    const accountId = await seedAccount({
      externalSellerId: 'A',
      status: 'CONNECTED',
      tokenExpiresAt: new Date(Date.now() - 60_000), // já expirado
    });
    const httpClient = {
      refreshToken: jest
        .fn()
        .mockResolvedValue({ kind: 'temporary_failure', retryAfterMs: null }),
    };
    const service = buildService(httpClient);

    await expect(service.ensureValidAccessToken(accountId)).rejects.toThrow(
      /REFRESH_TEMPORARY_FAILURE/,
    );

    const [row] = await dataSource.query<
      Array<{ failure_code: string | null; error_summary: string | null }>
    >(
      `SELECT failure_code, error_summary FROM marketplace_accounts WHERE id = $1`,
      [accountId],
    );
    expect(row.failure_code).toBe('REFRESH_TEMPORARY_FAILURE');
    expect(row.error_summary).not.toContain('refresh-A');
    expect(row.error_summary).not.toContain('access-A');
  });
});
