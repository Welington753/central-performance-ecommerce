# Shopee Live E2E — código base (disconnect, type param, autosync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three code changes required before the real Shopee Live OAuth/sync validation can run: a safe `disconnect` capability for marketplace accounts, an optional `type` parameter on `ShopeeOrdersSyncService.syncOrders`, and Shopee dispatch inside `MarketplaceAutoSyncService`.

**Architecture:** All three changes extend existing, already-tested services in place — no new modules, no schema changes. `disconnect` follows the exact CAS-by-`token_version` pattern already used by `applySuccessfulConnection`/`markError`/`provisionCredentials` in `MarketplaceAccountsService`, and writes directly to `oauth_authorization_requests` via raw SQL in the same self-contained transaction (mirroring `ShopeeOAuthService.applyConnectionAndFinalizeAtomically`) instead of injecting `OAuthAuthorizationRequestsService`, which would create a circular module import (`mercado-livre-oauth.module.ts` already imports `MarketplaceAccountsModule`, and does not export that service). The `type` parameter on `ShopeeOrdersSyncService.syncOrders` mirrors the exact shape already used by `MercadoLivreOrdersSyncService.syncOrders`/`AmazonOrdersSyncService.syncOrders`. `MarketplaceAutoSyncService` gets a third dispatch branch identical in shape to the existing Mercado Livre/Amazon branches.

**Tech Stack:** NestJS, TypeORM (raw SQL via `DataSource`/`QueryRunner` for CAS writes, `Repository` for reads), PostgreSQL, Jest (real disposable Postgres for integration-style specs via `createTestDataSource`, in-memory mocks for orchestrator unit specs), supertest for HTTP-boundary specs.

**Spec:** `docs/superpowers/specs/2026-09-17-shopee-live-e2e-design.md`

## Global Constraints

- TDD: write the failing test before the implementation, for every step.
- Run only the targeted test file during implementation (`npm test -- <path>`); full suite/lint/build happens once, after all three tasks, at the final checkpoint.
- Controllers never touch TypeORM directly (`quality/no-direct-data-access` ESLint rule) — all DB access stays in services.
- Never log/print/return a token, Partner Key, or any other secret — this applies to every new log line and every new test assertion (assert absence, never print the value).
- `disconnect` must be idempotent and must never touch `external_seller_id`, `nickname`, `sync_runs`, `marketplace_orders`, or `marketplace_order_items`.
- No new npm dependencies.
- Small, coherent commits, one per task step group, only after that step's tests pass.

---

## Task 1: `MarketplaceAccountsService.disconnect` + `POST /marketplace-accounts/:id/disconnect`

