# Mercado Livre OAuth (Fase 2) — Lote 1 de 4: Tasks 1–6

> **Antes de começar, leia nesta ordem e SOMENTE isto:**
> 1. O design aprovado — [docs/superpowers/specs/2026-08-27-mercado-livre-oauth-design.md](../specs/2026-08-27-mercado-livre-oauth-design.md).
> 2. O índice mestre curto — [2026-08-27-mercado-livre-oauth-implementation-plan.md](2026-08-27-mercado-livre-oauth-implementation-plan.md) (objetivo, constraints globais, estratégia de execução, tabela de lotes).
> 3. Este arquivo — se esta sessão começa no Checkpoint 1 (Tasks 1–5), leia do início; se retoma no Checkpoint 2 (Task 6, já com Tasks 1–5 commitadas), localize `## Task 6:` neste arquivo e leia somente essa seção, sem reler as Tasks 1–5.
> 4. Os arquivos reais do código citados pela tarefa em execução, somente quando necessário para confirmar assinaturas/config existentes.
>
> Não releia os outros três lotes — eles não são pré-requisito de contexto para este.

**Pré-requisito:** Fase 1 já homologada em PostgreSQL 16 real (commits `4fceff5`/`c4f55d3` do histórico do repositório) e o design da Fase 2 já aprovado (commit `1126aaa`). Este é o primeiro lote de implementação — não há tarefa anterior deste plano para conferir.

**Sub-agentes:** não usar subagentes/agent teams por padrão para executar este lote. Use `superpowers:executing-plans`, tarefa por tarefa, sequencialmente, dentro desta sessão.

**Ao final deste lote:** a última tarefa (Task 6, 🔍 LOGS CHECKPOINT — que também cobre o 🔍 MIGRATION CHECKPOINT da Task 5 no meio do lote) é um ponto de parada. Pare ali e aguarde revisão externa antes de abrir uma nova sessão para o Lote 2.

---

## Task 1: Mercado Livre environment variables

**Files:**
- Modify: `backend/src/config/env.validation.ts`
- Create: `backend/src/config/mercado-livre-redirect-uri.validator.ts`
- Create: `backend/src/config/mercado-livre-redirect-uri.validator.spec.ts`
- Modify: `backend/src/config/env.validation.spec.ts`

**Interfaces:**
- Produces: `validateMercadoLivreRedirectUri(uri: string, nodeEnv: string): boolean` — used by later tasks to know the exact rule (pathname must be exactly `/integrations/mercado-livre/callback`; HTTPS required for every `nodeEnv` except `development`, where HTTP is also accepted; no query/fragment in any environment).
- Produces: env keys `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_HTTP_TIMEOUT_MS` (default 10000), `ML_OAUTH_PROCESSING_STALE_AFTER_MS` (default 120000), `ML_ACCOUNT_LOCK_WAIT_MS` (default 3000), `ML_TOKEN_REFRESH_LEEWAY_MS` (default 900000) — every later task reads these via `ConfigService`.

- [ ] **Step 1: Write the failing validator test**

```typescript
// backend/src/config/mercado-livre-redirect-uri.validator.spec.ts
import { validateMercadoLivreRedirectUri } from './mercado-livre-redirect-uri.validator';

describe('validateMercadoLivreRedirectUri', () => {
  it('accepts an HTTPS URL with no query/fragment in production', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback',
        'production',
      ),
    ).toBe(true);
  });

  it('rejects HTTP in production', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'http://api.example.com/integrations/mercado-livre/callback',
        'production',
      ),
    ).toBe(false);
  });

  it.each(['test', 'staging'])(
    'rejects HTTP in nodeEnv=%s (only "development" is allowed to use HTTP)',
    (nodeEnv) => {
      expect(
        validateMercadoLivreRedirectUri(
          'http://api.example.com/integrations/mercado-livre/callback',
          nodeEnv,
        ),
      ).toBe(false);
    },
  );

  it.each(['test', 'staging', 'production'])(
    'accepts HTTPS in nodeEnv=%s',
    (nodeEnv) => {
      expect(
        validateMercadoLivreRedirectUri(
          'https://api.example.com/integrations/mercado-livre/callback',
          nodeEnv,
        ),
      ).toBe(true);
    },
  );

  it('accepts HTTP only in development', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'http://localhost:3000/integrations/mercado-livre/callback',
        'development',
      ),
    ).toBe(true);
  });

  it('rejects a pathname different from the fixed backend callback path (design §5: "corresponder exatamente")', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/some/other/path',
        'production',
      ),
    ).toBe(false);
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback/',
        'production',
      ),
    ).toBe(false); // trailing slash also counts as a different pathname
  });

  it('rejects a URL with query string', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback?x=1',
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a URL with a fragment', () => {
    expect(
      validateMercadoLivreRedirectUri(
        'https://api.example.com/integrations/mercado-livre/callback#frag',
        'production',
      ),
    ).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(validateMercadoLivreRedirectUri('not-a-url', 'production')).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-redirect-uri.validator.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-redirect-uri.validator'`

- [ ] **Step 3: Implement the validator**

