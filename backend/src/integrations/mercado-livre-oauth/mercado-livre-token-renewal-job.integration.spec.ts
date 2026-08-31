import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from './advisory-lock.service';
import { MercadoLivreOAuthCleanupService } from './mercado-livre-oauth-cleanup.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';
import { MercadoLivreTokenRenewalJob } from './mercado-livre-token-renewal.job';
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
    ML_TOKEN_REFRESH_LEEWAY_MS: 900000,
    ML_OAUTH_PROCESSING_STALE_AFTER_MS: 120000,
    ML_ACCOUNT_LOCK_WAIT_MS: 500,
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

function buildJob(dataSource: DataSource, httpClient: unknown) {
  const configService = fakeConfigService();
  const encryptionService = new EncryptionService(configService);
  const marketplaceAccountsService = new MarketplaceAccountsService(
    dataSource.getRepository(MarketplaceAccount),
    dataSource,
  );
  const authorizationRequestsService = new OAuthAuthorizationRequestsService(
    dataSource,
    encryptionService,
  );
  const advisoryLockService = new AdvisoryLockService(
    dataSource,
    configService,
  );
  const service = new MercadoLivreOAuthService(
    marketplaceAccountsService,
    authorizationRequestsService,
    advisoryLockService,
    httpClient as never,
    encryptionService,
    configService,
    dataSource,
  );
  const cleanupService = new MercadoLivreOAuthCleanupService(
    authorizationRequestsService,
    advisoryLockService,
    configService,
  );
  return new MercadoLivreTokenRenewalJob(
    service,
    marketplaceAccountsService,
    cleanupService,
    configService,
  );
}

describe('MercadoLivreTokenRenewalJob — two simulated instances (real Postgres)', () => {
  let dataSource: DataSource;
  let accountId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([
      OAuthAuthorizationRequest,
      MarketplaceAccount,
    ]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');

    const encryptionService = new EncryptionService(fakeConfigService());
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

  it('two job "instances" (separate MercadoLivreOAuthService/AdvisoryLockService graphs) running at the same time on the same due account: only one actually calls refreshToken; the account ends with tokenVersion=1, never 2', async () => {
    // Barreira controlada em vez de setTimeout(300) "torcendo" para que o
    // job B só tente adquirir o lock depois que o job A já o detém: o job A
    // só chega a chamar refreshToken() DEPOIS de já ter adquirido o lock, e
    // é essa chamada que libera o início do job B. O refresh do job A só é
    // resolvido depois que aguardamos o job B terminar sua própria tentativa
    // (real, contra o Postgres) e desistir com ACCOUNT_BUSY.
    let refreshCallCount = 0;
    const jobAHasLock = deferred<void>();
    const jobARefreshGate = deferred<unknown>();

    const slowSuccessfulRefresh = {
      refreshToken: () => {
        refreshCallCount += 1;
        jobAHasLock.resolve();
        return jobARefreshGate.promise;
      },
    };

    const jobA = buildJob(dataSource, slowSuccessfulRefresh);
    const jobB = buildJob(dataSource, slowSuccessfulRefresh);

    const jobAPromise = jobA.handleCron();
    const jobBPromise = jobAHasLock.promise.then(() => jobB.handleCron());

    // Aguarda o job B terminar por completo (ele espera de verdade, contra o
    // Postgres, até ML_ACCOUNT_LOCK_WAIT_MS e desiste com ACCOUNT_BUSY —
    // engolido pelo `catch` do job, que loga e segue) antes de liberar o
    // refresh do job A de forma controlada.
    await jobBPromise;
    jobARefreshGate.resolve({
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
    await jobAPromise;

    // Só o job A realmente chegou a chamar refreshToken; o job B encontrou o
    // lock ocupado e nunca chamou.
    expect(refreshCallCount).toBe(1);

    const rows: Array<{ token_version: number; status: string }> =
      await dataSource.query(
        'SELECT token_version, status FROM marketplace_accounts WHERE id = $1',
        [accountId],
      );
    expect(rows[0].status).toBe('CONNECTED');
    expect(rows[0].token_version).toBe(1);
  });
});