**Files:**
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.ts`
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.controller.ts`
- Test: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.spec.ts`
- Test: `backend/src/integrations/marketplace-accounts/marketplace-accounts-http.integration.spec.ts`

**Interfaces:**
- Produces: `MarketplaceAccountsService.disconnect(id: string): Promise<MarketplaceAccount>` — idempotent; on a CONNECTED/TOKEN_EXPIRED/ERROR account, CAS-updates it to DISCONNECTED with tokens cleared and any PENDING `oauth_authorization_requests` row for that account failed; on an already-DISCONNECTED account, returns it unchanged without writing. Throws `NotFoundException` (via `findByIdOrFail`) when the id doesn't exist.
- Produces: `POST /marketplace-accounts/:id/disconnect` — 200, body is the same shape as `toMarketplaceAccountResponse(account)` (already used by `create`/`rename`), protected by `AccessTokenGuard` like every other route on this controller.

### Step 1: Write the failing service-level tests (real Postgres)

Open `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.spec.ts`. Find the `describe('MarketplaceAccountsService CAS methods (real Postgres)', ...)` block (it already has `dataSource`, `service`, `userId`, and a `seedAccount` helper — do not redefine them). Add these tests at the end of that `describe` block, right before its closing `});`:

```typescript
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

    const pendingId = 'pending-1';
    const processingId = 'processing-1';
    const otherPendingId = 'other-pending-1';
    await dataSource.query(
      `INSERT INTO oauth_authorization_requests
         (id, marketplace_account_id, initiated_by_user_id, marketplace, state_hash, status, expires_at)
       VALUES
         ($1, $4, $5, 'SHOPEE', 'hash-pending', 'PENDING', now() + interval '10 minutes'),
         ($2, $4, $5, 'SHOPEE', 'hash-processing', 'PROCESSING', now() + interval '10 minutes'),
         ($3, $6, $5, 'SHOPEE', 'hash-other', 'PENDING', now() + interval '10 minutes')`,
      [pendingId, processingId, otherPendingId, id, userId, otherId],
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

  it('disconnect throws NotFoundException for a non-existent account id', async () => {
    await expect(service.disconnect('00000000-0000-4000-8000-000000000000')).rejects.toThrow(
      /não encontrada/i,
    );
  });

  it('disconnect loses a concurrency race gracefully: a stale in-memory read never overwrites a newer concurrent write', async () => {
    const id = await seedAccount({ status: 'CONNECTED', tokenVersion: 0 });

    // Simula uma escrita concorrente que já avançou token_version (ex.: uma
    // renovação de token) ANTES que `disconnect` releia a conta.
    const originalFindByIdOrFail = service.findByIdOrFail.bind(service);
    jest.spyOn(service, 'findByIdOrFail').mockImplementationOnce(async (accId: string) => {
      const account = await originalFindByIdOrFail(accId);
      await dataSource.query(
        `UPDATE marketplace_accounts SET token_version = token_version + 1, updated_at = now() WHERE id = $1`,
        [accId],
      );
      return account;
    });

    // Não deve lançar: a implementação releva o CAS perdido e devolve o
    // estado atual em vez de propagar um erro genérico.
    const result = await service.disconnect(id);
    expect(result.id).toBe(id);

    jest.restoreAllMocks();
  });
```

**Files:**
- Test: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.spec.ts`

- [ ] **Step 1: Write the failing tests above** (paste the 6 `it(...)` blocks into the `describe('MarketplaceAccountsService CAS methods (real Postgres)', ...)` block).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- marketplace-accounts.service.spec.ts`
Expected: FAIL — `service.disconnect is not a function`.

- [ ] **Step 3: Implement `disconnect` in `marketplace-accounts.service.ts`**

Add this method to `MarketplaceAccountsService`, right after `findByMarketplaceAndExternalSellerId` (before `applySuccessfulConnection`):

```typescript
  /**
   * Desconecta uma conta com segurança (Checkpoint Shopee Live E2E) — nunca
   * um `UPDATE` manual: CAS por `token_version`, self-contained (mesmo
   * padrão de `applySuccessfulConnection` sem `QueryRunner` externo), numa
   * única transação que também invalida qualquer solicitação
   * `oauth_authorization_requests` ainda PENDING dessa conta (escrita direta
   * via SQL, não por injeção de `OAuthAuthorizationRequestsService` — isso
   * criaria import circular entre `MarketplaceAccountsModule` e
   * `mercado-livre-oauth.module.ts`, que já importa o primeiro; mesma
   * técnica já usada por `ShopeeOAuthService.applyConnectionAndFinalizeAtomically`
   * para cruzar essa mesma fronteira).
   *
   * Idempotente: numa conta já DISCONNECTED, devolve a conta sem escrever
   * nada (nunca re-incrementa `token_version`, nunca é tratado como erro).
   * Preserva integralmente `external_seller_id`/`nickname`/histórico de
   * `sync_runs`/`marketplace_orders`/`marketplace_order_items` — nenhum
   * deles é tocado por este método.
   *
   * Perde uma corrida de concorrência (`token_version` mudou entre a
   * releitura e o CAS) de forma NÃO destrutiva: relê e devolve o estado
   * atual em vez de lançar — a conta pode já ter sido desconectada ou
   * reconectada por outra operação concorrente, e nenhuma dessas
   * possibilidades justifica um erro aqui.
   */
  async disconnect(id: string): Promise<MarketplaceAccount> {
    const account = await this.findByIdOrFail(id);

    if (account.status === MarketplaceAccountStatus.DISCONNECTED) {
      return account;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const [rows] = (await queryRunner.query(
        `UPDATE marketplace_accounts
            SET status = 'DISCONNECTED',
                encrypted_access_token = NULL,
                encrypted_refresh_token = NULL,
                token_expires_at = NULL,
                error_summary = NULL,
                failure_code = NULL,
                token_version = token_version + 1,
                updated_at = now()
          WHERE id = $1 AND token_version = $2
          RETURNING id`,
        [account.id, account.tokenVersion],
      )) as [Array<{ id: string }>, number];

      if (rows.length > 0) {
        await queryRunner.query(
          `UPDATE oauth_authorization_requests
              SET status = 'FAILED', completed_at = now(), failure_code = 'ACCOUNT_DISCONNECTED',
                  encrypted_code_verifier = NULL
            WHERE marketplace_account_id = $1 AND status = 'PENDING'`,
          [account.id],
        );
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }

    return this.findByIdOrFail(id);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test -- marketplace-accounts.service.spec.ts`
Expected: PASS (all tests in the file, including the 6 new ones).

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/integrations/marketplace-accounts/marketplace-accounts.service.ts src/integrations/marketplace-accounts/marketplace-accounts.service.spec.ts
git commit -m "feat(marketplace-accounts): add disconnect (CAS, idempotent, invalidates pending OAuth requests)"
```

### Step 6: Write the failing HTTP-boundary test

Open `backend/src/integrations/marketplace-accounts/marketplace-accounts-http.integration.spec.ts`. It already has `app`, `dataSource`, `jwtService`, `accessTokenCookie()`, `selectPersistedRow(id)` set up in a `beforeAll`/`beforeEach` at the top of its `describe` block — reuse them, don't redefine. Add these tests right before the final closing `});` of the file:

```typescript
  it('disconnects a CONNECTED account: 200, DISCONNECTED, tokens nulled, externalSellerId preserved', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'SHOPEE' });
    const id = (createResponse.body as { id: string }).id;

    await dataSource.query(
      `UPDATE marketplace_accounts
          SET status = 'CONNECTED', external_seller_id = 'shop-999',
              encrypted_access_token = 'iv:tag:a', encrypted_refresh_token = 'iv:tag:r',
              token_expires_at = now() + interval '1 hour'
        WHERE id = $1`,
      [id],
    );

    const response = await request(app.getHttpServer())
      .post(`/marketplace-accounts/${id}/disconnect`)
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(200);
    const body = response.body as { id: string; status: string };
    expect(body.status).toBe('DISCONNECTED');

    const row = await selectPersistedRow(id);
    expect(row.status).toBe('DISCONNECTED');
    expect(row.encrypted_access_token).toBeNull();
    expect(row.encrypted_refresh_token).toBeNull();
    expect(row.token_expires_at).toBeNull();
    expect(row.external_seller_id).toBe('shop-999');
  });

  it('rejects disconnect with 401 when no session cookie is sent', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/marketplace-accounts')
      .set('Cookie', accessTokenCookie())
      .send({ marketplace: 'SHOPEE' });
    const id = (createResponse.body as { id: string }).id;

    const response = await request(app.getHttpServer()).post(
      `/marketplace-accounts/${id}/disconnect`,
    );

    expect(response.status).toBe(401);
  });

  it('returns 404 when disconnecting a non-existent account id', async () => {
    const response = await request(app.getHttpServer())
      .post('/marketplace-accounts/00000000-0000-4000-8000-000000000000/disconnect')
      .set('Cookie', accessTokenCookie());

    expect(response.status).toBe(404);
  });
```

**Files:**
- Test: `backend/src/integrations/marketplace-accounts/marketplace-accounts-http.integration.spec.ts`

- [ ] **Step 6: Write the failing tests above.**

- [ ] **Step 7: Run the tests to verify they fail**

Run: `cd backend && npm test -- marketplace-accounts-http.integration.spec.ts`
Expected: FAIL with 404 (route doesn't exist yet) on the first new test.

- [ ] **Step 8: Implement the controller endpoint**

In `backend/src/integrations/marketplace-accounts/marketplace-accounts.controller.ts`, add this method to `MarketplaceAccountsController`, right after `rename`:

```typescript
  @Post(':id/disconnect')
  async disconnect(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MarketplaceAccountResponseDto> {
    const account = await this.marketplaceAccountsService.disconnect(id);
    return toMarketplaceAccountResponse(account);
  }
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd backend && npm test -- marketplace-accounts-http.integration.spec.ts`
Expected: PASS.

- [ ] **Step 10: Run ESLint on the touched files**

Run: `cd backend && npx eslint src/integrations/marketplace-accounts/marketplace-accounts.controller.ts src/integrations/marketplace-accounts/marketplace-accounts.service.ts`
Expected: no errors (the controller only calls the service method — never touches TypeORM directly, satisfying `quality/no-direct-data-access`).

- [ ] **Step 11: Commit**

```bash
cd backend
git add src/integrations/marketplace-accounts/marketplace-accounts.controller.ts src/integrations/marketplace-accounts/marketplace-accounts-http.integration.spec.ts
git commit -m "feat(marketplace-accounts): add POST /marketplace-accounts/:id/disconnect"
```

---

## Task 2: `ShopeeOrdersSyncService.syncOrders` optional `type` parameter

**Files:**
- Modify: `backend/src/integrations/shopee-orders/shopee-orders-sync.service.ts`
- Test: `backend/src/integrations/shopee-orders/shopee-orders-sync.service.spec.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 (independent).
- Produces: `ShopeeOrdersSyncService.syncOrders(accountId: string, options?: { type?: SyncRunType }): Promise<ShopeeOrdersSyncSummary>` — when `options.type` is omitted, behavior is byte-for-byte identical to today (defaults to `SyncRunType.MANUAL` inside `beginSyncRun`, as it already does). Task 3 depends on this exact signature.

- [ ] **Step 1: Write the failing test**

Open `backend/src/integrations/shopee-orders/shopee-orders-sync.service.spec.ts`. It already has `buildService(...)` returning `{ service, marketplaceAccountsService, accessTokenService, client, persistence }` — reuse it. Add this test right after the `'sucesso com ZERO pedidos...'` test:

```typescript
  it('passes options.type through to beginSyncRun when provided, and omits it (default MANUAL) when not provided', async () => {
    const { service, persistence } = buildService();

    await service.syncOrders(ACCOUNT_ID, { type: 'INCREMENTAL' as never });

    expect(persistence.beginSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'INCREMENTAL' }),
    );
  });

  it('omits type from beginSyncRun input when syncOrders is called without options (manual sync, unchanged behavior)', async () => {
    const { service, persistence } = buildService();

    await service.syncOrders(ACCOUNT_ID);

    const call = persistence.beginSyncRun.mock.calls[0][0] as Record<string, unknown>;
    expect('type' in call).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- shopee-orders-sync.service.spec.ts`
Expected: FAIL — TypeScript error / assertion failure, `syncOrders` doesn't accept a second argument yet.

- [ ] **Step 3: Implement the optional parameter**

In `backend/src/integrations/shopee-orders/shopee-orders-sync.service.ts`, add the import (with the other imports at the top):

```typescript
import { SyncRunType } from '../../sync/sync-run.entity';
```

Change the `syncOrders` method signature (currently `async syncOrders(accountId: string): Promise<ShopeeOrdersSyncSummary> {`) to:

```typescript
  async syncOrders(
    accountId: string,
    options: { type?: SyncRunType } = {},
  ): Promise<ShopeeOrdersSyncSummary> {
```

Change the `beginSyncRun` call inside the method from:

```typescript
      syncRunId = await this.persistence.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: window.from,
        periodTo: window.to,
        startedAt,
      });
```

to:

```typescript
      syncRunId = await this.persistence.beginSyncRun({
        marketplaceAccountId: accountId,
        marketplace: Marketplace.SHOPEE,
        periodFrom: window.from,
        periodTo: window.to,
        startedAt,
        ...(options.type !== undefined ? { type: options.type } : {}),
      });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- shopee-orders-sync.service.spec.ts`
Expected: PASS (all tests in the file, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
cd backend
git add src/integrations/shopee-orders/shopee-orders-sync.service.ts src/integrations/shopee-orders/shopee-orders-sync.service.spec.ts
git commit -m "feat(shopee): accept optional SyncRunType in ShopeeOrdersSyncService.syncOrders"
```

---

## Task 3: `MarketplaceAutoSyncService` Shopee dispatch + module wiring

**Files:**
- Modify: `backend/src/integrations/marketplace-sync/marketplace-auto-sync.service.ts`
- Modify: `backend/src/integrations/marketplace-sync/marketplace-sync.module.ts`
- Test: `backend/src/integrations/marketplace-sync/marketplace-auto-sync.service.spec.ts`

**Interfaces:**
- Consumes: `ShopeeOrdersSyncService.syncOrders(accountId: string, options?: { type?: SyncRunType }): Promise<ShopeeOrdersSyncSummary>` (Task 2) and `ShopeeOrdersSyncError` (already exported from `./shopee-orders-sync-error` in `shopee-orders` — no change needed there).
- Produces: `MarketplaceAutoSyncService` now dispatches `Marketplace.SHOPEE` accounts; its constructor gains one new parameter, `shopeeSyncService: ShopeeOrdersSyncService`, appended last (after `advisoryLockService`) to keep every existing positional-argument test call valid without modification.

- [ ] **Step 1: Write the failing tests**

Open `backend/src/integrations/marketplace-sync/marketplace-auto-sync.service.spec.ts`.

First, replace the `buildOrchestrator` helper (it currently builds `mlSyncService`/`amazonSyncService`/`advisoryLockService` and constructs `new MarketplaceAutoSyncService(configService, marketplaceAccountsService, persistence, mlSyncService, amazonSyncService, advisoryLockService)`) with this version, which adds `shopeeSyncService`:

```typescript
function buildOrchestrator(
  overrides: {
    configValues?: Record<string, unknown>;
    marketplaceAccountsService?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
    mlSyncService?: Record<string, jest.Mock>;
    amazonSyncService?: Record<string, jest.Mock>;
    shopeeSyncService?: Record<string, jest.Mock>;
    advisoryLockService?: Record<string, jest.Mock>;
  } = {},
) {
  const marketplaceAccountsService = {
    findAll: jest.fn().mockResolvedValue([]),
    ...overrides.marketplaceAccountsService,
  };
  const persistence = {
    recoverStaleRunningRuns: jest.fn().mockResolvedValue(0),
    ...overrides.persistence,
  };
  const mlSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
    ...overrides.mlSyncService,
  };
  const amazonSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
    ...overrides.amazonSyncService,
  };
  const shopeeSyncService = {
    syncOrders: jest.fn().mockResolvedValue({ ordersFetched: 0 }),
    ...overrides.shopeeSyncService,
  };
  const advisoryLockService = {
    tryAcquire: jest
      .fn()
      .mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) }),
    ...overrides.advisoryLockService,
  };
  const configService = makeConfigService(overrides.configValues);

  const service = new MarketplaceAutoSyncService(
    configService,
    marketplaceAccountsService as never,
    persistence as never,
    mlSyncService as never,
    amazonSyncService as never,
    advisoryLockService as never,
    shopeeSyncService as never,
  );

  return {
    service,
    marketplaceAccountsService,
    persistence,
    mlSyncService,
    amazonSyncService,
    shopeeSyncService,
    advisoryLockService,
  };
}
```

Next, replace the existing test `'never throws for a marketplace without a connector yet (e.g. Shopee) — skips it'` (it is no longer true) with:

```typescript
    it('dispatches a CONNECTED Shopee account to ShopeeOrdersSyncService.syncOrders with type INCREMENTAL', async () => {
      const { service, shopeeSyncService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest
            .fn()
            .mockResolvedValue([account({ marketplace: Marketplace.SHOPEE })]),
        },
      });

      await expect(service.runCycle()).resolves.toBeUndefined();
      expect(shopeeSyncService.syncOrders).toHaveBeenCalledWith('acc-1', {
        type: 'INCREMENTAL',
      });
    });

    it('a Shopee sync failure is sanitized (ShopeeOrdersSyncError code extracted) and never stops other accounts', async () => {
      const { service, mlSyncService, shopeeSyncService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest.fn().mockResolvedValue([
            account({
              id: 'shopee-fails',
              marketplace: Marketplace.SHOPEE,
            }),
            account({ id: 'ml-ok', marketplace: Marketplace.MERCADO_LIVRE }),
          ]),
        },
        shopeeSyncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(new ShopeeOrdersSyncError('TEMPORARILY_UNAVAILABLE')),
        },
      });

      await expect(service.runCycle()).resolves.toBeUndefined();
      expect(mlSyncService.syncOrders).toHaveBeenCalledWith('ml-ok', {
        type: 'INCREMENTAL',
      });
    });

    it('a DISCONNECTED Shopee account is never dispatched to ShopeeOrdersSyncService', async () => {
      const { service, shopeeSyncService } = buildOrchestrator({
        marketplaceAccountsService: {
          findAll: jest.fn().mockResolvedValue([
            account({
              marketplace: Marketplace.SHOPEE,
              status: MarketplaceAccountStatus.DISCONNECTED,
            }),
          ]),
        },
      });

      await service.runCycle();

      expect(shopeeSyncService.syncOrders).not.toHaveBeenCalled();
    });
```

Finally, add the new import at the top of the file, alongside the existing `SyncOrdersError` import:

```typescript
import { ShopeeOrdersSyncError } from '../shopee-orders/shopee-orders-sync-error';
```

**Files:**
- Test: `backend/src/integrations/marketplace-sync/marketplace-auto-sync.service.spec.ts`

- [ ] **Step 1: Write the failing tests above** (helper replacement + 3 new tests replacing the old "Shopee is skipped" test + new import).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- marketplace-auto-sync.service.spec.ts`
Expected: FAIL — `MarketplaceAutoSyncService` constructor doesn't accept a 7th argument yet, and dispatch tests fail because Shopee is still skipped.

- [ ] **Step 3: Implement the Shopee dispatch branch**

In `backend/src/integrations/marketplace-sync/marketplace-auto-sync.service.ts`:

Add these two imports, alongside the existing ones:

```typescript
import { ShopeeOrdersSyncError } from '../shopee-orders/shopee-orders-sync-error';
import { ShopeeOrdersSyncService } from '../shopee-orders/shopee-orders-sync.service';
```

Change the constructor from:

```typescript
  constructor(
    private readonly configService: ConfigService,
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly persistence: MarketplaceOrdersPersistenceService,
    private readonly mlSyncService: MercadoLivreOrdersSyncService,
    private readonly amazonSyncService: AmazonOrdersSyncService,
    private readonly advisoryLockService: AdvisoryLockService,
  ) {}
```

to:

```typescript
  constructor(
    private readonly configService: ConfigService,
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly persistence: MarketplaceOrdersPersistenceService,
    private readonly mlSyncService: MercadoLivreOrdersSyncService,
    private readonly amazonSyncService: AmazonOrdersSyncService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly shopeeSyncService: ShopeeOrdersSyncService,
  ) {}
```

Change `syncOneAccount` from:

```typescript
  private async syncOneAccount(account: MarketplaceAccount): Promise<void> {
    try {
      if (account.marketplace === Marketplace.MERCADO_LIVRE) {
        await this.mlSyncService.syncOrders(account.id, {
          type: SyncRunType.INCREMENTAL,
        });
        return;
      }
      if (account.marketplace === Marketplace.AMAZON) {
        await this.amazonSyncService.syncOrders(
          account.id,
          {},
          { type: SyncRunType.INCREMENTAL },
        );
        return;
      }
      // Nenhum conector ainda para este marketplace (ex.: Shopee) — ignorado,
      // nunca tratado como falha.
      this.logger.log('marketplace_auto_sync_account_skipped', {
        accountId: account.id,
        marketplace: account.marketplace,
        reason: 'MARKETPLACE_NOT_SUPPORTED',
      });
    } catch (error) {
      // Nunca loga o erro bruto (poderia conter contexto sensível) — só o
      // código fechado já sanitizado de `SyncOrdersError`/`AmazonOrdersSyncError`,
      // ou o fallback genérico para qualquer outra exceção.
      const code =
        error instanceof SyncOrdersError ||
        error instanceof AmazonOrdersSyncError
          ? error.code
          : 'SYNC_FAILED';
      this.logger.warn('marketplace_auto_sync_account_failed', {
        accountId: account.id,
        marketplace: account.marketplace,
        code,
      });
    }
  }
```

to:

```typescript
  private async syncOneAccount(account: MarketplaceAccount): Promise<void> {
    try {
      if (account.marketplace === Marketplace.MERCADO_LIVRE) {
        await this.mlSyncService.syncOrders(account.id, {
          type: SyncRunType.INCREMENTAL,
        });
        return;
      }
      if (account.marketplace === Marketplace.AMAZON) {
        await this.amazonSyncService.syncOrders(
          account.id,
          {},
          { type: SyncRunType.INCREMENTAL },
        );
        return;
      }
      if (account.marketplace === Marketplace.SHOPEE) {
        await this.shopeeSyncService.syncOrders(account.id, {
          type: SyncRunType.INCREMENTAL,
        });
        return;
      }
      // Nenhum conector ainda para este marketplace — ignorado, nunca
      // tratado como falha.
      this.logger.log('marketplace_auto_sync_account_skipped', {
        accountId: account.id,
        marketplace: account.marketplace,
        reason: 'MARKETPLACE_NOT_SUPPORTED',
      });
    } catch (error) {
      // Nunca loga o erro bruto (poderia conter contexto sensível) — só o
      // código fechado já sanitizado de
      // `SyncOrdersError`/`AmazonOrdersSyncError`/`ShopeeOrdersSyncError`,
      // ou o fallback genérico para qualquer outra exceção.
      const code =
        error instanceof SyncOrdersError ||
        error instanceof AmazonOrdersSyncError ||
        error instanceof ShopeeOrdersSyncError
          ? error.code
          : 'SYNC_FAILED';
      this.logger.warn('marketplace_auto_sync_account_failed', {
        accountId: account.id,
        marketplace: account.marketplace,
        code,
      });
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test -- marketplace-auto-sync.service.spec.ts`
Expected: FAIL still — `ShopeeOrdersSyncError` constructor needs a valid code from its closed vocabulary. Confirm `'TEMPORARILY_UNAVAILABLE'` is a member of `ShopeeOrdersSyncErrorCode` (it is — same vocabulary used throughout `shopee-orders-sync-error.ts`, already exercised by `shopee-orders-sync.service.spec.ts`). If this step still fails for any other reason, inspect the failure output before changing anything else.

Run again: `cd backend && npm test -- marketplace-auto-sync.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire the module**

In `backend/src/integrations/marketplace-sync/marketplace-sync.module.ts`, add the import:

```typescript
import { ShopeeOrdersModule } from '../shopee-orders/shopee-orders.module';
```

Add `ShopeeOrdersModule` to the `imports` array (alongside `MercadoLivreOrdersModule`/`AmazonOrdersModule`):

```typescript
  imports: [
    MarketplaceAccountsModule,
    MarketplaceOrdersModule,
    MercadoLivreOrdersModule,
    AmazonOrdersModule,
    ShopeeOrdersModule,
    AuthModule,
    SyncModule,
  ],
```

(`ShopeeOrdersSyncService` is already exported from `ShopeeOrdersModule` — no change needed there, per `exports: [ShopeeOrdersSyncService]` already in that file.)

- [ ] **Step 6: Build the backend to confirm the module wiring compiles and resolves DI correctly**

Run: `cd backend && npm run build`
Expected: succeeds, no TypeScript errors, no unresolved-dependency errors from Nest's DI container.

- [ ] **Step 7: Run the full targeted test file one more time**

Run: `cd backend && npm test -- marketplace-auto-sync.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd backend
git add src/integrations/marketplace-sync/marketplace-auto-sync.service.ts src/integrations/marketplace-sync/marketplace-auto-sync.service.spec.ts src/integrations/marketplace-sync/marketplace-sync.module.ts
git commit -m "feat(marketplace-sync): dispatch Shopee accounts in MarketplaceAutoSyncService"
```

---

## Final checkpoint (after all 3 tasks)

- [ ] Run the full backend test suite: `cd backend && npm test`. Expected: PASS, no regressions in `mercado-livre-orders`, `amazon-orders`, `marketplace-sync`, `marketplace-accounts`, `shopee-*` suites.
- [ ] Run backend lint: `cd backend && npm run lint`. Expected: no errors (warnings from `quality/max-lines` only if a touched file crosses 350 lines — none of the three touched files are close to that threshold from these changes).
- [ ] Run backend build: `cd backend && npm run build`. Expected: succeeds.
- [ ] `git log --oneline -5` and `git status` — confirm 3 commits landed on `feat/shopee-live-e2e`, working tree otherwise clean (no `.env`, no `.zip`, no `.gitignore` change included).

Real Shopee Live OAuth/sync validation (spec sections "Fluxo operacional" steps 3 onward) starts only after this checkpoint passes, and pauses at the human actions already documented in the spec (Partner Key, redirect URI Partner Console confirmation, OAuth consent).