```typescript
// backend/src/config/mercado-livre-redirect-uri.validator.ts
/**
 * Regra de `ML_REDIRECT_URI` (design §5): pathname exatamente
 * `/integrations/mercado-livre/callback` (o caminho fixo do callback do
 * backend — Task 19's `MercadoLivreOAuthController.callback`); HTTPS
 * obrigatório em qualquer `nodeEnv` — HTTP só é aceito quando `nodeEnv` é
 * EXATAMENTE `'development'` (não `'test'`, não `'staging'`, não qualquer
 * outro valor); nunca query string nem fragmento, em nenhum ambiente.
 */
const REQUIRED_CALLBACK_PATHNAME = '/integrations/mercado-livre/callback';

export function validateMercadoLivreRedirectUri(
  uri: string,
  nodeEnv: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.pathname !== REQUIRED_CALLBACK_PATHNAME) return false;
  if (parsed.search.length > 0 || parsed.hash.length > 0) return false;

  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && nodeEnv === 'development';
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-redirect-uri.validator.spec.ts`
Expected: PASS (every `it`/`it.each` case above passes — count follows directly from the test file, don't hardcode a number here to track).

- [ ] **Step 5: Write the failing env-schema test**

Append to `backend/src/config/env.validation.spec.ts` (read the existing file first to match its exact test style before appending):

```typescript
  it('fails without ML_CLIENT_ID / ML_CLIENT_SECRET / ML_REDIRECT_URI', () => {
    const { error } = envValidationSchema.validate(
      {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://u:p@localhost:5432/db',
        ACCESS_TOKEN_SECRET: 'x'.repeat(32),
        CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
        FRONTEND_URL: 'https://app.example.com',
        COOKIE_SECURE: 'true',
      },
      { abortEarly: false },
    );

    const messages = error?.details.map((d) => d.message).join('\n') ?? '';
    expect(messages).toMatch(/ML_CLIENT_ID/);
    expect(messages).toMatch(/ML_CLIENT_SECRET/);
    expect(messages).toMatch(/ML_REDIRECT_URI/);
  });

  it('accepts valid Mercado Livre variables and applies defaults for timing configs', () => {
    const { error, value } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI: 'https://api.example.com/integrations/mercado-livre/callback',
    });

    expect(error).toBeUndefined();
    expect(value.ML_HTTP_TIMEOUT_MS).toBe(10000);
    expect(value.ML_OAUTH_PROCESSING_STALE_AFTER_MS).toBe(120000);
    expect(value.ML_ACCOUNT_LOCK_WAIT_MS).toBe(3000);
    expect(value.ML_TOKEN_REFRESH_LEEWAY_MS).toBe(900000);
  });

  it('rejects an ML_REDIRECT_URI with a query string in production', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI: 'https://api.example.com/integrations/mercado-livre/callback?x=1',
    });

    expect(error?.message).toMatch(/ML_REDIRECT_URI/);
  });

  it('rejects ML_OAUTH_PROCESSING_STALE_AFTER_MS smaller than the callback\'s worst-case duration (2x ML_HTTP_TIMEOUT_MS + ML_ACCOUNT_LOCK_WAIT_MS)', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI: 'https://api.example.com/integrations/mercado-livre/callback',
      ML_HTTP_TIMEOUT_MS: 10000,
      ML_ACCOUNT_LOCK_WAIT_MS: 3000,
      // Mínimo exigido: 2*10000 + 3000 + margem > 23000. 5000 é claramente insuficiente.
      ML_OAUTH_PROCESSING_STALE_AFTER_MS: 5000,
    });

    expect(error?.message).toMatch(/ML_OAUTH_PROCESSING_STALE_AFTER_MS/);
  });

  it('accepts the Task 5 defaults (10000/3000/120000) since 120000 comfortably exceeds 2*10000 + 3000', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'y'.repeat(64),
      FRONTEND_URL: 'https://app.example.com',
      COOKIE_SECURE: 'true',
      ML_CLIENT_ID: 'app-id',
      ML_CLIENT_SECRET: 'app-secret',
      ML_REDIRECT_URI: 'https://api.example.com/integrations/mercado-livre/callback',
    });

    expect(error).toBeUndefined();
  });
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd backend && npm test -- env.validation.spec.ts`
Expected: FAIL — unknown keys / no ML_* validation yet

- [ ] **Step 7: Implement the schema additions**

Add to `backend/src/config/env.validation.ts`, inside the `Joi.object({...})`, right after `CREDENTIAL_ENCRYPTION_KEY`:

```typescript
  // --- Mercado Livre OAuth (Fase 2) --------------------------------------
  // Segredos da aplicação ML cadastrada no DevCenter. Sem valor padrão.
  ML_CLIENT_ID: Joi.string().required(),
  ML_CLIENT_SECRET: Joi.string().required(),
  // Validado também pela regra de negócio (HTTPS em produção, sem
  // query/fragmento) em `mercado-livre-redirect-uri.validator.ts`.
  ML_REDIRECT_URI: Joi.string()
    .uri()
    .required()
    .custom((value: string, helpers) => {
      const nodeEnv = (helpers.state.ancestors[0] as { NODE_ENV?: string })
        .NODE_ENV as string;
      if (!validateMercadoLivreRedirectUri(value, nodeEnv ?? 'development')) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'ML_REDIRECT_URI business rule'),

  ML_HTTP_TIMEOUT_MS: Joi.number().integer().min(1).default(10000),
  ML_ACCOUNT_LOCK_WAIT_MS: Joi.number().integer().min(1).default(3000),
  ML_OAUTH_PROCESSING_STALE_AFTER_MS: Joi.number()
    .integer()
    .min(1)
    .default(120000)
    .custom((value: number, helpers) => {
      const ancestors = helpers.state.ancestors[0] as {
        ML_HTTP_TIMEOUT_MS?: number;
        ML_ACCOUNT_LOCK_WAIT_MS?: number;
      };
      const timeout = ancestors.ML_HTTP_TIMEOUT_MS ?? 10000;
      const lockWait = ancestors.ML_ACCOUNT_LOCK_WAIT_MS ?? 3000;
      const explicitSafetyMarginMs = 5000;
      // Duração combinada plausível do pior caso do callback: espera pelo
      // advisory lock + troca de code + /users/me, as duas últimas limitadas
      // por ML_HTTP_TIMEOUT_MS cada — design §5.
      const worstCasePlausibleDurationMs =
        lockWait + 2 * timeout + explicitSafetyMarginMs;
      if (value <= worstCasePlausibleDurationMs) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'ML_OAUTH_PROCESSING_STALE_AFTER_MS safety margin'),
  ML_TOKEN_REFRESH_LEEWAY_MS: Joi.number().integer().min(1).default(900000),
```

Add the import at the top of the file:

```typescript
import { validateMercadoLivreRedirectUri } from './mercado-livre-redirect-uri.validator';
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd backend && npm test -- env.validation.spec.ts mercado-livre-redirect-uri.validator.spec.ts`
Expected: PASS (all tests, including pre-existing ones in `env.validation.spec.ts`)

- [ ] **Step 9: Add placeholders (never real values) to `backend/.env.example`**

Append, matching the file's existing comment style:

```
# --- Mercado Livre OAuth (Fase 2) ------------------------------------------
# Segredos da aplicação cadastrada no DevCenter do Mercado Livre. Sem valor
# padrão — a aplicação falha ao subir sem eles.
ML_CLIENT_ID=troque-pelo-app-id-do-devcenter
ML_CLIENT_SECRET=troque-pelo-secret-key-do-devcenter
# Deve corresponder EXATAMENTE ao caminho fixo do callback do backend,
# incluído o domínio configurado no app do DevCenter. HTTPS obrigatório em
# qualquer ambiente exceto NODE_ENV=development (onde HTTP é aceito).
ML_REDIRECT_URI=https://api.example.com/integrations/mercado-livre/callback

# --- Timing operacional do OAuth (opcionais; possuem defaults sensatos) ---
# ML_HTTP_TIMEOUT_MS=10000
# ML_ACCOUNT_LOCK_WAIT_MS=3000
# ML_OAUTH_PROCESSING_STALE_AFTER_MS=120000
# ML_TOKEN_REFRESH_LEEWAY_MS=900000
```

Add `backend/.env.example` to this task's **Files** list (Modify).

- [ ] **Step 10: Commit**

```bash
git add backend/src/config/ backend/.env.example
git commit -m "feat(oauth): add Mercado Livre environment variables and redirect URI validator"
```

---

## Task 2: `failureCode` vocabulary, `OAuthAuthorizationRequestStatus` enum, public-reason mapper

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/oauth-authorization-request-status.enum.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-failure-code.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/callback-reason.mapper.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/callback-reason.mapper.spec.ts`

**Interfaces:**
- Produces: `enum OAuthAuthorizationRequestStatus { PENDING, PROCESSING, SUCCESS, FAILED, EXPIRED }`
- Produces: `type MercadoLivreOAuthFailureCode` (union of the 16 closed vocabulary strings, design §7) and `ML_OAUTH_FAILURE_CODES` (readonly array of the same).
- Produces: `type MercadoLivreOAuthPublicReason = 'success' | 'OAUTH_CALLBACK_INVALID' | 'AUTHORIZATION_DENIED' | 'IDENTITY_MISMATCH' | 'ACCOUNT_ALREADY_CONNECTED' | 'TRY_AGAIN_LATER'` and `mapFailureCodeToPublicReason(code: MercadoLivreOAuthFailureCode): MercadoLivreOAuthPublicReason`.

- [ ] **Step 1: Create the status enum (no test needed — it's a plain data declaration used by later tests)**

```typescript
// backend/src/integrations/mercado-livre-oauth/oauth-authorization-request-status.enum.ts
export enum OAuthAuthorizationRequestStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}
```

- [ ] **Step 2: Create the failure-code vocabulary (no test needed — plain data declaration; exhaustiveness of the mapper is tested in Step 3 below)**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-failure-code.ts
/**
 * Vocabulário fechado de failureCode (design §7). Toda escrita de
 * failureCode no sistema deve usar um destes valores — nunca uma string
 * livre com detalhe do provedor.
 */
export const ML_OAUTH_FAILURE_CODES = [
  'STATE_INVALID',
  'AUTHORIZATION_DENIED',
  'AUTHORIZATION_PROVIDER_ERROR',
  'ACCOUNT_BUSY',
  'CALLBACK_RESULT_UNKNOWN',
  'TOKEN_EXCHANGE_FAILED',
  'INVALID_TOKEN_RESPONSE',
  'IDENTITY_LOOKUP_FAILED',
  'IDENTITY_MISMATCH',
  'ACCOUNT_ALREADY_CONNECTED',
  'ACCOUNT_STATE_CONFLICT',
  'TOKEN_RESULT_NOT_COMMITTED',
  'REFRESH_RESULT_UNKNOWN',
  'REFRESH_TOKEN_REJECTED',
  'REFRESH_RESULT_NOT_COMMITTED',
  'CREDENTIAL_DECRYPTION_FAILED',
] as const;

export type MercadoLivreOAuthFailureCode = (typeof ML_OAUTH_FAILURE_CODES)[number];
```

