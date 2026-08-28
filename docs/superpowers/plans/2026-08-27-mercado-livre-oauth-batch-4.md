# Mercado Livre OAuth (Fase 2) — Lote 4 de 4: Tasks 21–25

> **Antes de começar, leia nesta ordem e SOMENTE isto:**
> 1. O design aprovado — [docs/superpowers/specs/2026-08-27-mercado-livre-oauth-design.md](../specs/2026-08-27-mercado-livre-oauth-design.md).
> 2. O índice mestre curto — [2026-08-27-mercado-livre-oauth-implementation-plan.md](2026-08-27-mercado-livre-oauth-implementation-plan.md) (objetivo, constraints globais, estratégia de execução, tabela de lotes).
> 3. Este arquivo — se esta sessão começa no Checkpoint 8 (Tasks 21–23), leia do início; se retoma no Checkpoint 9 (Task 24, já com Tasks 21–23 commitadas) ou no Checkpoint 10 (Task 25, já com Tasks 21–24 commitadas), localize `## Task 24:` ou `## Task 25:` neste arquivo e leia a partir dali, sem reler as Tasks anteriores do lote.
> 4. Os arquivos reais do código citados pela tarefa em execução, somente quando necessário para confirmar assinaturas/config existentes.
>
> Não releia os outros três lotes — eles não são pré-requisito de contexto para este.

**Pré-requisito:** Lote 3 (Tasks 14–20, [2026-08-27-mercado-livre-oauth-batch-3.md](2026-08-27-mercado-livre-oauth-batch-3.md)) já implementado, testado e commitado nesta branch. Não prossiga se o commit do Lote 3 não existir.

**Sub-agentes:** não usar subagentes/agent teams por padrão para executar este lote. Use `superpowers:executing-plans`, tarefa por tarefa, sequencialmente, dentro desta sessão.

**Ao final deste lote:** a Task 25 é o checkpoint final de homologação de toda a Fase 2. Pare ali e aguarde revisão/aprovação antes de qualquer merge.

---

## Task 21: Cleanup routines — PENDING expiration + PROCESSING recovery (design §6.3)

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-cleanup.service.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-cleanup.service.spec.ts`

**Interfaces:**
- Consumes: `OAuthAuthorizationRequestsService` (Task 12), `AdvisoryLockService` (Task 13), `ConfigService` (`ML_OAUTH_PROCESSING_STALE_AFTER_MS`).
- Produces: `class MercadoLivreOAuthCleanupService` with `sweepExpiredPending(): Promise<number>` and `recoverStaleProcessing(): Promise<number>` — consumed by Task 22's renewal job.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-cleanup.service.spec.ts
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MercadoLivreOAuthCleanupService } from './mercado-livre-oauth-cleanup.service';

function makeConfigService(staleAfterMs: number): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'ML_OAUTH_PROCESSING_STALE_AFTER_MS' ? staleAfterMs : fallback,
  } as unknown as ConfigService;
}

describe('MercadoLivreOAuthCleanupService', () => {
  it('sweepExpiredPending delegates directly to the authorization requests service', async () => {
    const authorizationRequestsService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(3),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      {} as never,
      makeConfigService(120000),
    );

    expect(await service.sweepExpiredPending()).toBe(3);
  });

  it('recoverStaleProcessing skips a candidate whose account lock is currently held (callback/refresh still running)', async () => {
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest.fn().mockResolvedValue([
        { id: 'req-1', marketplaceAccountId: 'acc-1' },
      ]),
      failIfStillStaleProcessing: jest.fn(),
    };
    const advisoryLockService = { tryAcquire: jest.fn().mockResolvedValue(null) };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    const recovered = await service.recoverStaleProcessing();

    expect(recovered).toBe(0);
    expect(authorizationRequestsService.failIfStillStaleProcessing).not.toHaveBeenCalled();
  });

  it('recoverStaleProcessing marks FAILED and releases the lock when it acquires it', async () => {
    const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest.fn().mockResolvedValue([
        { id: 'req-1', marketplaceAccountId: 'acc-1' },
      ]),
      failIfStillStaleProcessing: jest.fn().mockResolvedValue(true),
    };
    const advisoryLockService = { tryAcquire: jest.fn().mockResolvedValue(lockHandle) };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    const recovered = await service.recoverStaleProcessing();

    expect(recovered).toBe(1);
    expect(authorizationRequestsService.failIfStillStaleProcessing).toHaveBeenCalledWith(
      'req-1',
      expect.any(Date),
    );
    expect(lockHandle.release).toHaveBeenCalled();
  });

  it('recoverStaleProcessing counts only candidates actually changed by failIfStillStaleProcessing', async () => {
    const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest.fn().mockResolvedValue([
        { id: 'req-1', marketplaceAccountId: 'acc-1' },
      ]),
      failIfStillStaleProcessing: jest.fn().mockResolvedValue(false), // already handled elsewhere
    };
    const advisoryLockService = { tryAcquire: jest.fn().mockResolvedValue(lockHandle) };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    expect(await service.recoverStaleProcessing()).toBe(0);
  });

  it('recoverStaleProcessing isolates a failure on one candidate — a throwing tryAcquire/failIfStillStaleProcessing for candidate A does not stop candidate B from being processed', async () => {
    const lockHandleB = { release: jest.fn().mockResolvedValue(undefined) };
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest.fn().mockResolvedValue([
        { id: 'req-A-broken', marketplaceAccountId: 'acc-A' },
        { id: 'req-B-ok', marketplaceAccountId: 'acc-B' },
      ]),
      failIfStillStaleProcessing: jest.fn((id: string) =>
        id === 'req-B-ok' ? Promise.resolve(true) : Promise.reject(new Error('db down')),
      ),
    };
    const advisoryLockService = {
      tryAcquire: jest.fn((accountId: string) =>
        accountId === 'acc-A'
          ? Promise.reject(new Error('connection reset'))
          : Promise.resolve(lockHandleB),
      ),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    const recovered = await service.recoverStaleProcessing();

    // A falhou (tryAcquire rejeitou), mas B ainda foi processada e contada.
    expect(recovered).toBe(1);
    expect(authorizationRequestsService.failIfStillStaleProcessing).toHaveBeenCalledWith(
      'req-B-ok',
      expect.any(Date),
    );
    expect(lockHandleB.release).toHaveBeenCalledTimes(1);
  });

  it('recoverStaleProcessing never logs a raw secret from a failed candidate — code, state, Bearer token, and client_secret are all sanitized before reaching the Logger', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const sensitiveError = new Error(
      'ML token exchange failed: code=abc123 state=xyz789 ' +
        'Authorization: Bearer APP_USR-1234567890abcdef ' +
        'client_secret=super-secret-value',
    );
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest.fn().mockResolvedValue([
        { id: 'req-1', marketplaceAccountId: 'acc-1' },
      ]),
      failIfStillStaleProcessing: jest.fn().mockRejectedValue(sensitiveError),
    };
    const advisoryLockService = {
      tryAcquire: jest
        .fn()
        .mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) }),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    await service.recoverStaleProcessing();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(errorSpy.mock.calls[0]);
    expect(loggedPayload).not.toContain('abc123');
    expect(loggedPayload).not.toContain('xyz789');
    expect(loggedPayload).not.toContain('APP_USR-1234567890abcdef');
    expect(loggedPayload).not.toContain('super-secret-value');

    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-oauth-cleanup.service.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-oauth-cleanup.service'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-cleanup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { redactSensitiveData } from '../../common/logging/redact.util';
import { AdvisoryLockService } from './advisory-lock.service';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

@Injectable()
export class MercadoLivreOAuthCleanupService {
  private readonly logger = new Logger(MercadoLivreOAuthCleanupService.name);

  constructor(
    private readonly authorizationRequestsService: OAuthAuthorizationRequestsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly configService: ConfigService,
  ) {}

  async sweepExpiredPending(): Promise<number> {
    return this.authorizationRequestsService.sweepExpiredPending();
  }

  /**
   * design §6.3.b: nunca marca uma tentativa PROCESSING como abandonada sem
   * antes tentar o mesmo advisory lock da conta — se ocupado, um callback ou
   * refresh legítimo pode ainda estar em execução, então pula.
   *
   * Cada candidata é isolada em seu próprio try/catch (item 9 da revisão):
   * `tryAcquire`/`failIfStillStaleProcessing`/`lock.release()` falhando para
   * UMA conta (ex.: conexão instável só com aquele advisory lock) não pode
   * interromper o processamento das demais candidatas do lote — o erro é
   * logado (nunca o corpo bruto de exceções de rede, só a mensagem já
   * seguramente textual) e o loop continua.
   */
  async recoverStaleProcessing(): Promise<number> {
    const staleAfterMs = this.configService.get<number>(
      'ML_OAUTH_PROCESSING_STALE_AFTER_MS',
      120000,
    );
    const cutoff = new Date(Date.now() - staleAfterMs);
    const candidates =
      await this.authorizationRequestsService.findStaleProcessingCandidates(cutoff);

    let recovered = 0;
    for (const candidate of candidates) {
      try {
        const lock = await this.advisoryLockService.tryAcquire(
          candidate.marketplaceAccountId,
        );
        if (!lock) continue;

        try {
          const changed = await this.authorizationRequestsService.failIfStillStaleProcessing(
            candidate.id,
            cutoff,
          );
          if (changed) recovered += 1;
        } finally {
          await lock.release();
        }
      } catch (error) {
        // `error.message` NUNCA é interpolado bruto (item 5 da segunda
        // revisão) — passa sempre por `redactSensitiveData` (Task 6), o
        // mesmo sanitizador já usado em `handleCallback` (Task 19). Os
        // únicos valores fora do sanitizador são identificadores seguros
        // (UUID da tentativa e da conta), nunca segredo/token/corpo bruto.
        this.logger.error('mercado_livre_oauth_recover_stale_processing_failed', {
          authorizationRequestId: candidate.id,
          marketplaceAccountId: candidate.marketplaceAccountId,
          message: redactSensitiveData(
            error instanceof Error ? error.message : 'erro desconhecido',
          ),
        });
      }
    }

    return recovered;
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-oauth-cleanup.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-cleanup.service.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-cleanup.service.spec.ts
git commit -m "feat(oauth): add PENDING expiration + PROCESSING recovery cleanup service"
```

