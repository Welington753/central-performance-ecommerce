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

/**
 * Uma variável `let signal: () => void;` atribuída dentro do executor do
 * `Promise` e chamada mais tarde falha em TypeScript strict: a análise de
 * fluxo do compilador não assume que o executor roda de forma síncrona, e
 * marca `signal` como "usada antes de ser atribuída" (TS2454). Este helper
 * isola a única asserção de atribuição definitiva (`!`) necessária, em um
 * lugar só — o resto do teste usa `deferred.resolve`/`deferred.promise`
 * normalmente tipados, sem nenhum `!` espalhado pelo corpo do teste.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    FRONTEND_URL: 'https://app.example.com',
    ML_ACCOUNT_LOCK_WAIT_MS: 500, // curto: o teste quer ver ACCOUNT_BUSY, não esperar o padrão de 3s
    ML_TOKEN_REFRESH_LEEWAY_MS: 900000,
    // Divergência mínima do plano (já documentada na Task 19): o literal do
    // plano tem 62 caracteres hex (falha o regex de 64 e cai no fallback
    // base64, decodificando para 46 bytes em vez de 32) — corrigido aqui
    // para 64 caracteres hex válidos (32 bytes), preservando o
    // comportamento exigido (chave AES-256-GCM determinística).
    CREDENTIAL_ENCRYPTION_KEY:
      '3132333435363738393031323334353637383930313233343536373839303a3b',
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('Callback vs refresh — same advisory lock (real Postgres)', () => {
  let dataSource: DataSource;
  let accountId: string;
  let userId: string;
  let encryptionService: EncryptionService;
  let marketplaceAccountsService: MarketplaceAccountsService;
  let authorizationRequestsService: OAuthAuthorizationRequestsService;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      OAuthAuthorizationRequest,
      MarketplaceAccount,
    ]);

    const configService = fakeConfigService();
    encryptionService = new EncryptionService(configService);
    marketplaceAccountsService = new MarketplaceAccountsService(
      dataSource.getRepository(MarketplaceAccount),
      dataSource,
    );
    authorizationRequestsService = new OAuthAuthorizationRequestsService(
      dataSource,
      encryptionService,
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
      `INSERT INTO marketplace_accounts
         (id, marketplace, status, external_seller_id, encrypted_access_token, encrypted_refresh_token, token_expires_at)
       VALUES ($1, 'MERCADO_LIVRE', 'CONNECTED', '555', $2, $3, now() - interval '1 minute')`,
      [
        accountId,
        encryptionService.encrypt('old-access'),
        encryptionService.encrypt('old-refresh'),
      ],
    );
  });

  it('a refresh holding the lock makes a concurrent callback on the SAME account finalize FAILED/ACCOUNT_BUSY, never touching the account or calling exchangeCode', async () => {
    // Barreira controlada em vez de setTimeout(50/700) "torcendo" pela
    // ordem: o refresh só chega a chamar refreshToken() DEPOIS de já ter
    // adquirido o lock, e é essa chamada que libera o início do callback. O
    // refresh do refreshToken só é resolvido depois que aguardamos o
    // callback terminar sua própria tentativa (real, contra o Postgres, até
    // ML_ACCOUNT_LOCK_WAIT_MS) e desistir com ACCOUNT_BUSY.
    const configService = fakeConfigService();
    const advisoryLockServiceForRefresh = new AdvisoryLockService(
      dataSource,
      configService,
    );
    const refreshHasLock = deferred<void>();
    const refreshGate = deferred<unknown>();
    const slowHttpClient = {
      refreshToken: () => {
        refreshHasLock.resolve();
        return refreshGate.promise;
      },
    };
    const refreshService = new MercadoLivreOAuthService(
      marketplaceAccountsService,
      authorizationRequestsService,
      advisoryLockServiceForRefresh,
      slowHttpClient as never,
      encryptionService,
      configService,
      dataSource,
    );

    const advisoryLockServiceForCallback = new AdvisoryLockService(
      dataSource,
      configService,
    );
    const callbackHttpClient = {
      exchangeCode: jest.fn(),
      fetchIdentity: jest.fn(),
    };
    const callbackService = new MercadoLivreOAuthService(
      marketplaceAccountsService,
      authorizationRequestsService,
      advisoryLockServiceForCallback,
      callbackHttpClient as never,
      encryptionService,
      configService,
      dataSource,
    );

    const pending = await authorizationRequestsService.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: 'MERCADO_LIVRE' as never,
    });

    const refreshPromise = refreshService
      .ensureValidAccessToken(accountId)
      .catch((e: Error) => e);
    const callbackPromise = refreshHasLock.promise.then(() =>
      callbackService.handleCallback({ state: pending.state, code: 'c' }),
    );

    // Aguarda o callback terminar por completo antes de liberar o refresh
    // de forma controlada — nenhuma etapa depende de um `setTimeout`
    // arbitrário "longo o suficiente".
    const callbackResult = await callbackPromise;
    refreshGate.resolve({
      kind: 'success',
      token: {
        accessToken: 'APP_USR-new',
        refreshToken: 'TG-new',
        expiresInSeconds: 10800,
        userId: 555,
        tokenType: 'bearer',
        scope: 'offline_access read',
      },
    });
    const refreshResult = await refreshPromise;

    expect(refreshResult).toBe('APP_USR-new'); // o refresh venceu e completou
    expect(callbackHttpClient.exchangeCode).not.toHaveBeenCalled();
    const reason = new URL(callbackResult.redirectUrl).searchParams.get(
      'reason',
    );
    expect(reason).toBe('TRY_AGAIN_LATER'); // ACCOUNT_BUSY -> TRY_AGAIN_LATER

    const accountRow: Array<{
      status: string;
      encrypted_access_token: string;
      token_version: number;
    }> = await dataSource.query(
      'SELECT status, encrypted_access_token, token_version FROM marketplace_accounts WHERE id = $1',
      [accountId],
    );
    expect(accountRow[0].status).toBe('CONNECTED');
    expect(accountRow[0].token_version).toBe(1); // só o refresh vencedor escreveu
  });
});
