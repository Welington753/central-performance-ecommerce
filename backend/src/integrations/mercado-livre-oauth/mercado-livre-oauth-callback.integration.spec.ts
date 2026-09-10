import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from '../shared/advisory-lock.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';
import { OAuthAuthorizationRequest } from './oauth-authorization-request.entity';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

function fakeConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    FRONTEND_URL: 'https://app.example.com',
    ML_ACCOUNT_LOCK_WAIT_MS: 2000,
    // Divergência mínima do plano (Task 19, Step 9): o literal do plano tem
    // 62 caracteres hex (falha o regex de 64 caracteres e cai no fallback
    // base64, decodificando para 46 bytes em vez de 32) — corrigido aqui
    // para 64 caracteres hex válidos (32 bytes), preservando o comportamento
    // exigido (chave AES-256-GCM determinística para os testes).
    CREDENTIAL_ENCRYPTION_KEY:
      '3132333435363738393031323334353637383930313233343536373839303a3b',
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('Callback atomicity and concurrency (real Postgres)', () => {
  let dataSource: DataSource;
  let service: MercadoLivreOAuthService;
  let authorizationRequestsService: OAuthAuthorizationRequestsService;
  let accountId: string;
  let userId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      OAuthAuthorizationRequest,
      MarketplaceAccount,
    ]);

    const configService = fakeConfigService();
    const encryptionService = new EncryptionService(configService);
    const marketplaceAccountsService = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
    authorizationRequestsService = new OAuthAuthorizationRequestsService(
      dataSource,
      encryptionService,
    );
    const advisoryLockService = new AdvisoryLockService(
      dataSource,
      configService,
    );
    const httpClient = {
      // Divergência mínima do plano (Task 19, verificação de lint): sem
      // `await` interno, `async () => (...)` violava
      // `@typescript-eslint/require-await` — removido aqui porque
      // `await` sobre um valor não-Promise resolve normalmente, sem mudar
      // o comportamento observado pelo chamador.
      exchangeCode: () => ({
        kind: 'success' as const,
        token: {
          accessToken: 'APP_USR-race',
          refreshToken: 'TG-race',
          expiresInSeconds: 10800,
          userId: 555,
          tokenType: 'bearer',
          scope: 'offline_access read',
        },
      }),
      fetchIdentity: () => ({
        kind: 'success' as const,
        externalUserId: 555,
      }),
    };

    service = new MercadoLivreOAuthService(
      marketplaceAccountsService,
      authorizationRequestsService,
      advisoryLockService,
      httpClient as never,
      encryptionService,
      configService,
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    accountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED')`,
      [accountId],
    );
  });

  it('exactly one of two racing callbacks (same state, replayed) succeeds; the account ends CONNECTED with tokenVersion=1', async () => {
    const pending = await authorizationRequestsService.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: 'MERCADO_LIVRE' as never,
    });

    const [first, second] = await Promise.all([
      service.handleCallback({ state: pending.state, code: 'c' }),
      service.handleCallback({ state: pending.state, code: 'c' }),
    ]);

    const reasons = [first.redirectUrl, second.redirectUrl].map((url) =>
      new URL(url).searchParams.get('reason'),
    );
    expect(reasons.filter((r) => r === 'success')).toHaveLength(1);
    expect(reasons.filter((r) => r === 'OAUTH_CALLBACK_INVALID')).toHaveLength(
      1,
    );

    const rows: Array<{ status: string; token_version: number }> =
      await dataSource.query(
        'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
        [accountId],
      );
    expect(rows[0].status).toBe('CONNECTED');
    expect(rows[0].token_version).toBe(1);
  });

  it('replaying the same state after it already resolved to SUCCESS has no further effect (account and attempt unchanged)', async () => {
    const pending = await authorizationRequestsService.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: 'MERCADO_LIVRE' as never,
    });
    const first = await service.handleCallback({
      state: pending.state,
      code: 'c',
    });
    expect(new URL(first.redirectUrl).searchParams.get('reason')).toBe(
      'success',
    );

    const beforeReplay: Array<{ status: string; token_version: number }> =
      await dataSource.query(
        'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
        [accountId],
      );

    const replay = await service.handleCallback({
      state: pending.state,
      code: 'c',
    });
    expect(new URL(replay.redirectUrl).searchParams.get('reason')).toBe(
      'OAUTH_CALLBACK_INVALID',
    );

    const afterReplay: Array<{ status: string; token_version: number }> =
      await dataSource.query(
        'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
        [accountId],
      );
    expect(afterReplay).toEqual(beforeReplay);
  });

  it('replaying the same state after it already resolved to FAILED has no further effect', async () => {
    const pending = await authorizationRequestsService.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: 'MERCADO_LIVRE' as never,
    });
    const first = await service.handleCallback({
      state: pending.state,
      error: 'access_denied',
    });
    expect(new URL(first.redirectUrl).searchParams.get('reason')).toBe(
      'AUTHORIZATION_DENIED',
    );

    const replay = await service.handleCallback({
      state: pending.state,
      code: 'c',
    });
    expect(new URL(replay.redirectUrl).searchParams.get('reason')).toBe(
      'OAUTH_CALLBACK_INVALID',
    );

    const rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM oauth_authorization_requests WHERE state_hash = (SELECT state_hash FROM oauth_authorization_requests LIMIT 1)',
    );
    expect(rows[0].status).toBe('FAILED'); // nunca virou PROCESSING/SUCCESS de novo
  });

  it('the account NEVER ends CONNECTED unless the attempt itself became SUCCESS: forcing the paired request-UPDATE to affect zero rows rolls back the account CAS too', async () => {
    const pending = await authorizationRequestsService.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: 'MERCADO_LIVRE' as never,
    });
    const claimed = await authorizationRequestsService.claimByState(
      pending.state,
      Marketplace.MERCADO_LIVRE,
    );
    // Simula "a tentativa deixou de estar PROCESSING" entre o claim e a
    // persistência (ex.: recovery job concorrente) — força exatamente o
    // cenário que `applyConnectionAndFinalizeAtomically` trata como
    // `request_not_processing`, sem precisar mockar o QueryRunner.
    await dataSource.query(
      `UPDATE oauth_authorization_requests SET status = 'FAILED', failure_code = 'CALLBACK_RESULT_UNKNOWN' WHERE id = $1`,
      [claimed!.id],
    );
    // Reabre outra tentativa PENDING/PROCESSING não é possível pelo fluxo
    // público (claimByState já consumiu o state) — em vez disso, exercitamos
    // diretamente o método interno via reflexão de teste NÃO é necessário:
    // o próprio handleCallback, ao tentar reivindicar esse state de novo,
    // já cai em OAUTH_CALLBACK_INVALID (coberto pelo teste de replay acima).
    // Este teste prova a mesma garantia de atomicidade pelo caminho direto:
    const account: Array<{ token_version: number }> = await dataSource.query(
      'SELECT token_version FROM marketplace_accounts WHERE id = $1',
      [accountId],
    );
    const outcome = await (
      service as unknown as {
        applyConnectionAndFinalizeAtomically: (
          input: unknown,
        ) => Promise<string>;
      }
    ).applyConnectionAndFinalizeAtomically({
      accountId,
      expectedTokenVersion: account[0].token_version,
      externalSellerId: '555',
      encryptedAccessToken: 'enc:a',
      encryptedRefreshToken: 'enc:r',
      tokenExpiresAt: new Date(Date.now() + 10800 * 1000),
      connectedByUserId: userId,
      authorizationRequestId: claimed!.id, // já FAILED, não mais PROCESSING
    });

    expect(outcome).toBe('request_not_processing');

    const rows: Array<{ status: string; token_version: number }> =
      await dataSource.query(
        'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
        [accountId],
      );
    expect(rows[0].status).toBe('DISCONNECTED'); // CAS da conta foi revertido junto
    expect(rows[0].token_version).toBe(0);
  });

  it('a losing account in an externalSellerId race never gets its own row overwritten — the winning account keeps its tokens untouched', async () => {
    const winnerId = accountId; // já DISCONNECTED, será o vencedor
    await dataSource.query(
      `UPDATE marketplace_accounts SET status = 'CONNECTED', external_seller_id = '555', encrypted_access_token = 'enc:winner-a', encrypted_refresh_token = 'enc:winner-r', token_version = 3 WHERE id = $1`,
      [winnerId],
    );

    const loserId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED')`,
      [loserId],
    );
    const pending = await authorizationRequestsService.createPending({
      marketplaceAccountId: loserId,
      initiatedByUserId: userId,
      marketplace: 'MERCADO_LIVRE' as never,
    });

    const result = await service.handleCallback({
      state: pending.state,
      code: 'c',
    });
    expect(new URL(result.redirectUrl).searchParams.get('reason')).toBe(
      'ACCOUNT_ALREADY_CONNECTED',
    );

    const winnerRow: Array<{
      status: string;
      encrypted_access_token: string;
      token_version: number;
    }> = await dataSource.query(
      'SELECT status, encrypted_access_token, token_version FROM marketplace_accounts WHERE id = $1',
      [winnerId],
    );
    expect(winnerRow[0].status).toBe('CONNECTED');
    expect(winnerRow[0].encrypted_access_token).toBe('enc:winner-a');
    expect(winnerRow[0].token_version).toBe(3); // intocado

    const loserRow: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM marketplace_accounts WHERE id = $1',
      [loserId],
    );
    expect(loserRow[0].status).toBe('ERROR');
  });
});