- [ ] **Step 3: Write the failing mapper test**

```typescript
// backend/src/integrations/mercado-livre-oauth/callback-reason.mapper.spec.ts
import { ML_OAUTH_FAILURE_CODES } from './mercado-livre-oauth-failure-code';
import { mapFailureCodeToPublicReason } from './callback-reason.mapper';

describe('mapFailureCodeToPublicReason', () => {
  it('maps every failure code to a defined public reason (no throw, no undefined)', () => {
    for (const code of ML_OAUTH_FAILURE_CODES) {
      expect(typeof mapFailureCodeToPublicReason(code)).toBe('string');
    }
  });

  it.each([
    ['STATE_INVALID', 'OAUTH_CALLBACK_INVALID'],
    ['AUTHORIZATION_PROVIDER_ERROR', 'OAUTH_CALLBACK_INVALID'],
    ['AUTHORIZATION_DENIED', 'AUTHORIZATION_DENIED'],
    ['IDENTITY_MISMATCH', 'IDENTITY_MISMATCH'],
    ['ACCOUNT_ALREADY_CONNECTED', 'ACCOUNT_ALREADY_CONNECTED'],
    ['ACCOUNT_BUSY', 'TRY_AGAIN_LATER'],
    ['CALLBACK_RESULT_UNKNOWN', 'TRY_AGAIN_LATER'],
    ['TOKEN_EXCHANGE_FAILED', 'TRY_AGAIN_LATER'],
    ['IDENTITY_LOOKUP_FAILED', 'TRY_AGAIN_LATER'],
    ['INVALID_TOKEN_RESPONSE', 'TRY_AGAIN_LATER'],
    ['CREDENTIAL_DECRYPTION_FAILED', 'TRY_AGAIN_LATER'],
    ['ACCOUNT_STATE_CONFLICT', 'TRY_AGAIN_LATER'],
    ['TOKEN_RESULT_NOT_COMMITTED', 'TRY_AGAIN_LATER'],
  ] as const)('maps %s to %s (design §7 table)', (code, reason) => {
    expect(mapFailureCodeToPublicReason(code)).toBe(reason);
  });
});
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `cd backend && npm test -- callback-reason.mapper.spec.ts`
Expected: FAIL — `Cannot find module './callback-reason.mapper'`

- [ ] **Step 5: Implement the mapper**

```typescript
// backend/src/integrations/mercado-livre-oauth/callback-reason.mapper.ts
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';

export type MercadoLivreOAuthPublicReason =
  | 'success'
  | 'OAUTH_CALLBACK_INVALID'
  | 'AUTHORIZATION_DENIED'
  | 'IDENTITY_MISMATCH'
  | 'ACCOUNT_ALREADY_CONNECTED'
  | 'TRY_AGAIN_LATER';

/**
 * Mapeamento failureCode -> reason público (design §7). REFRESH_* nunca
 * chegam a este mapper (nunca aparecem no callback — ver design §7), mas
 * ganham um valor aqui só para manter o Record exaustivo no TypeScript.
 */
const REASON_BY_FAILURE_CODE: Record<
  MercadoLivreOAuthFailureCode,
  MercadoLivreOAuthPublicReason
> = {
  STATE_INVALID: 'OAUTH_CALLBACK_INVALID',
  AUTHORIZATION_PROVIDER_ERROR: 'OAUTH_CALLBACK_INVALID',
  AUTHORIZATION_DENIED: 'AUTHORIZATION_DENIED',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  ACCOUNT_ALREADY_CONNECTED: 'ACCOUNT_ALREADY_CONNECTED',
  ACCOUNT_BUSY: 'TRY_AGAIN_LATER',
  CALLBACK_RESULT_UNKNOWN: 'TRY_AGAIN_LATER',
  TOKEN_EXCHANGE_FAILED: 'TRY_AGAIN_LATER',
  IDENTITY_LOOKUP_FAILED: 'TRY_AGAIN_LATER',
  INVALID_TOKEN_RESPONSE: 'TRY_AGAIN_LATER',
  CREDENTIAL_DECRYPTION_FAILED: 'TRY_AGAIN_LATER',
  ACCOUNT_STATE_CONFLICT: 'TRY_AGAIN_LATER',
  TOKEN_RESULT_NOT_COMMITTED: 'TRY_AGAIN_LATER',
  REFRESH_RESULT_UNKNOWN: 'TRY_AGAIN_LATER',
  REFRESH_TOKEN_REJECTED: 'TRY_AGAIN_LATER',
  REFRESH_RESULT_NOT_COMMITTED: 'TRY_AGAIN_LATER',
};