---

## Task 22: `MercadoLivreTokenRenewalJob` + `ScheduleModule` wiring

**Files:**
- Modify: `backend/package.json` (add `@nestjs/schedule`)
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal.job.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal.job.spec.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal-job.integration.spec.ts`
- Modify: `backend/src/app.module.ts` (add `ScheduleModule.forRoot()`)

**Interfaces:**
- Consumes: `MercadoLivreOAuthService.ensureValidAccessToken` (Task 20), `MercadoLivreOAuthCleanupService` (Task 21), `MarketplaceAccountsService.findConnectedDueForRenewal` (Task 15).
- Produces: `class MercadoLivreTokenRenewalJob` with a `@Cron('*/5 * * * *') handleCron(): Promise<void>` method — wired into `MercadoLivreOAuthModule` in Task 23.

- [ ] **Step 1: Install the scheduling dependency**

```bash
cd backend && npm install @nestjs/schedule
```

Expected: `@nestjs/schedule` added to `backend/package.json` `dependencies`.

- [ ] **Step 2: Write the failing tests**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal.job.spec.ts
import { ConfigService } from '@nestjs/config';
import { MercadoLivreTokenRenewalJob } from './mercado-livre-token-renewal.job';

function makeConfigService(): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'ML_TOKEN_REFRESH_LEEWAY_MS' ? 900000 : fallback,
  } as unknown as ConfigService;
}

describe('MercadoLivreTokenRenewalJob', () => {
  it('sweeps expired PENDING, recovers stale PROCESSING, then renews every due account', async () => {
    const service = { ensureValidAccessToken: jest.fn().mockResolvedValue('token') };
    const marketplaceAccountsService = {
      findConnectedDueForRenewal: jest.fn().mockResolvedValue([{ id: 'acc-1' }, { id: 'acc-2' }]),
    };
    const cleanupService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(0),
      recoverStaleProcessing: jest.fn().mockResolvedValue(0),
    };
    const job = new MercadoLivreTokenRenewalJob(
      service as never,
      marketplaceAccountsService as never,
      cleanupService as never,
      makeConfigService(),
    );

    await job.handleCron();

    expect(cleanupService.sweepExpiredPending).toHaveBeenCalled();
    expect(cleanupService.recoverStaleProcessing).toHaveBeenCalled();
    expect(service.ensureValidAccessToken).toHaveBeenCalledWith('acc-1');
    expect(service.ensureValidAccessToken).toHaveBeenCalledWith('acc-2');
  });

  it('one account failing renewal does not stop the others from being attempted', async () => {
    const service = {
      ensureValidAccessToken: jest
        .fn()
        .mockRejectedValueOnce(new Error('REFRESH_TOKEN_REJECTED'))
        .mockResolvedValueOnce('token'),
    };
    const marketplaceAccountsService = {
      findConnectedDueForRenewal: jest.fn().mockResolvedValue([{ id: 'acc-1' }, { id: 'acc-2' }]),
    };
    const cleanupService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(0),
      recoverStaleProcessing: jest.fn().mockResolvedValue(0),
    };
    const job = new MercadoLivreTokenRenewalJob(
      service as never,
      marketplaceAccountsService as never,
      cleanupService as never,
      makeConfigService(),
    );

    await expect(job.handleCron()).resolves.toBeUndefined();
    expect(service.ensureValidAccessToken).toHaveBeenCalledTimes(2);
  });

  it('skips a second overlapping run while one is still in progress within the same instance', async () => {
    let resolveFirst!: () => void;
    const service = {
      ensureValidAccessToken: jest.fn(
        () => new Promise<string>((resolve) => { resolveFirst = () => resolve('token'); }),
      ),
    };
    const marketplaceAccountsService = {
      findConnectedDueForRenewal: jest.fn().mockResolvedValue([{ id: 'acc-1' }]),
    };
    const cleanupService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(0),
      recoverStaleProcessing: jest.fn().mockResolvedValue(0),
    };
    const job = new MercadoLivreTokenRenewalJob(
      service as never,
      marketplaceAccountsService as never,
      cleanupService as never,
      makeConfigService(),
    );

    const firstRun = job.handleCron();
    const secondRun = job.handleCron();

    expect(cleanupService.sweepExpiredPending).toHaveBeenCalledTimes(1);
    resolveFirst();
    await Promise.all([firstRun, secondRun]);
  });
});
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-token-renewal.job.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-token-renewal.job'`

- [ ] **Step 4: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal.job.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { MercadoLivreOAuthCleanupService } from './mercado-livre-oauth-cleanup.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

const RENEWAL_BATCH_SIZE = 25;

/**
 * Job agendado (design §3/§6.4): a cada 5 min, varre PENDING/PROCESSING
 * vencidos e renova contas CONNECTED perto da expiração. `running` evita
 * sobreposição DENTRO desta instância — a coordenação entre múltiplas
 * instâncias é feita pelo AdvisoryLockService, não por esta flag.
 */
@Injectable()
export class MercadoLivreTokenRenewalJob {
  private readonly logger = new Logger(MercadoLivreTokenRenewalJob.name);
  private running = false;

  constructor(
    private readonly service: MercadoLivreOAuthService,
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly cleanupService: MercadoLivreOAuthCleanupService,
    private readonly configService: ConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanupService.sweepExpiredPending();
      await this.cleanupService.recoverStaleProcessing();
      await this.renewDueAccounts();
    } finally {
      this.running = false;
    }
  }

  private async renewDueAccounts(): Promise<void> {
    const leewayMs = this.configService.get<number>('ML_TOKEN_REFRESH_LEEWAY_MS', 900000);
    const dueBefore = new Date(Date.now() + leewayMs);
    const accounts = await this.marketplaceAccountsService.findConnectedDueForRenewal(
      dueBefore,
      RENEWAL_BATCH_SIZE,
    );

    for (const account of accounts) {
      try {
        await this.service.ensureValidAccessToken(account.id);
      } catch {
        this.logger.warn(`mercado_livre_renewal_failed accountId=${account.id}`);
      }
    }
  }
}
```

- [ ] **Step 5: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-token-renewal.job.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: 🔍 Write and run a real-Postgres test proving two "job instances" renewing the same account are coordinated by the advisory lock (not just the in-process `running` flag)**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal-job.integration.spec.ts
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
 * normalmente tipados, sem nenhum `!` espalhado pelo corpo do teste (item 6
 * da segunda revisão).
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
    CREDENTIAL_ENCRYPTION_KEY:
      '3132333435363738393031323334353637383930313233343536373839303a',
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
  const advisoryLockService = new AdvisoryLockService(dataSource, configService);
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
    dataSource = await createTestDataSource([OAuthAuthorizationRequest, MarketplaceAccount]);
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

    const rows = await dataSource.query(
      'SELECT token_version, status FROM marketplace_accounts WHERE id = $1',
      [accountId],
    );
    expect(rows[0].status).toBe('CONNECTED');
    expect(rows[0].token_version).toBe(1);
  });
});
```