export function mapFailureCodeToPublicReason(
  code: MercadoLivreOAuthFailureCode,
): MercadoLivreOAuthPublicReason {
  return REASON_BY_FAILURE_CODE[code];
}
```

- [ ] **Step 6: Run it, confirm it passes**

Run: `cd backend && npm test -- callback-reason.mapper.spec.ts`
Expected: PASS (14 tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/
git commit -m "feat(oauth): add failureCode vocabulary, status enum and public-reason mapper"
```

## Task 3: `MarketplaceAccount` entity — add `errorSummary`, `failureCode`, `connectedByUserId`, `tokenVersion`

**Files:**
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-account.entity.ts`
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.spec.ts`

**Interfaces:**
- Produces: `MarketplaceAccount.errorSummary: string | null`, `.failureCode: string | null`, `.connectedByUserId: string | null`, `.tokenVersion: number` — read/written by Tasks 15, 19, 20.

- [ ] **Step 1: Extend the existing fake repository's `create()` to prove the new fields default correctly**

In `marketplace-accounts.service.spec.ts`, update `FakeMarketplaceAccountRepository.create()` to also set the four new defaults, and add a new test:

```typescript
  it('creates a new account with the OAuth bookkeeping fields at their defaults', async () => {
    const account = await service.create({ marketplace: Marketplace.MERCADO_LIVRE });

    expect(account.errorSummary).toBeNull();
    expect(account.failureCode).toBeNull();
    expect(account.connectedByUserId).toBeNull();
    expect(account.tokenVersion).toBe(0);
  });
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- marketplace-accounts.service.spec.ts`
Expected: FAIL — `account.tokenVersion` is `undefined` (property doesn't exist on the entity/fake yet)

- [ ] **Step 3: Add the columns to the entity, and the defaults to the fake repository**

In `marketplace-account.entity.ts`, add after `lastSuccessfulSyncAt`:

```typescript
  @Column({ type: 'varchar', length: 500, nullable: true })
  errorSummary!: string | null;

  @Column({ type: 'varchar', nullable: true })
  failureCode!: string | null;

  @Column({ type: 'uuid', nullable: true })
  connectedByUserId!: string | null;

  @Column({ type: 'integer', default: 0 })
  tokenVersion!: number;
```

In `marketplace-accounts.service.spec.ts`, update `FakeMarketplaceAccountRepository.create()`'s returned object to also include:

```typescript
      errorSummary: null,
      failureCode: null,
      connectedByUserId: null,
      tokenVersion: 0,
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- marketplace-accounts.service.spec.ts`
Expected: PASS (5 tests, including the 4 pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/marketplace-accounts/
git commit -m "feat(oauth): add errorSummary/failureCode/connectedByUserId/tokenVersion to MarketplaceAccount"
```

---

## Task 4: `OAuthAuthorizationRequest` entity

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/oauth-authorization-request.entity.ts`

**Interfaces:**
- Consumes: `OAuthAuthorizationRequestStatus` (Task 2), `MercadoLivreOAuthFailureCode` (Task 2), `Marketplace` (existing `contracts/marketplace.enum.ts`).
- Produces: `class OAuthAuthorizationRequest` with `id, marketplaceAccountId, initiatedByUserId, marketplace, stateHash, encryptedCodeVerifier, status, failureCode, expiresAt, processingStartedAt, consumedAt, completedAt, createdAt` — consumed directly by Task 12's raw-SQL queries (typed as the row shape) and by TypeORM's entity metadata loader (glob-loaded automatically per `typeorm-options.factory.ts`).

This is a pure data-structure task (mirrors the existing `MarketplaceAccount`/`UserSession` entities) — no behavior to unit test yet. It's proven correct end-to-end by Task 5's migration column/index inspection and Task 12's integration tests.

- [ ] **Step 1: Create the entity**

```typescript
// backend/src/integrations/mercado-livre-oauth/oauth-authorization-request.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Marketplace } from '../contracts/marketplace.enum';
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';
import { OAuthAuthorizationRequestStatus } from './oauth-authorization-request-status.enum';

/**
 * Rastreia uma tentativa de conexão OAuth (design §4/§6). Todos os índices,
 * FKs e a migration ficam em
 * `database/migrations/1787900000000-mercado-livre-oauth.ts` (Task 5) — esta
 * classe só declara o mapeamento TypeORM, `synchronize` é sempre `false`.
 */
@Entity({ name: 'oauth_authorization_requests' })
export class OAuthAuthorizationRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  marketplaceAccountId!: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  initiatedByUserId!: string | null;

  @Column({ type: 'varchar' })
  marketplace!: Marketplace;

  @Column({ type: 'varchar', length: 64 })
  stateHash!: string;

  @Column({ type: 'text', nullable: true })
  encryptedCodeVerifier!: string | null;

  @Column({
    type: 'varchar',
    default: OAuthAuthorizationRequestStatus.PENDING,
  })
  status!: OAuthAuthorizationRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  failureCode!: MercadoLivreOAuthFailureCode | null;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processingStartedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 2: Confirm the project still type-checks and builds with the new entity wired into the glob loader**

Run: `cd backend && npx tsc --noEmit`
Expected: no new errors (the entity is standalone; nothing references it yet)

- [ ] **Step 3: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/oauth-authorization-request.entity.ts
git commit -m "feat(oauth): add OAuthAuthorizationRequest entity"
```

---

## Task 5: 🔍 MIGRATION CHECKPOINT — new isolated migration, validated against disposable PostgreSQL 16

**Files:**
- Create: `backend/src/database/migrations/1787900000000-mercado-livre-oauth.ts`
- Create: `backend/src/test-utils/require-test-database-url.ts`
- Create: `backend/src/test-utils/require-test-database-url.spec.ts`
- Create: `backend/src/test-utils/create-test-data-source.ts`

**Interfaces:**
- Produces: table `oauth_authorization_requests` and four new columns on `marketplace_accounts` (`error_summary`, `failure_code`, `connected_by_user_id`, `token_version`), exactly matching the entities from Tasks 3 and 4 — every later integration test (Tasks 12, 13, 15, 19, 20, 22) depends on this schema existing.
- Produces: `requireTestDatabaseUrl(): string` — throws a clear `Error` if `TEST_DATABASE_URL` is unset. Every real-Postgres spec file in this plan (Tasks 12, 13, 15, 19, 20, 22) calls this inside its own `beforeAll`, so a missing database **fails that suite loudly** — it never resolves to `describe.skip`/`.only`/any other silent no-op (design §9/§11 forbid this outright).
- Produces: `createTestDataSource(entities: EntityTarget<ObjectLiteral>[]): Promise<DataSource>` — the ONLY way any spec file in this plan opens a real-Postgres `DataSource`. Always wires `namingStrategy: new SnakeNamingStrategy()` (matching `typeorm-options.factory.ts` exactly — see `backend/src/database/typeorm-options.factory.ts`), `synchronize: false`, and `url: requireTestDatabaseUrl()`. Without this, a manually-constructed `new DataSource(...)` with no naming strategy lets `Repository<T>` silently try to read camelCase columns (`tokenExpiresAt`) that don't exist in the real snake_case schema (`token_expires_at`) — Tasks 12, 13, 15, 19, 20, 22 all call this instead of constructing `DataSource` inline.

- [ ] **Step 0: Write the failing helper test**

```typescript
// backend/src/test-utils/require-test-database-url.spec.ts
import { requireTestDatabaseUrl } from './require-test-database-url';

describe('requireTestDatabaseUrl', () => {
  const original = process.env.TEST_DATABASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = original;
  });

  it('returns the value when set', () => {
    process.env.TEST_DATABASE_URL = 'postgres://u:p@localhost:5433/db';
    expect(requireTestDatabaseUrl()).toBe('postgres://u:p@localhost:5433/db');
  });

  it('throws a clear error when unset (never silently skips)', () => {
    delete process.env.TEST_DATABASE_URL;
    expect(() => requireTestDatabaseUrl()).toThrow(/TEST_DATABASE_URL/);
  });
});
```

Run: `cd backend && npm test -- require-test-database-url.spec.ts` → FAIL (`Cannot find module`).

```typescript
// backend/src/test-utils/require-test-database-url.ts
/**
 * Toda suíte de teste que precisa de PostgreSQL 16 real chama isto dentro do
 * próprio `beforeAll` (nunca no escopo do módulo, para não rodar antes do
 * Jest terminar de configurar o ambiente). Uma `TEST_DATABASE_URL` ausente
 * FALHA a suíte com um erro claro — nunca `describe.skip`/`.only`/qualquer
 * outro no-op silencioso (design §9/§11).
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL não definida. Este arquivo de teste requer um PostgreSQL 16 descartável (ver Task 5) — nunca pule este teste, configure a variável antes de rodar a suíte.',
    );
  }
  return url;
}
```

Run again → PASS (2 tests). Commit together with this task's migration commit (Step 7 below already does `git add backend/src/database/migrations/...` — extend it to also `git add backend/src/test-utils/`).

- [ ] **Step 0b: Write the shared test-`DataSource` helper (item 3 of the second external review — every real-Postgres spec in Tasks 12, 13, 15, 19, 20, 22 uses this instead of a bare `new DataSource(...)`)**

```typescript
// backend/src/test-utils/create-test-data-source.ts
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { requireTestDatabaseUrl } from './require-test-database-url';

/**
 * Único ponto de criação de `DataSource` para testes reais neste plano.
 * Sem `namingStrategy: new SnakeNamingStrategy()` (a mesma usada em produção
 * — `backend/src/database/typeorm-options.factory.ts`), um
 * `Repository<MarketplaceAccount>` tentaria ler colunas camelCase
 * (`tokenExpiresAt`) que não existem no schema real em snake_case
 * (`token_expires_at`), retornando `undefined` silenciosamente em vez de
 * falhar. `synchronize` é sempre `false` — o schema vem só das migrations
 * reais (Task 5), nunca de `entities` sincronizadas.
 */
export async function createTestDataSource(
  entities: EntityTarget<ObjectLiteral>[],
): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: requireTestDatabaseUrl(),
    entities,
    synchronize: false,
    namingStrategy: new SnakeNamingStrategy(),
  });
  await dataSource.initialize();
  return dataSource;
}
```

Este arquivo não tem teste unitário dedicado — é puro fiação de configuração, provado indiretamente por toda suíte real que o usa (Tasks 12, 13, 15, 19, 20, 22), e em particular pelo teste de Task 15 que lê `token_expires_at`/`external_seller_id`/`token_version` via `Repository` (ver Task 15, Step 1).

**Start a disposable PostgreSQL 16 (used by this task and every "real Postgres" task below):**

```bash
docker run --rm -d --name ml-oauth-test-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ml_oauth_test \
  -p 5433:5432 \
  postgres:16
```

Wait for it to accept connections:

```bash
docker exec ml-oauth-test-pg pg_isready -U postgres
```

Expected: `accepting connections`. Then set (for this shell session, used by every subsequent `Run:` command in Tasks 5, 12, 13, 15, 19, 20, and 25):

```bash
export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5433/ml_oauth_test"
```

(On Windows PowerShell: `$env:TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5433/ml_oauth_test"`.)

- [ ] **Step 1: Apply the Fase 1 baseline schema to the disposable database**

```bash
cd backend
DATABASE_URL="$TEST_DATABASE_URL" npm run migration:run
```

Expected: `InitSchema1787837395713` reported as applied, no errors.

- [ ] **Step 2: Write the migration (this is the "test" for this task — see Steps 3-6 for verification)**

```typescript
// backend/src/database/migrations/1787900000000-mercado-livre-oauth.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2: tabela de tentativas OAuth do Mercado Livre e colunas de
 * bookkeeping em `marketplace_accounts` (design §4). Isolada da migration
 * inicial da Fase 1 — nunca a modifica.
 */
export class MercadoLivreOAuth1787900000000 implements MigrationInterface {
  name = 'MercadoLivreOAuth1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -----------------------------------------------------------------
    // marketplace_accounts: novas colunas
    // -----------------------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        ADD COLUMN "error_summary" varchar(500),
        ADD COLUMN "failure_code" varchar,
        ADD COLUMN "connected_by_user_id" uuid,
        ADD COLUMN "token_version" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        ADD CONSTRAINT "FK_marketplace_accounts_connected_by_user_id"
        FOREIGN KEY ("connected_by_user_id") REFERENCES "users" ("id")
        ON DELETE SET NULL
    `);

    // -----------------------------------------------------------------
    // oauth_authorization_requests
    // -----------------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "oauth_authorization_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "marketplace_account_id" uuid NOT NULL,
        "initiated_by_user_id" uuid,
        "marketplace" varchar NOT NULL,
        "state_hash" varchar(64) NOT NULL,
        "encrypted_code_verifier" text,
        "status" varchar NOT NULL DEFAULT 'PENDING',
        "failure_code" varchar,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "processing_started_at" TIMESTAMPTZ,
        "consumed_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_oauth_authorization_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_oauth_authorization_requests_marketplace_account_id"
          FOREIGN KEY ("marketplace_account_id")
          REFERENCES "marketplace_accounts" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_oauth_authorization_requests_initiated_by_user_id"
          FOREIGN KEY ("initiated_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_oauth_authorization_requests_state_hash"
        ON "oauth_authorization_requests" ("state_hash")
    `);
    // Índice único parcial: só uma tentativa PENDING/PROCESSING ativa por
    // conta — proteção final contra corrida em POST .../connect.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_oauth_authorization_requests_active_attempt"
        ON "oauth_authorization_requests" ("marketplace_account_id")
        WHERE "status" IN ('PENDING', 'PROCESSING')
    `);
    // Índices parciais SEPARADOS para PENDING vs PROCESSING (design §4 —
    // correção explícita: um único índice (status, expires_at) não serve
    // para localizar PROCESSING abandonadas, que usam processing_started_at).
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_pending_expiry"
        ON "oauth_authorization_requests" ("status", "expires_at")
        WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_processing_started"
        ON "oauth_authorization_requests" ("status", "processing_started_at")
        WHERE "status" = 'PROCESSING'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_marketplace_account_id"
        ON "oauth_authorization_requests" ("marketplace_account_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_oauth_authorization_requests_initiated_by_user_id"
        ON "oauth_authorization_requests" ("initiated_by_user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "oauth_authorization_requests"`,
    );
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        DROP CONSTRAINT IF EXISTS "FK_marketplace_accounts_connected_by_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "marketplace_accounts"
        DROP COLUMN IF EXISTS "error_summary",
        DROP COLUMN IF EXISTS "failure_code",
        DROP COLUMN IF EXISTS "connected_by_user_id",
        DROP COLUMN IF EXISTS "token_version"
    `);
  }
}
```

- [ ] **Step 3: Apply the new migration**

```bash
cd backend
DATABASE_URL="$TEST_DATABASE_URL" npm run migration:run
```

Expected: `MercadoLivreOAuth1787900000000` reported as applied, no errors.

- [ ] **Step 4: 🔍 Inspect the schema manually (this IS the checkpoint — do not skip)**

```bash
docker exec ml-oauth-test-pg psql -U postgres -d ml_oauth_test -c "\d oauth_authorization_requests"
docker exec ml-oauth-test-pg psql -U postgres -d ml_oauth_test -c "\d marketplace_accounts"
docker exec ml-oauth-test-pg psql -U postgres -d ml_oauth_test -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'oauth_authorization_requests' ORDER BY indexname;"
```

Verify by eye:
- `oauth_authorization_requests` has all **13 columns** (`id`, `marketplace_account_id`, `initiated_by_user_id`, `marketplace`, `state_hash`, `encrypted_code_verifier`, `status`, `failure_code`, `expires_at`, `processing_started_at`, `consumed_at`, `completed_at`, `created_at`) with the exact types from Task 4's entity.
- `marketplace_accounts` has the 4 new columns, `token_version` defaults to `0`.
- **7 indexes total on `oauth_authorization_requests`, including the PK**: the PK, `UQ_..._state_hash`, `UQ_..._active_attempt` (with a `WHERE` clause visible in `indexdef`), `IDX_..._pending_expiry` (with `WHERE status = 'PENDING'`), `IDX_..._processing_started` (with `WHERE status = 'PROCESSING'`), `IDX_..._marketplace_account_id`, `IDX_..._initiated_by_user_id` — confirm none are missing and none accidentally cover both PENDING and PROCESSING in one index.

- [ ] **Step 5: Revert, confirm clean rollback**

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run migration:revert
docker exec ml-oauth-test-pg psql -U postgres -d ml_oauth_test -c "\d marketplace_accounts" | grep -E "error_summary|failure_code|connected_by_user_id|token_version"
```

Expected: `migration:revert` succeeds with no errors; the `grep` finds nothing (columns gone).

- [ ] **Step 6: Reapply (this is the schema every later task's tests run against)**

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run migration:run
```

Expected: both migrations applied again, no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/database/migrations/1787900000000-mercado-livre-oauth.ts backend/src/test-utils/
git commit -m "feat(oauth): add mercado-livre-oauth migration (isolated from init-schema)"
```

---

## Task 6: 🔍 LOGS CHECKPOINT — fix `redact.util.ts` key categories, wire in a recursive string sanitizer, fix `LoggingInterceptor`'s raw query-string leak

**Files:**
- Create: `backend/src/common/logging/sanitize-string.util.ts`
- Create: `backend/src/common/logging/sanitize-string.util.spec.ts`
- Modify: `backend/src/common/logging/redact.util.ts`
- Modify: `backend/src/common/logging/redact.util.spec.ts` (only add new tests — do not remove the 5 existing tests, they must keep passing unchanged)
- Modify: `backend/src/common/logging/logging.interceptor.ts`
- Create: `backend/src/common/logging/logging.interceptor.spec.ts`

**Pre-check performed while writing this task (design §12's "confirmar durante a implementação" item, resolved now instead of deferred):** `LoggingInterceptor` currently logs `request.originalUrl ?? request.url` verbatim, unredacted, in two separate `Logger.log(...)` calls per request (start and completion) — it does **not** currently pass the URL through `redactSensitiveData` at all, only `body`/`headers`. This means `GET /integrations/mercado-livre/callback?state=...&code=...` (Task 19) would log the full raw query string, `code` and `state` included, in plain text on every single callback. This is fixed by this task, not deferred further — see Step 9 below.

**Interfaces:**
- Produces: `sanitizeSensitiveSubstrings(value: string): string` — called from INSIDE `redactValue`'s string-leaf handling (Step 7), so every string anywhere in a logged object is swept, not just values under a sensitive key. Not an optional add-on.
- Modifies (behavior only, same exported names): `redactSensitiveData`, `REDACTED_VALUE_PLACEHOLDER` in `redact.util.ts` — now uses exact-match + suffix key categories (design §8) instead of a single substring-fragment list (fixes the pre-existing bug where the bare `'token'` fragment silently matched `tokenVersion`), AND applies `sanitizeSensitiveSubstrings` to every string value during the recursive traversal.
- Modifies: `LoggingInterceptor.intercept` — logs only the request path (no query string) instead of `originalUrl`/`url` verbatim.

- [ ] **Step 1: Write the failing sanitizer tests first (this util has no dependents yet, so it's built and correct before anything wires into it)**

```typescript
// backend/src/common/logging/sanitize-string.util.spec.ts
import { sanitizeSensitiveSubstrings } from './sanitize-string.util';

describe('sanitizeSensitiveSubstrings', () => {
  it('masks a Bearer credential embedded in a string, without corrupting the rest of the string', () => {
    const input = 'Authorization: Bearer APP_USR-12345-abcde and nothing else';
    const result = sanitizeSensitiveSubstrings(input);

    expect(result).not.toContain('APP_USR-12345-abcde');
    expect(result).toContain('Authorization: Bearer');
    expect(result).toContain('and nothing else');
  });

  it('masks a code= value embedded in a full query-string URL (query/form URL-encoded style)', () => {
    const input =
      'https://api.example.com/integrations/mercado-livre/callback?state=xyz&code=TG-secret-code-value';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('TG-secret-code-value');
    expect(result).not.toContain('xyz');
  });

  it('masks a state= value embedded in a string', () => {
    const input = 'redirecting with state=abc123secretstate';
    expect(sanitizeSensitiveSubstrings(input)).not.toContain(
      'abc123secretstate',
    );
  });

  it('masks a client_secret= value and a code_verifier= value in a form-urlencoded body string', () => {
    const input =
      'grant_type=authorization_code&client_secret=super-secret-value&code_verifier=verifier-secret&code=xyz';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('super-secret-value');
    expect(result).not.toContain('verifier-secret');
    expect(result).not.toContain('xyz');
  });

  it('masks access_token= and refresh_token= values', () => {
    const input = 'access_token=APP_USR-abc&refresh_token=TG-xyz&token_type=bearer';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('APP_USR-abc');
    expect(result).not.toContain('TG-xyz');
    expect(result).toContain('token_type=bearer'); // não sensível, preservado
  });

  it('masks a JSON-like "code": "value" / "client_secret":"value" pair embedded in a logged string', () => {
    const input = '{"code":"json-secret-code","other":"kept","client_secret": "json-secret-value"}';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).not.toContain('json-secret-code');
    expect(result).not.toContain('json-secret-value');
    expect(result).toContain('"other":"kept"');
  });

  it('does not corrupt an unrelated key like "statusCode"/"failureCode"/"zipcode" appearing in free text', () => {
    const input = 'statusCode=409, failureCode=ACCOUNT_ALREADY_CONNECTED, zipcode=94105';
    const result = sanitizeSensitiveSubstrings(input);
    expect(result).toBe(input); // nada aqui corresponde a code=/state=/etc. isolados
  });

  it('leaves an ordinary string untouched', () => {
    expect(sanitizeSensitiveSubstrings('hello world')).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- sanitize-string.util.spec.ts`
Expected: FAIL — `Cannot find module './sanitize-string.util'`

- [ ] **Step 3: Implement the sanitizer**

```typescript
// backend/src/common/logging/sanitize-string.util.ts
const MASK = '***REDACTED***';

const SENSITIVE_FORM_KEYS =
  'code_verifier|client_secret|access_token|refresh_token|code|state';

/**
 * Sanitização de VALORES textuais (design §8) — complementar à redação por
 * nome de chave em `redact.util.ts`. Cobre o caso em que um segredo está
 * DENTRO de uma string maior (URL completa, mensagem de erro, corpo de
 * formulário, texto JSON-like), não isolado no valor de uma chave sensível
 * de um objeto. Cada padrão usa seu próprio `replace` com a assinatura de
 * callback correta para o número de grupos capturados — nunca reaproveita
 * um callback genérico entre padrões com formatos de captura diferentes
 * (essa mistura foi a causa de um bug anterior nesta função).
 */
export function sanitizeSensitiveSubstrings(value: string): string {
  let result = value;

  // "Bearer <token>" — sem grupo de captura, replace de string fixa.
  result = result.replace(/Bearer\s+\S+/gi, `Bearer ${MASK}`);

  // key=value (query string / form-urlencoded) — 1 grupo (a chave).
  result = result.replace(
    new RegExp(`\\b(${SENSITIVE_FORM_KEYS})=[^&\\s]+`, 'gi'),
    (_match, key: string) => `${key}=${MASK}`,
  );

  // "key": "value" (JSON-like texto solto) — 1 grupo (a chave), espaços
  // opcionais ao redor de `:` tolerados.
  result = result.replace(
    new RegExp(`"(${SENSITIVE_FORM_KEYS})"\\s*:\\s*"[^"]*"`, 'gi'),
    (_match, key: string) => `"${key}":"${MASK}"`,
  );

  return result;
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- sanitize-string.util.spec.ts`
Expected: PASS (all cases above)

- [ ] **Step 5: Write the failing `redact.util.spec.ts` tests — key categories AND proof that string values are swept during traversal**

Add to `backend/src/common/logging/redact.util.spec.ts`:

```typescript
  it('preserves failureCode, statusCode and tokenVersion (never over-redacted)', () => {
    const sample = {
      failureCode: 'ACCOUNT_ALREADY_CONNECTED',
      statusCode: 409,
      tokenVersion: 3,
    };

    const redacted = redactSensitiveData(sample) as typeof sample;

    expect(redacted.failureCode).toBe('ACCOUNT_ALREADY_CONNECTED');
    expect(redacted.statusCode).toBe(409);
    expect(redacted.tokenVersion).toBe(3);
  });

  it('redacts ML_CLIENT_SECRET, CREDENTIAL_ENCRYPTION_KEY, encryptedAccessToken and a nested refresh_token by key', () => {
    const sample = {
      ML_CLIENT_SECRET: 'shh-secret',
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
      encryptedAccessToken: 'iv:tag:cipher',
      nested: { deeply: { refresh_token: 'TG-123' } },
    };

    const redacted = redactSensitiveData(sample);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain('shh-secret');
    expect(serialized).not.toContain('a'.repeat(64));
    expect(serialized).not.toContain('iv:tag:cipher');
    expect(serialized).not.toContain('TG-123');
  });

  it('redacts bare "code" and "state" keys exactly, without touching "statusCode"-style keys', () => {
    const sample = { code: 'abc', state: 'xyz', statusCode: 200 };

    const redacted = redactSensitiveData(sample) as typeof sample;

    expect(redacted.code).toBe(REDACTED_VALUE_PLACEHOLDER);
    expect(redacted.state).toBe(REDACTED_VALUE_PLACEHOLDER);
    expect(redacted.statusCode).toBe(200);
  });

  it('sweeps a secret embedded INSIDE a string value that is not itself under a sensitive key (message/url/nested)', () => {
    const sample = {
      message: 'Callback failed for url https://api.example.com/cb?state=s1&code=c1',
      url: 'https://api.example.com/cb?client_secret=cs1&access_token=at1',
      nested: { deeply: { note: 'refresh_token=rt1 was rejected' } },
    };

    const redacted = redactSensitiveData(sample);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain('s1&');
    expect(serialized).not.toContain('c1');
    expect(serialized).not.toContain('cs1');
    expect(serialized).not.toContain('at1');
    expect(serialized).not.toContain('rt1');
  });
```

- [ ] **Step 6: Run it, confirm the new tests fail**

Run: `cd backend && npm test -- redact.util.spec.ts`
Expected: FAIL — `tokenVersion` currently gets redacted (the existing bare `'token'` substring fragment matches `tokenversion`), and the "sweeps a secret embedded inside a string value" test fails since nothing currently sanitizes string content.

- [ ] **Step 7: Rewrite `redact.util.ts` with exact-match + suffix key categories, wired to `sanitizeSensitiveSubstrings` for every string leaf (design §8)**

```typescript
// backend/src/common/logging/redact.util.ts
import { sanitizeSensitiveSubstrings } from './sanitize-string.util';

const MASK = '***REDACTED***';

/**
 * Categorias de chave sensível (design §8):
 * - Igualdade EXATA: nomes curtos e ambíguos demais para virar fragmento
 *   (ex.: "code"/"state"/"token" combinariam com "failureCode"/"statusCode"/
 *   "tokenVersion" se fossem fragmentos).
 * - Sufixo normalizado: cobre variações como ML_CLIENT_SECRET, someAccessToken.
 * - Fragmento (substring): só para chaves que nunca colidem com campos
 *   operacionais conhecidos do sistema.
 */
const EXACT_MATCH_KEYS = ['code', 'state', 'token'];

const SUFFIX_KEYS = [
  'codeverifier',
  'clientsecret',
  'authorizationcode',
  'accesstoken',
  'refreshtoken',
  'encryptionkey',
];

const SENSITIVE_KEY_FRAGMENTS = ['password', 'authorization', 'cookie'];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  if (EXACT_MATCH_KEYS.includes(normalized)) return true;
  if (SUFFIX_KEYS.some((suffix) => normalized.endsWith(suffix))) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment),
  );
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    // Sempre varrido, mesmo quando o valor não está sob uma chave sensível
    // (design §8: sanitização recursiva de valores textuais).
    return sanitizeSensitiveSubstrings(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? MASK : redactValue(val, seen);
    }
    return result;
  }

  return value;
}

/**
 * Mascara recursivamente, em qualquer objeto, os valores de chaves
 * sensíveis (por nome de chave) E o conteúdo de qualquer string (por
 * padrão de conteúdo, via `sanitizeSensitiveSubstrings`) — antes de
 * qualquer log. As duas camadas são complementares: uma chave sensível
 * mascara o valor inteiro; um valor não-sensível que contenha um segredo
 * embutido (ex.: uma URL completa) é sanitizado pelo conteúdo.
 */
export function redactSensitiveData<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

export { MASK as REDACTED_VALUE_PLACEHOLDER };
```

- [ ] **Step 8: Run it, confirm all `redact.util.spec.ts` tests pass**

Run: `cd backend && npm test -- redact.util.spec.ts`
Expected: PASS (the 5 pre-existing tests, unchanged, plus the 4 new ones from Step 5).

- [ ] **Step 9: Write the failing `LoggingInterceptor` test proving the callback's query string never leaks**

```typescript
// backend/src/common/logging/logging.interceptor.spec.ts
import { Logger } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

function fakeContext(originalUrl: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl,
        url: originalUrl,
        body: {},
        headers: {},
      }),
    }),
  } as unknown as ExecutionContext;
}