Run: `cd backend && CREDENTIAL_ENCRYPTION_KEY="3132333435363738393031323334353637383930313233343536373839303a" TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- mercado-livre-token-renewal-job.integration.spec.ts`
Expected: PASS (1 test). Determinístico — nenhuma etapa depende de um `setTimeout` arbitrário "longo o suficiente".

- [ ] **Step 7: Wire `ScheduleModule.forRoot()` into `app.module.ts`**

Add the import `import { ScheduleModule } from '@nestjs/schedule';` and `ScheduleModule.forRoot(),` right after `ThrottlerModule.forRootAsync({...}),` in the `imports` array.

- [ ] **Step 8: Confirm the app still boots and type-checks**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal.job.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal.job.spec.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-token-renewal-job.integration.spec.ts backend/src/app.module.ts
git commit -m "feat(oauth): add scheduled token renewal job, wire ScheduleModule"
```

---

## Task 23: Module wiring — `MercadoLivreOAuthModule` → `IntegrationsModule`, architecture-spec confirmation

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.module.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.module.spec.ts`
- Modify: `backend/src/integrations/integrations.module.ts`

**Interfaces:**
- Produces: `class MercadoLivreOAuthModule` exporting `MercadoLivreOAuthService` — this is what Task 24's frontend integration ultimately exercises end-to-end via HTTP. Provides `{ provide: ML_FETCH, useValue: fetch }` (Task 11) — without it, this module fails to compile (a real DI check, by design).
- No `TypeOrmModule.forFeature([OAuthAuthorizationRequest])` here: `OAuthAuthorizationRequestsService` (Task 12) never injects a `Repository<OAuthAuthorizationRequest>` — everything it does is raw SQL via `DataSource`. Registering `forFeature` for an entity nothing injects a repository for is dead configuration; it isn't added.

- [ ] **Step 1: Write the failing module-compilation test**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.module.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../auth/auth.module';
import { UserSession } from '../../auth/user-session.entity';
import { CommonModule } from '../../common/common.module';
import { User } from '../../users/user.entity';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { ML_FETCH } from './mercado-livre-http.client';
import { MercadoLivreOAuthModule } from './mercado-livre-oauth.module';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

describe('MercadoLivreOAuthModule', () => {
  it('compiles the full dependency graph and exports MercadoLivreOAuthService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              CREDENTIAL_ENCRYPTION_KEY:
                '3132333435363738393031323334353637383930313233343536373839303a',
              ACCESS_TOKEN_SECRET: 'x'.repeat(32),
              ML_CLIENT_ID: 'app-id',
              ML_CLIENT_SECRET: 'app-secret',
              ML_REDIRECT_URI: 'https://api.example.com/integrations/mercado-livre/callback',
            }),
          ],
        }),
        ScheduleModule.forRoot(),
        // CommonModule é @Global(), mas isso só vale para módulos que
        // pertencem à mesma árvore de compilação — na produção ela sempre
        // inclui CommonModule porque AppModule o importa (design §1), mas
        // este TestingModule NÃO importa AppModule, então o efeito global
        // não se aplica automaticamente. Sem esta linha, EncryptionService
        // (consumido por MercadoLivreOAuthService e
        // OAuthAuthorizationRequestsService) ficaria irresolvível e o
        // .compile() falharia — é exatamente esse encadeamento real que este
        // teste precisa provar, não simular.
        CommonModule,
        AuthModule,
        MarketplaceAccountsModule,
        MercadoLivreOAuthModule,
      ],
    })
      .overrideProvider(getRepositoryToken(MarketplaceAccount))
      .useValue({})
      // AuthModule importa TypeOrmModule.forFeature([UserSession]) e, por
      // meio de UsersModule, TypeOrmModule.forFeature([User]) — sem um
      // TypeOrmModule.forRoot() real neste TestingModule, essas duas
      // Repository também precisam de override explícito, senão o .compile()
      // falha ao resolver AuthService/UsersService antes mesmo de chegar ao
      // módulo do Mercado Livre.
      .overrideProvider(getRepositoryToken(UserSession))
      .useValue({})
      .overrideProvider(getRepositoryToken(User))
      .useValue({})
      .overrideProvider(DataSource)
      .useValue({ createQueryRunner: jest.fn() })
      // Nunca o `fetch` real: mesmo com o guard global de rede (Task 11)
      // bloqueando `global.fetch` antes de qualquer import, este teste
      // sobrescreve ML_FETCH explicitamente para não depender implicitamente
      // da ordem de carregamento do Jest — se algo aqui chamar a função,
      // o teste falha imediatamente com um erro claro, nunca com uma
      // tentativa real de acesso à rede.
      .overrideProvider(ML_FETCH)
      .useValue(
        jest.fn(() => {
          throw new Error('ML_FETCH não deveria ser chamado no teste de compilação do módulo.');
        }),
      )
      .compile();

    expect(moduleRef.get(MercadoLivreOAuthService)).toBeInstanceOf(
      MercadoLivreOAuthService,
    );
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-oauth.module.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-oauth.module'`

- [ ] **Step 3: Implement the module**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.module.ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';
import { AdvisoryLockService } from './advisory-lock.service';
import { ML_FETCH, MercadoLivreHttpClient } from './mercado-livre-http.client';
import { MercadoLivreOAuthCleanupService } from './mercado-livre-oauth-cleanup.service';
import { MercadoLivreOAuthController } from './mercado-livre-oauth.controller';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';
import { MercadoLivreTokenRenewalJob } from './mercado-livre-token-renewal.job';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

/**
 * Módulo específico do Mercado Livre — fora dos diretórios varridos por
 * `integrations/architecture.spec.ts` (design §1), assim como
 * `integrations/connectors`. `EncryptionService` vem do `CommonModule`
 * (`@Global()`), não precisa ser importado explicitamente aqui. Sem
 * `TypeOrmModule.forFeature` — ver nota nas Interfaces acima.
 */
@Module({
  imports: [MarketplaceAccountsModule, AuthModule],
  controllers: [MercadoLivreOAuthController],
  providers: [
    OAuthAuthorizationRequestsService,
    AdvisoryLockService,
    { provide: ML_FETCH, useValue: fetch },
    MercadoLivreHttpClient,
    MercadoLivreOAuthService,
    MercadoLivreOAuthCleanupService,
    MercadoLivreTokenRenewalJob,
  ],
  exports: [MercadoLivreOAuthService],
})
export class MercadoLivreOAuthModule {}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-oauth.module.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Wire into `IntegrationsModule`**

```typescript
// backend/src/integrations/integrations.module.ts
import { Module } from '@nestjs/common';
import { ConnectorsModule } from './connectors/connectors.module';
import { MarketplaceAccountsModule } from './marketplace-accounts/marketplace-accounts.module';
import { MercadoLivreOAuthModule } from './mercado-livre-oauth/mercado-livre-oauth.module';

@Module({
  imports: [ConnectorsModule, MarketplaceAccountsModule, MercadoLivreOAuthModule],
  exports: [ConnectorsModule, MarketplaceAccountsModule, MercadoLivreOAuthModule],
})
export class IntegrationsModule {}
```

- [ ] **Step 6: Run the full backend suite, including `architecture.spec.ts`, to confirm the isolation rule still holds**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" CREDENTIAL_ENCRYPTION_KEY="3132333435363738393031323334353637383930313233343536373839303a" npm test`
Expected: PASS (every suite, `architecture.spec.ts` included — `mercado-livre-oauth/` is not one of its `SCANNED_DIRECTORIES`, and nothing in it is named `MercadoLivreConnector`).

- [ ] **Step 7: Confirm the whole app boots (catches DI wiring mistakes `tsc`/unit tests can miss)**