function fakeHandler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

describe('LoggingInterceptor', () => {
  it('never logs the raw query string of a Mercado Livre callback request (code/state must not appear anywhere)', (done) => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const interceptor = new LoggingInterceptor();
    const url =
      '/integrations/mercado-livre/callback?state=secret-state-value&code=secret-code-value';

    interceptor
      .intercept(fakeContext(url), fakeHandler())
      .subscribe(() => {
        const loggedText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');

        expect(loggedText).not.toContain('secret-state-value');
        expect(loggedText).not.toContain('secret-code-value');
        expect(loggedText).not.toContain('?state=');
        expect(loggedText).toContain('/integrations/mercado-livre/callback');

        logSpy.mockRestore();
        done();
      });
  });

  it('never logs code/state/Bearer token/client_secret in the error path either (error.message can carry them verbatim from a downstream throw)', (done) => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const interceptor = new LoggingInterceptor();
    const failingHandler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(
            new Error(
              'upstream call failed for state=secret-state-value&code=secret-code-value, ' +
                'Authorization: Bearer secret-bearer-token, client_secret=secret-client-value',
            ),
          );
        }),
    };

    interceptor
      .intercept(fakeContext('/integrations/mercado-livre/callback'), failingHandler)
      .subscribe({
        error: () => {
          const loggedText = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');

          expect(loggedText).not.toContain('secret-state-value');
          expect(loggedText).not.toContain('secret-code-value');
          expect(loggedText).not.toContain('secret-bearer-token');
          expect(loggedText).not.toContain('secret-client-value');
          expect(loggedText).toContain('/integrations/mercado-livre/callback falhou');

          errorSpy.mockRestore();
          done();
        },
      });
  });
});
```

- [ ] **Step 10: Run it, confirm it fails**

Run: `cd backend && npm test -- logging.interceptor.spec.ts`
Expected: FAIL — the current implementation logs `request.originalUrl` verbatim, including `?state=secret-state-value&code=secret-code-value` (first test), and interpolates `error.message` into the error log with no sanitization (second test).

- [ ] **Step 11: Fix `LoggingInterceptor` to log only the path (never the query string)**

```typescript
// backend/src/common/logging/logging.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { redactSensitiveData } from './redact.util';
import { sanitizeSensitiveSubstrings } from './sanitize-string.util';