```bash
cd backend
DATABASE_URL="$TEST_DATABASE_URL" \
CREDENTIAL_ENCRYPTION_KEY="3132333435363738393031323334353637383930313233343536373839303a" \
ACCESS_TOKEN_SECRET="$(node -e "console.log('x'.repeat(32))")" \
FRONTEND_URL="http://localhost:3001" \
COOKIE_SECURE=false \
ML_CLIENT_ID=fake-id \
ML_CLIENT_SECRET=fake-secret \
ML_REDIRECT_URI="http://localhost:3000/integrations/mercado-livre/callback" \
NODE_ENV=development \
npx ts-node -r tsconfig-paths/register -e "
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
NestFactory.create(AppModule, { logger: false }).then((app) => {
  console.log('APP_BOOTED_OK');
  return app.close();
});
"
```

Expected: prints `APP_BOOTED_OK` with no unhandled exceptions.

- [ ] **Step 8: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.module.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.module.spec.ts backend/src/integrations/integrations.module.ts
git commit -m "feat(oauth): wire MercadoLivreOAuthModule into IntegrationsModule"
```

## Task 24: 🔍 FRONTEND CHECKPOINT — wire `/integracoes` to real data, connect button, result banner

**Files:**
- Modify: `frontend/src/types/marketplace.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/MarketplaceCard.tsx`
- Modify: `frontend/src/app/(protegido)/integracoes/page.tsx`
- Modify: `frontend/__tests__/integracoes.test.tsx` (existing file — its current 3 tests assert the OLD fully-static/disabled behavior and MUST be rewritten, not just extended)

**Interfaces:**
- Consumes: `GET /marketplace-accounts` (Task 14), `POST /marketplace-accounts` (Task 14), `POST /marketplace-accounts/:id/mercado-livre/connect` (Task 16), the `?ml=success|error&reason=...` redirect contract (Task 18/19).
- Produces: `interface MarketplaceAccountDto` (frontend mirror of the backend DTO), `fetchMarketplaceAccounts()`, `createMarketplaceAccount()`, `connectMercadoLivre()` in `lib/api.ts`; an optional `cta.onClick` on `MarketplaceCardData`.

Note (per `frontend/AGENTS.md`): this Next.js version (16.3.3) may differ from training-data assumptions. If `useSearchParams()` behaves unexpectedly or the build fails on this page, check `frontend/node_modules/next/dist/docs/` before working around it — do not silently downgrade or bypass the API.

- [ ] **Step 1: Add the DTO type**

Append to `frontend/src/types/marketplace.ts`:

```typescript
// Espelha MarketplaceAccountResponseDto (Task 14) exatamente — sem
// failureCode/errorSummary: design §7 os define como interno/auditoria,
// nunca expostos ao navegador. O frontend deriva mensagens públicas fixas
// só a partir de `status` (STATUS_LABELS/STATUS_DESCRIPTIONS abaixo).
export interface MarketplaceAccountDto {
  id: string;
  marketplace: "MERCADO_LIVRE" | "AMAZON" | "SHOPEE";
  externalSellerId: string | null;
  nickname: string | null;
  status: "DISCONNECTED" | "CONNECTED" | "TOKEN_EXPIRED" | "ERROR";
  tokenExpiresAt: string | null;
  lastSuccessfulSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Add `onClick?: () => void;` to `MarketplaceCardData['cta']`:

```typescript
export interface MarketplaceCardData {
  id: string;
  name: string;
  statusLabel: string;
  description: string;
  cta?: {
    label: string;
    disabled: boolean;
    tooltip?: string;
    onClick?: () => void;
  };
}
```

- [ ] **Step 2: Wire the button's `onClick` in `MarketplaceCard.tsx`**

In `frontend/src/components/MarketplaceCard.tsx`, add `data-testid={`marketplace-account-${card.id}`}` to the outer wrapper `<div>` (used by Task 24's tests to scope assertions to one specific account card among several), and pass `onClick={card.cta.onClick}` on the `<button>`:

```tsx
    <div
      data-testid={`marketplace-account-${card.id}`}
      className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-6 shadow-sm"
    >
```

```tsx
          <button
            type="button"
            disabled={card.cta.disabled}
            onClick={card.cta.onClick}
            aria-describedby={
              card.cta.tooltip ? `${card.id}-cta-tooltip` : undefined
            }
            className="w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-foreground/10 disabled:text-foreground/40"
          >
```

- [ ] **Step 3: Add the API helpers**

Append to `frontend/src/lib/api.ts`:

```typescript
import type { MarketplaceAccountDto } from "@/types/marketplace";

export async function fetchMarketplaceAccounts(): Promise<MarketplaceAccountDto[]> {
  const response = await apiFetch("/marketplace-accounts");
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível carregar as contas de marketplace.");
  }
  return (await response.json()) as MarketplaceAccountDto[];
}

export async function createMarketplaceAccount(
  marketplace: MarketplaceAccountDto["marketplace"],
): Promise<MarketplaceAccountDto> {
  const response = await apiFetch("/marketplace-accounts", {
    method: "POST",
    body: JSON.stringify({ marketplace }),
  });
  if (!response.ok) {
    throw new ApiFetchError("Não foi possível criar a conta de marketplace.");
  }
  return (await response.json()) as MarketplaceAccountDto;
}

export async function connectMercadoLivre(
  accountId: string,
): Promise<{ authorizationUrl: string }> {
  const response = await apiFetch(
    `/marketplace-accounts/${accountId}/mercado-livre/connect`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new ApiFetchError(
      "Não foi possível iniciar a conexão com o Mercado Livre.",
    );
  }
  return (await response.json()) as { authorizationUrl: string };
}
```

- [ ] **Step 4: Write the failing (rewritten) page test — MULTIPLE Mercado Livre accounts, not just one**

The design's whole point is multi-account support (brainstorming Q1: "Mais de uma conta do Mercado Livre"). The old single-account `.find(...)` approach is replaced below with a list; these tests reflect that from the start.

Replace the entire contents of `frontend/__tests__/integracoes.test.tsx`:

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IntegracoesPage from "@/app/(protegido)/integracoes/page";
import * as api from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
}));

const { useSearchParams } = jest.requireMock("next/navigation") as {
  useSearchParams: jest.Mock;
};

function mockSearchParams(params: Record<string, string> = {}) {
  useSearchParams.mockReturnValue(new URLSearchParams(params));
}

function mlAccount(overrides: Partial<MarketplaceAccountDto> = {}): MarketplaceAccountDto {
  return {
    id: "acc-1",
    marketplace: "MERCADO_LIVRE",
    externalSellerId: null,
    nickname: null,
    status: "DISCONNECTED",
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const originalLocation = window.location;

beforeEach(() => {
  jest.restoreAllMocks();
  mockSearchParams();
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, href: "" },
    writable: true,
  });
});

afterAll(() => {
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
  });
});

describe("IntegracoesPage", () => {
  it("renders Amazon and Shopee as static placeholders", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([]);

    render(<IntegracoesPage />);

    expect(await screen.findByText("Amazon")).toBeInTheDocument();
    expect(screen.getByText("Shopee")).toBeInTheDocument();
    expect(screen.getAllByText("Disponível futuramente")).toHaveLength(2);
  });

  it("shows an empty state with a 'Conectar Mercado Livre' button when no account exists yet", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([]);

    render(<IntegracoesPage />);

    await waitFor(() =>
      expect(screen.getByText("Status: Não conectado")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: /conectar mercado livre/i }),
    ).toBeEnabled();
  });

  it("renders TWO Mercado Livre accounts side by side, each with its own status and its own button", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([
      mlAccount({ id: "acc-1", nickname: "Loja Principal", status: "CONNECTED", externalSellerId: "111" }),
      mlAccount({ id: "acc-2", nickname: "Loja Secundária", status: "TOKEN_EXPIRED", externalSellerId: "222" }),
    ]);

    render(<IntegracoesPage />);

    const card1 = await screen.findByTestId("marketplace-account-acc-1");
    const card2 = await screen.findByTestId("marketplace-account-acc-2");

    expect(within(card1).getByText(/loja principal/i)).toBeInTheDocument();
    expect(within(card1).getByText("Status: Conectado")).toBeInTheDocument();
    expect(
      within(card1).getByRole("button", { name: /reconectar/i }),
    ).toBeInTheDocument();

    expect(within(card2).getByText(/loja secundária/i)).toBeInTheDocument();
    expect(
      within(card2).getByText("Status: Token expirado — reconexão necessária"),
    ).toBeInTheDocument();
    expect(
      within(card2).getByRole("button", { name: /reconectar/i }),
    ).toBeInTheDocument();
  });

  it("never shows failureCode or errorSummary text — only the fixed, generic status description", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([
      mlAccount({ id: "acc-1", status: "ERROR" }),
    ]);

    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    expect(within(card).getByText("Status: Erro — reconexão necessária")).toBeInTheDocument();
    // Nenhum texto de failureCode/errorSummary interno é renderizado — a
    // descrição vem só do STATUS_DESCRIPTIONS fixo do frontend.
    expect(screen.queryByText(/ACCOUNT_ALREADY_CONNECTED/)).not.toBeInTheDocument();
  });

  it("clicking 'Conectar' on a specific account calls connectMercadoLivre with THAT account's id and redirects", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([
      mlAccount({ id: "acc-1", status: "DISCONNECTED" }),
    ]);
    jest.spyOn(api, "connectMercadoLivre").mockResolvedValue({
      authorizationUrl: "https://auth.mercadolivre.com.br/authorization?state=abc",
    });

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    await user.click(within(card).getByRole("button", { name: /conectar/i }));

    await waitFor(() => expect(api.connectMercadoLivre).toHaveBeenCalledWith("acc-1"));
    expect(window.location.href).toBe(
      "https://auth.mercadolivre.com.br/authorization?state=abc",
    );
  });

  it("double-clicking the same account's connect button only calls connectMercadoLivre once (no duplicate in-flight requests)", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([
      mlAccount({ id: "acc-1", status: "DISCONNECTED" }),
    ]);
    let resolveConnect!: (v: { authorizationUrl: string }) => void;
    jest
      .spyOn(api, "connectMercadoLivre")
      .mockReturnValue(new Promise((resolve) => { resolveConnect = resolve; }));

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const card = await screen.findByTestId("marketplace-account-acc-1");
    const button = within(card).getByRole("button", { name: /conectar/i });
    await user.click(button);
    await user.click(button); // segundo clique enquanto a primeira chamada ainda está em voo

    expect(api.connectMercadoLivre).toHaveBeenCalledTimes(1);

    resolveConnect({ authorizationUrl: "https://auth.mercadolivre.com.br/authorization?state=abc" });
    // Aguarda a atualização assíncrona (redirecionamento) se completar antes
    // do teste terminar — sem isso, a promessa resolvida continua pendente
    // e o `act(...)` correspondente só ocorreria depois do teste já ter
    // encerrado, gerando warning e possível vazamento para o próximo teste.
    await waitFor(() =>
      expect(window.location.href).toBe(
        "https://auth.mercadolivre.com.br/authorization?state=abc",
      ),
    );
  });

  it("'Adicionar outra conta' creates exactly one new account per click, then connects it (double-click never creates two rows)", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([]);
    let resolveCreate!: (v: MarketplaceAccountDto) => void;
    jest
      .spyOn(api, "createMarketplaceAccount")
      .mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    jest.spyOn(api, "connectMercadoLivre").mockResolvedValue({
      authorizationUrl: "https://auth.mercadolivre.com.br/authorization?state=abc",
    });

    const user = userEvent.setup();
    render(<IntegracoesPage />);

    const addButton = await screen.findByRole("button", { name: /adicionar outra conta|conectar mercado livre/i });
    await user.click(addButton);
    await user.click(addButton); // segundo clique enquanto a criação ainda está em voo

    expect(api.createMarketplaceAccount).toHaveBeenCalledTimes(1);

    resolveCreate(mlAccount({ id: "acc-new" }));
    // Aguarda toda a cadeia assíncrona subsequente (loadAccounts +
    // handleConnect da conta recém-criada) se completar antes do teste
    // terminar — mesma razão do teste anterior: evita promessa pendente e
    // warning de `act(...)` fora do teste.
    await waitFor(() => expect(api.connectMercadoLivre).toHaveBeenCalledWith("acc-new"));
  });

  it("shows a distinct load-error message when fetching accounts fails — never falls back to a false 'Não conectado' card", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockRejectedValue(new Error("network down"));

    render(<IntegracoesPage />);

    expect(
      await screen.findByText(/não foi possível carregar suas contas/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Status: Não conectado")).not.toBeInTheDocument();
  });

  it("shows a success banner ONLY when ml=success AND reason=success are BOTH present", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([]);
    mockSearchParams({ ml: "success", reason: "success" });

    render(<IntegracoesPage />);

    expect(
      await screen.findByText("Conta do Mercado Livre conectada com sucesso."),
    ).toBeInTheDocument();
  });

  it("does NOT show the success banner when ml=success is present but reason is missing/mismatched", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([]);
    mockSearchParams({ ml: "success" });

    render(<IntegracoesPage />);
    await screen.findByText("Amazon"); // espera a página terminar de montar

    expect(
      screen.queryByText("Conta do Mercado Livre conectada com sucesso."),
    ).not.toBeInTheDocument();
  });

  it("shows an error banner for reason=ACCOUNT_ALREADY_CONNECTED", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([]);
    mockSearchParams({ ml: "error", reason: "ACCOUNT_ALREADY_CONNECTED" });

    render(<IntegracoesPage />);

    expect(
      await screen.findByText(
        "Esta conta do Mercado Livre já está conectada em outro registro.",
      ),
    ).toBeInTheDocument();
  });

  it("does NOT show the error banner when reason is a known error code but ml is not 'error' (a malformed/manipulated link)", async () => {
    jest.spyOn(api, "fetchMarketplaceAccounts").mockResolvedValue([]);
    mockSearchParams({ ml: "success", reason: "ACCOUNT_ALREADY_CONNECTED" });

    render(<IntegracoesPage />);
    await screen.findByText("Amazon"); // espera a página terminar de montar

    expect(
      screen.queryByText("Esta conta do Mercado Livre já está conectada em outro registro."),
    ).not.toBeInTheDocument();
    // reason !== "success", então também não deve cair no caminho de sucesso.
    expect(
      screen.queryByText("Conta do Mercado Livre conectada com sucesso."),
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it, confirm it fails**

Run: `cd frontend && npm test -- integracoes.test.tsx`
Expected: FAIL — `fetchMarketplaceAccounts`/`createMarketplaceAccount`/`connectMercadoLivre` don't exist on the `api` module yet from the page's perspective (the page itself is still fully static), and `useSearchParams` isn't called by the page.

- [ ] **Step 6: Implement the page — lists EVERY Mercado Livre account, each with its own connect/reconnect action, plus "Adicionar outra conta"**

Replace the entire contents of `frontend/src/app/(protegido)/integracoes/page.tsx`:

```tsx
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MarketplaceCard } from "@/components/MarketplaceCard";
import {
  connectMercadoLivre,
  createMarketplaceAccount,
  fetchMarketplaceAccounts,
} from "@/lib/api";
import type { MarketplaceAccountDto } from "@/types/marketplace";

// Mensagens públicas FIXAS (design §7/§13): nunca derivadas de failureCode
// ou errorSummary internos, que o DTO do backend (Task 14) nem expõe.
const REASON_MESSAGES: Record<string, string> = {
  OAUTH_CALLBACK_INVALID:
    "O link de retorno do Mercado Livre é inválido ou expirou. Tente conectar novamente.",
  AUTHORIZATION_DENIED: "A autorização foi cancelada no Mercado Livre.",
  IDENTITY_MISMATCH:
    "A conta autorizada no Mercado Livre não corresponde à conta esperada.",
  ACCOUNT_ALREADY_CONNECTED:
    "Esta conta do Mercado Livre já está conectada em outro registro.",
  TRY_AGAIN_LATER:
    "Não foi possível concluir a conexão agora. Tente novamente em instantes.",
};

const STATUS_LABELS: Record<MarketplaceAccountDto["status"], string> = {
  DISCONNECTED: "Não conectado",
  CONNECTED: "Conectado",
  TOKEN_EXPIRED: "Token expirado — reconexão necessária",
  ERROR: "Erro — reconexão necessária",
};

const STATUS_DESCRIPTIONS: Record<MarketplaceAccountDto["status"], string> = {
  DISCONNECTED: "Conexão OAuth segura com o Mercado Livre.",
  CONNECTED: "Conta conectada e pronta para uso.",
  TOKEN_EXPIRED: "A sessão expirou. Reconecte para continuar.",
  ERROR: "Houve um problema com esta conta. Reconecte para tentar novamente.",
};

function accountLabel(account: MarketplaceAccountDto): string {
  if (account.nickname) return account.nickname;
  if (account.externalSellerId) return `Conta ${account.externalSellerId}`;
  return `Conta ${account.id.slice(0, 8)}`;
}

function IntegracoesContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<MarketplaceAccountDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [connectingAccountIds, setConnectingAccountIds] = useState<Set<string>>(
    new Set(),
  );
  const [actionError, setActionError] = useState<string | null>(null);
  // Trava síncrona (useRef), não apenas o `useState` acima: uma atualização
  // de estado React não é garantida como visível a um segundo evento
  // disparado antes do próximo render — dois cliques reais no mesmo tick
  // podem, ambos, ler o mesmo `connectingAccountIds` "stale" e passar pelo
  // `if (...) return`. `useRef` é mutado de forma síncrona e imediata,
  // fechando essa janela por completo.
  const connectingRef = useRef<Set<string>>(new Set());
  const creatingRef = useRef(false);

  const loadAccounts = useCallback(async () => {
    try {
      const all = await fetchMarketplaceAccounts();
      setAccounts(all);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const ml = searchParams.get("ml");
  const reason = searchParams.get("reason");
  // Sucesso só quando AMBOS ml=success E reason=success (design §13) —
  // nunca inferido de um dos dois isoladamente.
  const bannerIsSuccess = ml === "success" && reason === "success";
  // Erro só quando AMBOS ml=error E reason está na lista pública conhecida
  // (REASON_MESSAGES) — um `reason` isolado (sem ml=error, ou combinado com
  // ml=success por um link malformado/manipulado) nunca deve, sozinho,
  // acionar o banner de erro.
  const bannerIsError =
    ml === "error" && reason !== null && Object.hasOwn(REASON_MESSAGES, reason);
  const bannerMessage = bannerIsSuccess
    ? "Conta do Mercado Livre conectada com sucesso."
    : bannerIsError
      ? REASON_MESSAGES[reason as string]
      : null;

  async function handleConnect(accountId: string) {
    if (connectingRef.current.has(accountId)) return; // impede clique duplo na MESMA conta (trava síncrona)
    connectingRef.current.add(accountId);
    setActionError(null);
    setConnectingAccountIds((prev) => new Set(prev).add(accountId));
    try {
      const { authorizationUrl } = await connectMercadoLivre(accountId);
      window.location.href = authorizationUrl;
    } catch {
      setActionError(
        "Não foi possível iniciar a conexão com o Mercado Livre. Tente novamente.",
      );
      connectingRef.current.delete(accountId);
      setConnectingAccountIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  }

  async function handleAddAccount() {
    if (creatingRef.current) return; // impede criar duas linhas por clique duplo (trava síncrona)
    creatingRef.current = true;
    setActionError(null);
    setCreatingAccount(true);
    try {
      const account = await createMarketplaceAccount("MERCADO_LIVRE");
      await loadAccounts();
      await handleConnect(account.id);
    } catch {
      setActionError("Não foi possível criar a nova conta. Tente novamente.");
    } finally {
      creatingRef.current = false;
      setCreatingAccount(false);
    }
  }

  const loading = accounts === null && !loadError;
  const mercadoLivreAccounts =
    accounts?.filter((a) => a.marketplace === "MERCADO_LIVRE") ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="mt-1 text-sm text-foreground/60">
          Conecte marketplaces à Central de Performance.
        </p>
      </div>

      {bannerMessage ? (
        <div
          role="status"
          className={`rounded-md border p-4 text-sm ${
            bannerIsSuccess
              ? "border-green-500/40 bg-green-500/10 text-green-700"
              : "border-red-500/40 bg-red-500/10 text-red-700"
          }`}
        >
          {bannerMessage}
        </div>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
        >
          {actionError}
        </div>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700"
        >
          Não foi possível carregar suas contas de marketplace. Tente novamente mais tarde.
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Mercado Livre</h2>
          {!loading && !loadError && mercadoLivreAccounts.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleAddAccount()}
              disabled={creatingAccount}
              className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creatingAccount ? "Adicionando..." : "Adicionar outra conta"}
            </button>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {loading ? (
            <p className="text-sm text-foreground/60">Carregando...</p>
          ) : loadError ? null : mercadoLivreAccounts.length === 0 ? (
            <MarketplaceCard
              card={{
                id: "mercado-livre-empty",
                name: "Mercado Livre",
                statusLabel: "Não conectado",
                description: STATUS_DESCRIPTIONS.DISCONNECTED,
                cta: {
                  label: "Conectar Mercado Livre",
                  disabled: creatingAccount,
                  onClick: () => void handleAddAccount(),
                },
              }}
            />
          ) : (
            mercadoLivreAccounts.map((account) => (
              <MarketplaceCard
                key={account.id}
                card={{
                  id: account.id,
                  name: `Mercado Livre — ${accountLabel(account)}`,
                  statusLabel: STATUS_LABELS[account.status],
                  description: STATUS_DESCRIPTIONS[account.status],
                  cta: {
                    label: account.status === "DISCONNECTED" ? "Conectar" : "Reconectar",
                    disabled: connectingAccountIds.has(account.id),
                    onClick: () => void handleConnect(account.id),
                  },
                }}
              />
            ))
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Outros marketplaces</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <MarketplaceCard
            card={{
              id: "amazon",
              name: "Amazon",
              statusLabel: "Disponível futuramente",
              description:
                "Integração planejada para uma etapa futura do roadmap multi-marketplace.",
            }}
          />
          <MarketplaceCard
            card={{
              id: "shopee",
              name: "Shopee",
              statusLabel: "Disponível futuramente",
              description:
                "Integração planejada para uma etapa futura do roadmap multi-marketplace.",
            }}
          />
        </div>
      </section>
    </div>
  );
}

export default function IntegracoesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-foreground/60">Carregando…</p>}>
      <IntegracoesContent />
    </Suspense>
  );
}
```

- [ ] **Step 7: Run it, confirm it passes**

Run: `cd frontend && npm test -- integracoes.test.tsx`
Expected: PASS (every test above).

- [ ] **Step 8: 🔍 Run the full frontend test suite, lint, and build (checkpoint — Next 16 may prerender this page; confirm `Suspense` around `useSearchParams` is sufficient)**

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: all PASS. If `npm run build` fails specifically on `/integracoes` prerendering, consult `frontend/node_modules/next/dist/docs/` (per `AGENTS.md`) for this Next version's current guidance on `useSearchParams` + static rendering before changing the approach.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/types/marketplace.ts frontend/src/lib/api.ts frontend/src/components/MarketplaceCard.tsx "frontend/src/app/(protegido)/integracoes/page.tsx" frontend/__tests__/integracoes.test.tsx
git commit -m "feat(oauth): wire /integracoes to real Mercado Livre account data and OAuth connect flow"
```

---

## Task 25: 🔍 HOMOLOGAÇÃO CHECKPOINT — full disposable-Postgres run, lint/typecheck/build, secret scan

This is the final gate before considering Fase 2 done (design §11). Nothing here should be new code — it's end-to-end verification of everything built in Tasks 1-24.

**Files:** none created/modified — verification only.

- [ ] **Step 1: Fresh disposable Postgres 16, full migration cycle**

```bash
docker stop ml-oauth-test-pg 2>/dev/null || true
docker rm ml-oauth-test-pg 2>/dev/null || true
docker run --rm -d --name ml-oauth-test-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ml_oauth_test -p 5433:5432 postgres:16
docker exec ml-oauth-test-pg pg_isready -U postgres
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/ml_oauth_test"

cd backend
DATABASE_URL="$TEST_DATABASE_URL" npm run migration:run
DATABASE_URL="$TEST_DATABASE_URL" npm run migration:revert
DATABASE_URL="$TEST_DATABASE_URL" npm run migration:run
```

Expected: all three commands succeed with no errors (proves the Task 5 migration is truly reversible against a completely fresh database, not just the one it was developed against).

- [ ] **Step 2: Full backend test suite against real Postgres — ONE run, proving both "all tests pass" and "no open handles" together (do not repeat the same full suite in a separate step just to re-check handles)**

```bash
cd backend
TEST_DATABASE_URL="$TEST_DATABASE_URL" \
CREDENTIAL_ENCRYPTION_KEY="3132333435363738393031323334353637383930313233343536373839303a" \
npx jest --detectOpenHandles --forceExit=false
```

Expected: every suite PASSES (unit + all real-Postgres suites — Tasks 12, 13, 15, 19, 20, 22 — now execute for real, since `TEST_DATABASE_URL` is set; none of them use `describe.skip`/an environment-conditional skip, per the fix in this review round — they fail loudly via `requireTestDatabaseUrl()` if the variable is missing, they never silently no-op), AND no "Jest has detected the following X open handle(s)" warning at the end of the run. If a handle leak appears, it is almost certainly a `DataSource`/`QueryRunner` not being closed in an `afterAll` — fix the offending spec file and re-run this single command before proceeding (do not add a second full-suite run to re-verify — this same command already covers both concerns).

No `.skip`/`.only`/`xdescribe`/`xit`/`xtest` anywhere, backend AND frontend — confirm with:

```bash
grep -rnE "\.skip\(|\.only\(|\bxdescribe\(|\bxit\(|\bxtest\(" backend/src frontend/src frontend/__tests__ --include="*.spec.ts" --include="*.test.ts" --include="*.test.tsx"
```

Expected: no output (the search itself must also not match this plan document's own code samples — only real spec/test files count, and this grep only looks inside the actual `backend/src`, `frontend/src`, and `frontend/__tests__` trees).

- [ ] **Step 3: Lint, typecheck, build — backend**

```bash
cd backend
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all PASS, zero errors.

- [ ] **Step 4: Lint, typecheck, build, and the full test suite — frontend**

```bash
cd frontend
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all PASS, zero errors (including every test from Task 24's multi-account rewrite, and the `xdescribe`/`xit`/`xtest`/`.skip`/`.only` sweep already run for this tree in Step 2).

- [ ] **Step 5: 🔍 Secret scan reaching tracked, staged, AND untracked files — WITHOUT ever printing a file's raw content, a matched line, or a matched value to the terminal/log**

`cat`-ing every untracked file indiscriminately is unsafe: if a real `.env` (or any other file holding a live secret) happens to be sitting untracked in the working directory, that command would print the actual secret straight into this session's output — exactly the kind of exposure this whole feature exists to prevent. Do not do that.

A blind "expect zero matches" for patterns like `ML_CLIENT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `APP_USR-`, or `TG-` is not achievable and must not be the bar: this plan's own test fixtures (Tasks 11, 13, 15, 19, 20, 22) deliberately reference these as **variable/config names** or **declared-fake token literals** (`APP_USR-new`, `TG-new`, the fixed 64-hex-char test `CREDENTIAL_ENCRYPTION_KEY` used throughout, `.env.example`'s documented variable names) — a variable or config-key **name** is not a secret by itself, only a **live value** is. The scan below is scoped to catch a real, unexpected secret VALUE landing somewhere unintended, not to flag every legitimate occurrence of a name or a fixture already declared fake.

**Allowlist (the only paths this scan may report as "known, not a finding" without stopping — explicit and narrow, NEVER a blanket "all test files" rule):**
- `backend/.env.example`, `frontend/.env.example` (documented variable names only, no real values, tracked in git).
- `backend/src/integrations/mercado-livre-oauth/**/*.spec.ts` (the literal fake fixtures `APP_USR-*`, `TG-*`, and the fixed test `CREDENTIAL_ENCRYPTION_KEY`/`ACCESS_TOKEN_SECRET` values defined in Tasks 11-22 above).
- `backend/src/config/env.validation.spec.ts` (Task 1's fake `ML_CLIENT_SECRET: 'app-secret'` / `CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64)` fixtures).
- `backend/src/common/logging/redact.util.spec.ts` (Task 6's fake `ML_CLIENT_SECRET: 'shh-secret'` / `CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64)` fixtures, used to prove redaction itself works).

Any match OUTSIDE this exact list of paths is a real finding and blocks Task 25 — no other file is pre-approved, no matter how plausible its name looks.

**Preferred — Gitleaks only, `--redact` mandatory, if available in the environment. TruffleHog is intentionally NOT part of this flow: `--only-verified` filters which findings are reported, it does not redact them — its own output can still contain a `Raw result` with the live secret value, which would defeat the entire point of this step. Do not add TruffleHog (or any tool) back into this flow unless its output is provably redacted end-to-end.**

```bash
if command -v gitleaks >/dev/null; then
  # gitleaks NUNCA roda sobre o diretório de trabalho real — que contém
  # `backend/.env` ignorado — nem sobre o histórico git completo. Um
  # diretório TEMPORÁRIO recebe apenas cópias dos arquivos elegíveis para
  # versionamento (tracked + staged + unstaged + untracked não ignorados,
  # cada um checado individualmente com `git check-ignore` antes da cópia),
  # preservando a estrutura de caminhos. `trap` garante a limpeza do
  # temporário mesmo se gitleaks ou qualquer comando acima falhar.
  SCAN_TMP_DIR=$(mktemp -d) || {
    echo "STOP: não foi possível criar o diretório temporário do scan." >&2
    exit 1
  }
  cleanup_scan_tmp() { rm -rf "$SCAN_TMP_DIR"; }
  trap cleanup_scan_tmp EXIT

  { git ls-files -z; git ls-files -z --others --exclude-standard; } \
    | tr '\0' '\n' | sort -u \
    | while IFS= read -r f; do
        [ -n "$f" ] && [ -f "$f" ] || continue
        git check-ignore -q -- "$f" && continue
        mkdir -p "$SCAN_TMP_DIR/$(dirname "$f")"
        cp -- "$f" "$SCAN_TMP_DIR/$f"
      done

  # A sintaxe do subcomando mudou entre versões do gitleaks (`dir` é mais
  # recente; `detect --no-git` é a forma anterior) — tenta a atual primeiro
  # e só cai para a legada se o próprio subcomando não existir nesta
  # instalação, nunca troca de sintaxe silenciosamente por outro motivo.
  # `--redact` é obrigatório em ambas as formas: o valor bruto do segredo
  # nunca deve chegar à saída, só arquivo/linha/regra/fingerprint.
  if gitleaks dir --help >/dev/null 2>&1; then
    gitleaks dir "$SCAN_TMP_DIR" --redact -v
  else
    gitleaks detect --source "$SCAN_TMP_DIR" --no-git --redact -v
  fi
  GITLEAKS_STATUS=$?

  cleanup_scan_tmp
  trap - EXIT

  # gitleaks: 0 = nenhum achado, 1 = achado(s) real(is) (bloqueante por si
  # só), qualquer outro código = o SCANNER falhou ao executar (flag
  # inválida, binário quebrado, etc.). Um `> 1` NUNCA pode ser tratado como
  # "nenhum achado" — isso mascararia uma varredura que nem chegou a rodar.
  if [ "$GITLEAKS_STATUS" -gt 1 ]; then
    echo "STOP: gitleaks não executou corretamente (exit $GITLEAKS_STATUS) — isto NÃO é 'sem achados', é falha do scanner. Corrija a instalação/invocação antes de prosseguir; nunca trate como sucesso silencioso." >&2
    exit 1
  fi
  if [ "$GITLEAKS_STATUS" -eq 1 ]; then
    echo "STOP: gitleaks encontrou possíveis segredos (saída acima já vem redigida via --redact) — revise cada achado fora da allowlist antes de prosseguir."
  fi
fi
```

Only file/line/rule/fingerprint is shown by `--redact` — the raw matched value never prints. Treat any finding outside the allowlist above as blocking. If `gitleaks` is available, it is REQUIRED to run with `--redact` — never invoke it without that flag, and never treat a non-zero exit beyond "1 = findings" as if it meant "clean."

**Fallback — no scanning tool available: list filenames, grep for a suspicious PATTERN reporting ONLY the file name (`-l`) and never the matched line/value, NUL-safe for paths containing spaces. The content pattern matches an actual ASSIGNED VALUE (`key = "..."` / `key: "..."`) or a token-shaped literal (`APP_USR-`/`TG-` followed by real characters) — never the bare variable/config-key NAME by itself, since `ML_CLIENT_SECRET`/`CREDENTIAL_ENCRYPTION_KEY` appear legitimately as identifiers throughout `env.validation.ts`, `ConfigService` calls, and Joi schemas outside any test file, and a bare-name match there would be a guaranteed false positive, not a leaked secret. Two defects, reproduced externally, are fixed below versus the previous version of this fallback:**
- **Falso positivo de regex:** o padrão anterior aceitava qualquer caractere logo após `:`/`=`, então `ML_CLIENT_SECRET: Joi.string()` — uma declaração de schema, não um valor — era relatado como achado. O novo padrão exige um valor plausível de verdade: um literal entre aspas com pelo menos 8 caracteres, OU um literal sem aspas de pelo menos 8 caracteres contíguos de palavra/traço logo após `:`/`=`. Isso exclui `Joi.string()` (`Joi` quebra no `.` depois de 3 caracteres), `process.env.CREDENTIAL_ENCRYPTION_KEY` (`process` quebra no `.` depois de 7) e `config.get('ML_CLIENT_SECRET')` (as aspas ali envolvem o NOME da chave, não um valor após `KEY:`/`KEY=`) — sem depender de nenhuma lista de exceções para essas formas seguras.
- **Status do `xargs` mascarando árvore limpa:** o pipeline anterior usava `xargs ... grep`; quando nenhum arquivo tinha achado, o `grep` interno retornava 1 ("nada encontrado") mas o GNU `xargs` traduzia isso para o código de saída 123, que o script então tratava como falha da ferramenta — uma varredura limpa era erroneamente bloqueada. O novo fluxo roda `grep` individualmente por arquivo, sem `xargs`, e interpreta cada código de saída no próprio Bash: `0` = achado (imprime só o nome do arquivo), `1` = arquivo limpo, `>1` = falha real e bloqueante daquele `grep`.

```bash
# 1. Full inventory — names only, covers tracked, staged, and untracked in one pass.
git status --short

# 2. Untracked file NAMES only (never their content), NUL-delimited so paths
#    with spaces survive intact.
git ls-files -z --others --exclude-standard | tr '\0' '\n'

# 3. Refuse to proceed on sight of a suspicious untracked filename — EXCLUDING
#    the allowlisted `.env.example` files above — inspect any other match
#    yourself, outside of this automated flow, never via a blind `cat` in a
#    shared/logged session:
git ls-files -z --others --exclude-standard \
  | tr '\0' '\n' \
  | grep -viE '(^|/)\.env\.example$' \
  | grep -iE '\.env($|\.[^.]+$)|\.pem$|\.key$|credentials|secret' \
  && echo "STOP: suspicious filename found above (not on the allowlist) — inspect it yourself before continuing, do not cat it here"

# 4. Content-level check, run PER FILE (no xargs), reporting ONLY the file
#    name on a finding — never the matched line/value. Covers every file
#    eligible for versioning — tracked, staged, unstaged-modified (read
#    from the working tree, so an edit not yet staged is still caught),
#    AND untracked-but-not-ignored. NUL-delimited end-to-end: the file list
#    is generated, sorted, and allowlist-filtered entirely with -z/--null-
#    data tools, and consumed by `while IFS= read -r -d ''` via process
#    substitution — no NUL-delimited output is ever assigned into a Bash
#    variable, so a filename containing a space (or any other byte except
#    NUL) survives intact. Any path `git check-ignore` reports as ignored
#    (e.g. `backend/.env`) is skipped WITHOUT ever being opened.
#
# The value pattern requires an actual ASSIGNED VALUE, not a bare name or a
# known-safe reference form:
#  - a quoted literal of at least 8 characters (`"..."` or `'...'`);
#  - an UNQUOTED literal of at least 8 contiguous word/dash characters
#    immediately after `:`/`=` — this alone excludes `Joi.string()` (`Joi`
#    breaks at its `.` after 3 chars), `process.env.CREDENTIAL_ENCRYPTION_KEY`
#    (`process` breaks at its `.` after 7 chars), and any `configService.get(
#    ...)`/`getOrThrow(...)` call for the same reason — none offers 8
#    contiguous chars of that class right after the colon/equals;
#  - `APP_USR-`/`TG-` followed by real characters.
# `config.get('ML_CLIENT_SECRET')` never matches either branch: the quote
# there wraps the KEY NAME itself, not a value following `KEY:`/`KEY=`.
SECRET_VALUE_PATTERN="(ML_CLIENT_SECRET|CREDENTIAL_ENCRYPTION_KEY)[[:space:]]*[:=][[:space:]]*([\"'][^\"']{8,}[\"']|[A-Za-z0-9_-]{8,})|APP_USR-[A-Za-z0-9]|TG-[A-Za-z0-9]"

SCAN_FAILED=0
FILES_SEEN=0

while IFS= read -r -d '' f; do
  FILES_SEEN=1
  [ -f "$f" ] || continue

  # Guarda literal, em profundidade, além de `git check-ignore`: um caso
  # extremo reproduzido (arquivo gitignorado forçado para a árvore com
  # `git add -f`) faz `git check-ignore` deixar de reportá-lo como
  # ignorado — este `case` nunca abre `backend/.env`/`frontend/.env` por
  # nome, independentemente do que `check-ignore` disser. Esse mesmo caso
  # extremo já é sinalizado separadamente pela checagem `.env` mais abaixo
  # ("NOT gitignored — stop and fix this").
  case "$f" in
    backend/.env|frontend/.env) continue ;;
  esac
  git check-ignore -q -- "$f" && continue

  grep -qliE "$SECRET_VALUE_PATTERN" -- "$f" >/dev/null 2>&1
  status=$?

  # grep POR ARQUIVO, sem xargs: 0 = achado NESTE arquivo (imprime só o
  # nome), 1 = arquivo limpo (segue normalmente), >1 = falha REAL da
  # ferramenta sobre ESTE arquivo — bloqueante, nunca "sem achados". Rodar
  # um grep por arquivo (em vez de `xargs -0 grep` sobre a lista inteira)
  # evita o defeito da versão anterior: GNU xargs traduz o código 1 do
  # grep interno ("nada encontrado") para 123 quando processa um lote de
  # argumentos, e o script então confundia isso com falha da ferramenta —
  # bloqueando uma árvore de fato limpa.
  if [ "$status" -eq 0 ]; then
    printf '%s\n' "$f"
  elif [ "$status" -gt 1 ]; then
    echo "STOP: grep falhou ao executar sobre '$f' (exit $status) — isto NÃO é 'sem achados', é falha da ferramenta. Corrija antes de prosseguir, nunca trate como sucesso silencioso." >&2
    SCAN_FAILED=1
    break
  fi
done < <(
  { git ls-files -z; git ls-files -z --others --exclude-standard; } \
    | sort -z -u \
    | grep -zvE '(^|/)\.env\.example$' \
    | grep -zvE 'integrations/mercado-livre-oauth/.*\.spec\.ts$' \
    | grep -zvE '^backend/src/config/env\.validation\.spec\.ts$' \
    | grep -zvE '^backend/src/common/logging/redact\.util\.spec\.ts$'
)

if [ "$SCAN_FAILED" -eq 1 ]; then
  exit 1
fi
if [ "$FILES_SEEN" -eq 0 ]; then
  echo "STOP: a listagem de arquivos elegíveis veio vazia — 'git ls-files' falhou ou não está numa árvore git; isto NÃO é 'sem achados', é falha da ferramenta de listagem." >&2
  exit 1
fi
```

Any filename reported by step 4 (i.e. a match outside the allowlist) is a stop condition — open and inspect that ONE named file yourself (not via a command whose output lands in this shared session) before proceeding; do not paste its content back into this flow.

**`.env` check — existence/gitignore status only, never content:**

```bash
test -f backend/.env && echo "backend/.env exists locally (expected to be gitignored — confirming, not reading it):"
git check-ignore backend/.env && echo "confirmed ignored" || echo "WARNING: backend/.env is NOT gitignored — stop and fix this before continuing"
```

Expected overall: no tool finding outside the allowlist, no suspicious filename outside the allowlist, no content match outside the allowlist, and `backend/.env` (if it exists at all) confirmed gitignored. Only source code, tests, docs, and `package-lock.json` changes are expected to be staged/untracked — no secret material anywhere.

- [ ] **Step 6: Stop the disposable database**

```bash
docker stop ml-oauth-test-pg
```

- [ ] **Step 7: Record the final state for the handoff report**

```bash
git status --short
git log --oneline -25
git rev-parse HEAD
```

Keep this output — it's what Task-25's completion report (end of this plan's execution) must quote back to the user.

- [ ] **Step 8: 🔍 Final checkpoint commit is a no-op if everything above is clean**

If Step 6 found nothing to fix, there is nothing new to commit here — Task 25 is verification-only. If any lint/type/build step above required a fix, make that fix now, re-run the relevant step, and commit it with a message describing exactly what was wrong (e.g. `fix(oauth): resolve lint warning in X surfaced during Fase 2 homologação`).

---


---

## Fim do Lote 4 — Fase 2 completa

Todas as 25 tarefas da Fase 2 (integração OAuth com Mercado Livre) estão implementadas e homologadas neste ponto. Não prossiga automaticamente para merge ou deploy — aguarde revisão/aprovação explícita.