/**
 * Loga método/caminho de cada requisição HTTP com o corpo e os headers
 * mascarados por `redactSensitiveData`, garantindo que segredos (senha,
 * tokens, Authorization, Cookie) nunca cheguem em texto puro aos logs.
 *
 * A QUERY STRING nunca é logada (design §8) — só o `pathname`. Isso é
 * essencial para o callback do Mercado Livre
 * (`GET /integrations/mercado-livre/callback?state=...&code=...`), cuja
 * query string carrega `code`/`state` diretamente.
 *
 * A mensagem de erro no caminho de falha também passa por
 * `sanitizeSensitiveSubstrings` antes de ser interpolada no log: uma
 * exceção lançada por dependências (ex.: erro HTTP do cliente Mercado
 * Livre, driver do Postgres) pode conter `code`/`state`/Bearer token/
 * `client_secret` no seu `message`, e isso não passaria por
 * `redactSensitiveData` (que só sanitiza objetos estruturados, não texto
 * livre) se fosse interpolado diretamente.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = this.safePath(request);
    const safeBody = redactSensitiveData(request.body as unknown);
    const safeHeaders = redactSensitiveData(request.headers as unknown);

    this.logger.log(
      `${request.method} ${path} ${JSON.stringify({
        body: safeBody,
        headers: safeHeaders,
      })}`,
    );

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(`${request.method} ${path} concluído`),
        error: (error: unknown) => {
          const rawMessage =
            error instanceof Error ? error.message : 'erro desconhecido';
          this.logger.error(
            `${request.method} ${path} falhou: ${sanitizeSensitiveSubstrings(rawMessage)}`,
          );
        },
      }),
    );
  }

  private safePath(request: Request): string {
    const raw = request.originalUrl ?? request.url;
    const queryIndex = raw.indexOf('?');
    return queryIndex === -1 ? raw : raw.slice(0, queryIndex);
  }
}
```

- [ ] **Step 12: Run it, confirm it passes, then run the full `common/logging` suite to confirm no regression**

Run: `cd backend && npm test -- logging.interceptor.spec.ts redact.util.spec.ts sanitize-string.util.spec.ts`
Expected: PASS (all three files, every test).

- [ ] **Step 13: 🔍 Commit (checkpoint — this is the last task before Batch 1 ends; pause for external review here)**

```bash
git add backend/src/common/logging/
git commit -m "fix(logs): exact/suffix key redaction, recursive string sanitizer wired into redactSensitiveData, LoggingInterceptor never logs query strings"
```


---

## Fim do Lote 1

Pare aqui. Não prossiga para a Task 7 nesta sessão — a Task 7 pertence ao Lote 2 (`2026-08-27-mercado-livre-oauth-batch-2.md`), que deve ser executado em uma sessão nova, lendo apenas o design aprovado, o índice mestre e o arquivo do Lote 2.
