# Mercado Livre OAuth (Fase 2) — Lote 2 de 4: Tasks 7–13

> **Antes de começar, leia nesta ordem e SOMENTE isto:**
> 1. O design aprovado — [docs/superpowers/specs/2026-08-27-mercado-livre-oauth-design.md](../specs/2026-08-27-mercado-livre-oauth-design.md).
> 2. O índice mestre curto — [2026-08-27-mercado-livre-oauth-implementation-plan.md](2026-08-27-mercado-livre-oauth-implementation-plan.md) (objetivo, constraints globais, estratégia de execução, tabela de lotes).
> 3. Este arquivo — se esta sessão começa no Checkpoint 3 (Tasks 7–11), leia do início; se retoma no Checkpoint 4 (Tasks 12–13, já com Tasks 7–11 commitadas), localize `## Task 12:` neste arquivo e leia a partir dali, sem reler as Tasks 7–11.
> 4. Os arquivos reais do código citados pela tarefa em execução, somente quando necessário para confirmar assinaturas/config existentes.
>
> Não releia os outros três lotes — eles não são pré-requisito de contexto para este.

**Pré-requisito:** Lote 1 (Tasks 1–6, [2026-08-27-mercado-livre-oauth-batch-1.md](2026-08-27-mercado-livre-oauth-batch-1.md)) já implementado, testado e commitado nesta branch. Não prossiga se o commit do Lote 1 não existir.

**Sub-agentes:** não usar subagentes/agent teams por padrão para executar este lote. Use `superpowers:executing-plans`, tarefa por tarefa, sequencialmente, dentro desta sessão.

**Ao final deste lote:** a última tarefa (Task 13) é um ponto de parada. Pare ali e aguarde revisão externa antes de abrir uma nova sessão para o Lote 3.

---

## Task 7: PKCE + state generation utility

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/pkce.util.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/pkce.util.spec.ts`

**Interfaces:**
- Produces: `generateState(): string`, `hashState(state: string): string`, `generatePkcePair(): { codeVerifier: string; codeChallenge: string }` — consumed by Task 12 (`OAuthAuthorizationRequestsService.createPending`).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/integrations/mercado-livre-oauth/pkce.util.spec.ts
import { createHash } from 'crypto';
import { generatePkcePair, generateState, hashState } from './pkce.util';

describe('pkce.util', () => {
  it('generateState returns a non-empty, sufficiently random, URL-safe string', () => {
    const a = generateState();
    const b = generateState();

    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashState is deterministic SHA-256 hex', () => {
    const state = 'fixed-state-value';
    expect(hashState(state)).toBe(
      createHash('sha256').update(state).digest('hex'),
    );
  });

  it('hashState never returns the plaintext state', () => {
    const state = generateState();
    expect(hashState(state)).not.toBe(state);
  });

  it('generatePkcePair returns a code_challenge that is SHA-256(code_verifier), base64url, never equal to the verifier', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();

    const expectedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    expect(codeChallenge).toBe(expectedChallenge);
    expect(codeChallenge).not.toBe(codeVerifier);
  });

  it('generatePkcePair produces different pairs on each call', () => {
    const first = generatePkcePair();
    const second = generatePkcePair();
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- pkce.util.spec.ts`
Expected: FAIL — `Cannot find module './pkce.util'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/pkce.util.ts
import { createHash, randomBytes } from 'crypto';

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

/** state: CSPRNG, codificado base64url (design §3: "Ser gerado com CSPRNG"). */
export function generateState(): string {
  return randomBytes(32).toString('base64url');
}

/** Nunca armazenamos o state em texto puro — só este hash (design §3). */
export function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/** PKCE S256 — nunca `plain` (design §2). */
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- pkce.util.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/pkce.util.ts backend/src/integrations/mercado-livre-oauth/pkce.util.spec.ts
git commit -m "feat(oauth): add PKCE S256 + state generation utility"
```

---

## Task 8: Advisory lock key derivation utility

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/advisory-lock.util.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/advisory-lock.util.spec.ts`

**Interfaces:**
- Produces: `deriveAdvisoryLockKey(accountId: string): bigint` — the exact algorithm from design §3 (namespaced SHA-256, first 8 bytes read big-endian, reinterpreted as a signed 64-bit integer). Consumed by Task 13 (`AdvisoryLockService`).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/integrations/mercado-livre-oauth/advisory-lock.util.spec.ts
import { createHash } from 'crypto';
import { deriveAdvisoryLockKey } from './advisory-lock.util';

describe('deriveAdvisoryLockKey', () => {
  it('is deterministic: same accountId always yields the same key', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(deriveAdvisoryLockKey(id)).toBe(deriveAdvisoryLockKey(id));
  });

  it('yields (very likely) different keys for different accountIds', () => {
    const a = deriveAdvisoryLockKey('11111111-1111-1111-1111-111111111111');
    const b = deriveAdvisoryLockKey('22222222-2222-2222-2222-222222222222');
    expect(a).not.toBe(b);
  });

  it('matches the documented algorithm: namespace + SHA-256 + first 8 bytes big-endian + signed 64-bit', () => {
    const id = '33333333-3333-3333-3333-333333333333';
    const digest = createHash('sha256')
      .update(`central-performance:mercado-livre:account:${id}`)
      .digest();
    const unsigned = digest.subarray(0, 8).readBigUInt64BE(0);
    const expected = BigInt.asIntN(64, unsigned);

    expect(deriveAdvisoryLockKey(id)).toBe(expected);
  });

  it('returns a value within the signed 64-bit range accepted by pg_advisory_lock(bigint)', () => {
    const key = deriveAdvisoryLockKey('44444444-4444-4444-4444-444444444444');
    expect(key).toBeGreaterThanOrEqual(-(2n ** 63n));
    expect(key).toBeLessThanOrEqual(2n ** 63n - 1n);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- advisory-lock.util.spec.ts`
Expected: FAIL — `Cannot find module './advisory-lock.util'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/advisory-lock.util.ts
import { createHash } from 'crypto';

const LOCK_KEY_NAMESPACE = 'central-performance:mercado-livre:account:';

/**
 * Chave bigint determinística para `pg_try_advisory_lock`/`pg_advisory_unlock`
 * (design §3). Byte order (big-endian) fixo por design — mesmo resultado em
 * qualquer instância/plataforma, independente da endianness do host.
 */
export function deriveAdvisoryLockKey(accountId: string): bigint {
  const digest = createHash('sha256')
    .update(LOCK_KEY_NAMESPACE + accountId)
    .digest();
  const unsigned = digest.subarray(0, 8).readBigUInt64BE(0);
  return BigInt.asIntN(64, unsigned);
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- advisory-lock.util.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/advisory-lock.util.ts backend/src/integrations/mercado-livre-oauth/advisory-lock.util.spec.ts
git commit -m "feat(oauth): add deterministic advisory lock key derivation"
```

---

## Task 9: `buildAuthorizationUrl` (pure URL construction, no HTTP)

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/build-authorization-url.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/build-authorization-url.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildAuthorizationUrl(input: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string` — consumed by Task 16 (`MercadoLivreOAuthService.startConnection`). This is the ONLY place `/authorization` is referenced — never called over HTTP by the backend (design §2/§9).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/integrations/mercado-livre-oauth/build-authorization-url.spec.ts
import { buildAuthorizationUrl } from './build-authorization-url';

describe('buildAuthorizationUrl', () => {
  it('builds a deterministic URL with all required parameters, S256 fixed', () => {
    const url = buildAuthorizationUrl({
      clientId: 'app-123',
      redirectUri: 'https://api.example.com/integrations/mercado-livre/callback',
      state: 'state-value-with-special-&-chars',
      codeChallenge: 'challenge-value',
    });

    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://auth.mercadolivre.com.br');
    expect(parsed.pathname).toBe('/authorization');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('app-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/integrations/mercado-livre/callback',
    );
    expect(parsed.searchParams.get('state')).toBe(
      'state-value-with-special-&-chars',
    );
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('never emits a plain code_challenge_method', () => {
    const url = buildAuthorizationUrl({
      clientId: 'a',
      redirectUri: 'https://x.example.com/cb',
      state: 's',
      codeChallenge: 'c',
    });
    expect(url).not.toContain('plain');
  });

  it('never emits a scope parameter (not documented — design §2)', () => {
    const url = buildAuthorizationUrl({
      clientId: 'a',
      redirectUri: 'https://x.example.com/cb',
      state: 's',
      codeChallenge: 'c',
    });
    expect(new URL(url).searchParams.has('scope')).toBe(false);
  });

  it('percent-encodes special characters correctly via the URL API', () => {
    const url = buildAuthorizationUrl({
      clientId: 'a',
      redirectUri: 'https://x.example.com/cb',
      state: 'a b&c',
      codeChallenge: 'c',
    });
    expect(new URL(url).searchParams.get('state')).toBe('a b&c');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- build-authorization-url.spec.ts`
Expected: FAIL — `Cannot find module './build-authorization-url'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/build-authorization-url.ts
export interface BuildAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

/**
 * Só MONTA a URL — o backend nunca faz uma chamada HTTP a `/authorization`
 * (design §2). PKCE sempre S256, `scope` nunca é enviado (não documentado).
 */
export function buildAuthorizationUrl(
  input: BuildAuthorizationUrlInput,
): string {
  const url = new URL('https://auth.mercadolivre.com.br/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- build-authorization-url.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/build-authorization-url.ts backend/src/integrations/mercado-livre-oauth/build-authorization-url.spec.ts
git commit -m "feat(oauth): add buildAuthorizationUrl (no HTTP call)"
```

---

## Task 10: Mercado Livre token response validator

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-token-response.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-token-response.spec.ts`

**Interfaces:**
- Produces: `interface MercadoLivreTokenResponse { accessToken, refreshToken, expiresInSeconds, userId, tokenType, scope }` and `validateTokenResponseBody(body: unknown): { valid: true; token: MercadoLivreTokenResponse } | { valid: false }` — consumed by Task 11 (`MercadoLivreHttpClient`).

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-token-response.spec.ts
import { validateTokenResponseBody } from './mercado-livre-token-response';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    access_token: 'APP_USR-123',
    refresh_token: 'TG-456',
    expires_in: 10800,
    user_id: 987654,
    token_type: 'bearer',
    scope: 'offline_access read',
    ...overrides,
  };
}

describe('validateTokenResponseBody', () => {
  it('accepts a well-formed response and maps snake_case to camelCase', () => {
    const result = validateTokenResponseBody(validBody());
    expect(result).toEqual({
      valid: true,
      token: {
        accessToken: 'APP_USR-123',
        refreshToken: 'TG-456',
        expiresInSeconds: 10800,
        userId: 987654,
        tokenType: 'bearer',
        scope: 'offline_access read',
      },
    });
  });

  it('accepts token_type in any case (Bearer, BEARER)', () => {
    expect(validateTokenResponseBody(validBody({ token_type: 'Bearer' })).valid).toBe(true);
    expect(validateTokenResponseBody(validBody({ token_type: 'BEARER' })).valid).toBe(true);
  });

  it.each(['access_token', 'refresh_token', 'user_id', 'expires_in', 'token_type', 'scope'])(
    'rejects a response missing %s',
    (field) => {
      const body = validBody();
      delete (body as Record<string, unknown>)[field];
      expect(validateTokenResponseBody(body).valid).toBe(false);
    },
  );

  it('rejects a token_type that is not bearer', () => {
    expect(validateTokenResponseBody(validBody({ token_type: 'mac' })).valid).toBe(false);
  });

  it('rejects a scope without "read"', () => {
    expect(validateTokenResponseBody(validBody({ scope: 'offline_access' })).valid).toBe(false);
  });

  it('rejects a scope containing "write" (privilégio mínimo)', () => {
    expect(
      validateTokenResponseBody(validBody({ scope: 'offline_access read write' })).valid,
    ).toBe(false);
  });

  it.each([0, -1, 'not-a-number', 86401, Number.MAX_SAFE_INTEGER + 1])(
    'rejects expires_in = %p (zero, negative, non-numeric, or above the 86400s defensive ceiling)',
    (expiresIn) => {
      expect(validateTokenResponseBody(validBody({ expires_in: expiresIn })).valid).toBe(false);
    },
  );

  it('accepts expires_in exactly at the 86400s ceiling', () => {
    expect(validateTokenResponseBody(validBody({ expires_in: 86400 })).valid).toBe(true);
  });

  it('rejects a non-object body', () => {
    expect(validateTokenResponseBody(null).valid).toBe(false);
    expect(validateTokenResponseBody('a string').valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-token-response.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-token-response'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-token-response.ts
export interface MercadoLivreTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  userId: number;
  tokenType: string;
  scope: string;
}

export type TokenResponseValidation =
  | { valid: true; token: MercadoLivreTokenResponse }
  | { valid: false };

/**
 * Teto interno DEFENSIVO (design §10) — não é a validade oficial do token do
 * ML (a doc é inconsistente: "6 horas" no texto vs. `expires_in: 10800` no
 * exemplo). Só protege contra resposta malformada/corrompida.
 */
const MAX_EXPIRES_IN_SECONDS = 86400;

export function validateTokenResponseBody(
  body: unknown,
): TokenResponseValidation {
  if (typeof body !== 'object' || body === null) return { valid: false };
  const raw = body as Record<string, unknown>;

  const accessToken = raw.access_token;
  const refreshToken = raw.refresh_token;
  const expiresIn = raw.expires_in;
  const userId = raw.user_id;
  const tokenType = raw.token_type;
  const scope = raw.scope;

  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { valid: false };
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    return { valid: false };
  }
  if (typeof userId !== 'number' || !Number.isFinite(userId)) {
    return { valid: false };
  }
  if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
    return { valid: false };
  }
  if (typeof scope !== 'string') return { valid: false };

  const normalizedScopes = scope.toLowerCase().split(' ').filter(Boolean);
  if (!normalizedScopes.includes('read')) return { valid: false };
  if (normalizedScopes.includes('write')) return { valid: false };

  if (
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn <= 0 ||
    expiresIn > MAX_EXPIRES_IN_SECONDS
  ) {
    return { valid: false };
  }

  return {
    valid: true,
    token: {
      accessToken,
      refreshToken,
      expiresInSeconds: expiresIn,
      userId,
      tokenType,
      scope,
    },
  };
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-token-response.spec.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/mercado-livre-token-response.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-token-response.spec.ts
git commit -m "feat(oauth): add Mercado Livre token response validator (token_type/scope/expires_in)"
```

---

## Task 11: `MercadoLivreHttpClient` — `/oauth/token` + `/users/me`, HTTP boundary mocked

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-http.client.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-http.client.spec.ts`
- Create: `backend/src/jest.setup.ts`
- Modify: `backend/package.json` (add `"setupFiles": ["<rootDir>/jest.setup.ts"]` to the `"jest"` config block — deliberately `setupFiles`, NOT `setupFilesAfterEnv`: `setupFiles` runs *before* any test/production file is imported by that worker, so the block below installs the guard before anything has a chance to capture a reference to the real `fetch` at import time. It does not use `beforeEach`/`afterEach`/`describe` — those testing-framework globals aren't installed yet at this stage — it does one plain, permanent assignment instead.)

**Interfaces:**
- Consumes: `validateTokenResponseBody` (Task 10), `ConfigService` (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `ML_HTTP_TIMEOUT_MS`).
- Produces: `export const ML_FETCH` — a Nest injection token (a `Symbol`, not a class or interface, since `typeof fetch` has no usable type identity for Nest's reflection-based DI: a plain constructor-default-value parameter (`fetchImpl: typeof fetch = fetch`) is invisible to Nest's container and would make it try to resolve a provider for the reflected `Function` type, failing at module compile time with "Nest can't resolve dependencies of MercadoLivreHttpClient (?, ConfigService)" the first time anything actually instantiates it via DI — this is fixed here, not deferred).
- Produces: `class MercadoLivreHttpClient` with `exchangeCode({ code, codeVerifier }): Promise<TokenExchangeOutcome>`, `refreshToken({ refreshToken }): Promise<TokenExchangeOutcome>`, `fetchIdentity(accessToken: string): Promise<IdentityLookupOutcome>`, where `TokenExchangeOutcome = { kind: 'success'; token: MercadoLivreTokenResponse } | { kind: 'definitive_error' } | { kind: 'client_configuration_error' } | { kind: 'unknown_result' } | { kind: 'invalid_response' }` and `IdentityLookupOutcome = { kind: 'success'; externalUserId: number } | { kind: 'failure' }`. `client_configuration_error` is a distinct outcome for a 4xx `invalid_client` — a misconfigured `client_id`/`client_secret` on OUR side, never proof that the presented `code`/`refresh_token` itself was rejected. Keeping it apart from `unknown_result` matters because the two callers (Task 19's callback, Task 20's refresh) need to react to it differently: Task 19 must still report `TOKEN_EXCHANGE_FAILED` (design §6.2 step 7 names `invalid_client` alongside `invalid_grant` as a definitive callback failure), while Task 20 must NEVER let it produce `TOKEN_EXPIRED` (a valid refresh token cannot be proven rejected by a client-credential misconfiguration) — it maps to `REFRESH_RESULT_UNKNOWN` there instead, same as `unknown_result`. This is the ONLY file in the module allowed to call `fetch` against `api.mercadolibre.com`. Consumed by Task 16 and Task 19/20. Task 23's `MercadoLivreOAuthModule` must provide `{ provide: ML_FETCH, useValue: fetch }` — without it, the module fails to compile (that failure is exactly the point: it's a real DI check, not a construct that can silently pass).
- Produces: `backend/src/jest.setup.ts` (new) — loaded via `setupFiles` (before any test/production file is imported), permanently replaces `global.fetch` with a function that throws, once, for the whole life of the worker — never restored. `MercadoLivreHttpClient` never touches `global.fetch` directly (it only ever uses whatever `ML_FETCH` provides), so this is a second, independent safety net: any test that forgets to mock the HTTP boundary and falls through to a real `fetch` call anywhere in the codebase fails loudly instead of silently reaching the network.

- [ ] **Step 1: Write the failing tests (HTTP boundary mocked via constructor-injected `fetch`)**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-http.client.spec.ts
import { ConfigService } from '@nestjs/config';
import { MercadoLivreHttpClient } from './mercado-livre-http.client';

function makeConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    ML_CLIENT_ID: 'app-id',
    ML_CLIENT_SECRET: 'app-secret',
    ML_REDIRECT_URI: 'https://api.example.com/integrations/mercado-livre/callback',
    ML_HTTP_TIMEOUT_MS: 50,
  };
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MercadoLivreHttpClient', () => {
  it('exchangeCode: returns success with the validated, camelCased token on a 200 with a valid body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: 'APP_USR-1',
        refresh_token: 'TG-1',
        expires_in: 10800,
        user_id: 42,
        token_type: 'bearer',
        scope: 'offline_access read',
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    const outcome = await client.exchangeCode({ code: 'c', codeVerifier: 'v' });

    expect(outcome).toEqual({
      kind: 'success',
      token: {
        accessToken: 'APP_USR-1',
        refreshToken: 'TG-1',
        expiresInSeconds: 10800,
        userId: 42,
        tokenType: 'bearer',
        scope: 'offline_access read',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('exchangeCode: maps a 4xx (e.g. invalid_grant) to definitive_error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'definitive_error',
    });
  });

  it('exchangeCode: maps a 5xx to unknown_result', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'internal' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'unknown_result',
    });
  });

  it('exchangeCode: maps a network/abort error to unknown_result, never retries', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'unknown_result',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exchangeCode: maps a 200 with a structurally incomplete body to invalid_response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, { access_token: 'x' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'invalid_response',
    });
  });

  it('exchangeCode: maps a 200 response whose body is not even valid JSON to invalid_response — NOT unknown_result (structurally invalid is a different case from an ambiguous/timeout result)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response('this is not json at all', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'invalid_response',
    });
  });

  it('exchangeCode: times out and resolves unknown_result when the request exceeds ML_HTTP_TIMEOUT_MS', async () => {
    const fetchImpl = jest.fn(
      (_url: string, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    const outcome = await client.exchangeCode({ code: 'c', codeVerifier: 'v' });
    expect(outcome).toEqual({ kind: 'unknown_result' });
  });

  it('exchangeCode: quando fetch() resolve rápido (headers já chegaram) mas response.json() trava, ML_HTTP_TIMEOUT_MS ainda aborta a leitura do corpo, e o resultado é unknown_result', async () => {
    // Simula um corpo cuja leitura trava DEPOIS que os headers já
    // resolveram — a promise de `json()` só rejeita quando o AbortSignal do
    // timeout dispara, nunca por conta própria. Prova que o timeout
    // continua ativo durante `response.json()`, não só durante o `fetch()`
    // (item 7 da segunda revisão). Determinístico: a rejeição é amarrada ao
    // evento `abort` do próprio signal usado pelo cliente, não a uma espera
    // arbitrária — só depende do `ML_HTTP_TIMEOUT_MS=50` já configurado por
    // `makeConfigService()`.
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = jest.fn((_url: string, options?: RequestInit) => {
      capturedSignal = options?.signal ?? undefined;
      const response = {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            capturedSignal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      } as unknown as Response;
      return Promise.resolve(response);
    });
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    const outcome = await client.exchangeCode({ code: 'c', codeVerifier: 'v' });
    expect(outcome).toEqual({ kind: 'unknown_result' });
  });

  it('exchangeCode: maps a 400 invalid_client to client_configuration_error — NEVER definitive_error (a misconfigured client_id/client_secret is not a rejection of the code itself), so the callback can still report TOKEN_EXCHANGE_FAILED per design §6.2 step 7', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'client_configuration_error',
    });
  });

  it('exchangeCode: maps a 408 to unknown_result, not definitive_error (the provider timed out, the code was never actually evaluated)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(408, { error: 'request_timeout' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'unknown_result',
    });
  });

  it('exchangeCode: maps a 429 to unknown_result, not definitive_error (rate limited, not rejected)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'too_many_requests' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toEqual({
      kind: 'unknown_result',
    });
  });

  it('refreshToken: sends grant_type=refresh_token and the refresh token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: 'APP_USR-2',
        refresh_token: 'TG-2',
        expires_in: 10800,
        user_id: 42,
        token_type: 'bearer',
        scope: 'offline_access read',
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    await client.refreshToken({ refreshToken: 'TG-old' });

    const [, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const sentBody = (options.body as URLSearchParams).toString();
    expect(sentBody).toContain('grant_type=refresh_token');
    expect(sentBody).toContain('refresh_token=TG-old');
  });

  it('refreshToken: maps a 400 invalid_grant to definitive_error (the refresh token itself was rejected)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'definitive_error',
    });
  });

  it('refreshToken: maps a 400 invalid_client to client_configuration_error — NEVER definitive_error (must not turn a valid refresh token into TOKEN_EXPIRED because our own client credentials are misconfigured); Task 20 treats this the same as unknown_result (REFRESH_RESULT_UNKNOWN), never TOKEN_EXPIRED', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'client_configuration_error',
    });
  });

  it('refreshToken: maps a 408 to unknown_result', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(408, { error: 'request_timeout' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'unknown_result',
    });
  });

  it('refreshToken: maps a 429 to unknown_result', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'too_many_requests' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'unknown_result',
    });
  });

  it('refreshToken: maps a 500 to unknown_result', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(500, { error: 'internal' }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'unknown_result',
    });
  });

  it('refreshToken: maps a network/timeout error to unknown_result', async () => {
    const fetchImpl = jest.fn(
      (_url: string, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'unknown_result',
    });
  });

  it('refreshToken: maps a 200 response with invalid JSON to invalid_response, not unknown_result', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response('this is not json at all', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.refreshToken({ refreshToken: 'TG-old' })).toEqual({
      kind: 'invalid_response',
    });
  });

  it('fetchIdentity: returns success with the numeric id from /users/me', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { id: 42 }));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.fetchIdentity('APP_USR-1')).toEqual({
      kind: 'success',
      externalUserId: 42,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.mercadolibre.com/users/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer APP_USR-1' },
      }),
    );
  });

  it('fetchIdentity: returns failure on a non-OK response or a malformed body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(401, {}));
    const client = new MercadoLivreHttpClient(makeConfigService(), fetchImpl);

    expect(await client.fetchIdentity('bad-token')).toEqual({ kind: 'failure' });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-http.client.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-http.client'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-http.client.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MercadoLivreTokenResponse,
  validateTokenResponseBody,
} from './mercado-livre-token-response';

export type TokenExchangeOutcome =
  | { kind: 'success'; token: MercadoLivreTokenResponse }
  | { kind: 'definitive_error' }
  | { kind: 'client_configuration_error' }
  | { kind: 'unknown_result' }
  | { kind: 'invalid_response' };

export type IdentityLookupOutcome =
  | { kind: 'success'; externalUserId: number }
  | { kind: 'failure' };

const TOKEN_ENDPOINT = 'https://api.mercadolibre.com/oauth/token';
const IDENTITY_ENDPOINT = 'https://api.mercadolibre.com/users/me';

/**
 * Token de injeção explícito para `fetch` (Task 23's `MercadoLivreOAuthModule`
 * provê `{ provide: ML_FETCH, useValue: fetch }`). NÃO usar um valor padrão
 * de parâmetro (`fetchImpl: typeof fetch = fetch`) — Nest ignora defaults de
 * JS na resolução de DI; sem um token/`@Inject` explícito, o container tenta
 * resolver o segundo parâmetro pelo tipo refletido (`Function`), não encontra
 * provider nenhum, e falha ao compilar o módulo com "Nest can't resolve
 * dependencies of MercadoLivreHttpClient (?, ConfigService)".
 */
export const ML_FETCH = Symbol('ML_FETCH');

/**
 * Único ponto do sistema que faz chamadas HTTP reais ao Mercado Livre
 * (`/oauth/token`, `/users/me`) — `/authorization` NUNCA é chamado por aqui
 * (design §2, ver `build-authorization-url.ts`). `fetchImpl` é injetado via
 * `ML_FETCH`, permitindo mock total na fronteira HTTP em todos os testes
 * (que continuam instanciando a classe diretamente com `new`, então o token
 * de DI não afeta a forma de testar — só a forma como o Nest resolve a
 * dependência em produção).
 */
@Injectable()
export class MercadoLivreHttpClient {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ML_FETCH) private readonly fetchImpl: typeof fetch,
  ) {}

  private get timeoutMs(): number {
    return this.configService.get<number>('ML_HTTP_TIMEOUT_MS', 10000);
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<TokenExchangeOutcome> {
    return this.postToken({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: this.configService.getOrThrow<string>('ML_REDIRECT_URI'),
    });
  }

  async refreshToken(input: {
    refreshToken: string;
  }): Promise<TokenExchangeOutcome> {
    return this.postToken({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    });
  }

  async fetchIdentity(accessToken: string): Promise<IdentityLookupOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(IDENTITY_ENDPOINT, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });

      if (!response.ok) return { kind: 'failure' };

      const body = (await response.json()) as Record<string, unknown>;
      if (typeof body.id !== 'number') return { kind: 'failure' };

      return { kind: 'success', externalUserId: body.id };
    } catch {
      // Cobre tanto falha de rede/timeout quanto corpo não-JSON — para
      // /users/me o design não distingue essas causas, ambas viram
      // IDENTITY_LOOKUP_FAILED no chamador (Task 19).
      return { kind: 'failure' };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postToken(
    params: Record<string, string>,
  ): Promise<TokenExchangeOutcome> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const body = new URLSearchParams({
      ...params,
      client_id: this.configService.getOrThrow<string>('ML_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('ML_CLIENT_SECRET'),
    });

    // O `clearTimeout` só roda no `finally` MAIS EXTERNO — o timeout cobre a
    // operação INTEIRA (fetch + leitura do corpo + validação), não só o
    // retorno dos headers do `fetch`. Uma versão anterior deste método
    // limpava o timer logo após o `fetch` resolver, antes de
    // `response.json()` terminar — um corpo lento a ler corria então sem
    // limite de tempo nenhum, apesar de `ML_HTTP_TIMEOUT_MS` existir. O
    // corpo/mensagem bruta do provedor NUNCA é logado nem armazenado em
    // nenhum ramo abaixo — só o campo `error` estruturado é inspecionado,
    // em memória, quando necessário para classificar o resultado.
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: controller.signal,
        });
      } catch {
        // Timeout (abort) ou falha de rede antes mesmo de haver resposta —
        // resultado DESCONHECIDO (design §6.2), nunca reenviado como
        // rejeição definitiva do code/refresh_token.
        return { kind: 'unknown_result' };
      }

      // 408 (timeout do lado do provedor) e 429 (rate limit) são falhas do
      // PROVEDOR, não uma rejeição do code/refresh_token apresentado —
      // sempre resultado desconhecido/transitório.
      if (response.status === 408 || response.status === 429) {
        return { kind: 'unknown_result' };
      }

      if (response.status >= 400 && response.status < 500) {
        // Só `invalid_grant` é uma rejeição DEFINITIVA do code/refresh_token
        // em si (design §7/§8: mapeia para TOKEN_EXCHANGE_FAILED no
        // callback, REFRESH_TOKEN_REJECTED/TOKEN_EXPIRED no refresh).
        //
        // `invalid_client` (client_id/client_secret mal configurados no
        // nosso lado) é um resultado ESTRUTURALMENTE DIFERENTE, nem
        // definitivo nem puramente desconhecido: o design §6.2 passo 7 o
        // cita ao lado de `invalid_grant` como falha definitiva de
        // callback (→ TOKEN_EXCHANGE_FAILED), mas no refresh (design §6.4)
        // ele NÃO prova que o refresh_token foi rejeitado — tratá-lo como
        // `definitive_error` ali faria um refresh_token perfeitamente
        // válido virar TOKEN_EXPIRED só porque a credencial do app está
        // errada, destruindo a conexão do usuário sem causa real no token
        // dele. Por isso ganha seu próprio `kind: 'client_configuration_error'`,
        // permitindo que cada chamador (Task 19 x Task 20) escolha o
        // mapeamento correto para o seu contexto, sem reintroduzir a
        // ambiguidade que `unknown_result` teria aqui.
        //
        // Qualquer outro código de erro 4xx, ou um corpo que nem chega a
        // ser JSON válido, permanece `unknown_result` — já aprovado no
        // design para timeout/5xx/resultado ambíguo.
        let errorCode: unknown;
        try {
          const errorBody = (await response.json()) as Record<string, unknown>;
          errorCode = errorBody.error;
        } catch {
          errorCode = undefined;
        }
        // Um abort (timeout) no meio da leitura deste corpo de erro não é
        // prova de corpo malformado — é a mesma condição "desconhecida" de
        // qualquer outro timeout, então tem prioridade sobre a falta de
        // `errorCode`.
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        if (errorCode === 'invalid_grant') return { kind: 'definitive_error' };
        if (errorCode === 'invalid_client') return { kind: 'client_configuration_error' };
        return { kind: 'unknown_result' };
      }

      if (!response.ok) {
        // 5xx e qualquer outro status não coberto acima.
        return { kind: 'unknown_result' };
      }

      // Um 200 cujo corpo não é JSON válido é estruturalmente inválido — não
      // ambíguo como um timeout — então vira invalid_response. A exceção é
      // um abort no meio desta leitura: aí a causa é o timeout, não um
      // corpo malformado, então continua sendo unknown_result.
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        if (controller.signal.aborted) return { kind: 'unknown_result' };
        return { kind: 'invalid_response' };
      }

      const validation = validateTokenResponseBody(json);
      if (!validation.valid) return { kind: 'invalid_response' };

      return { kind: 'success', token: validation.token };
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-http.client.spec.ts`
Expected: PASS (every case above, including the new unparseable-JSON test)

- [ ] **Step 5: Write the failing test proving the global network guard blocks a real, unmocked `fetch`**

```typescript
// backend/src/jest.setup.spec.ts
describe('jest.setup network guard', () => {
  it('throws when something calls the real global fetch without mocking it', () => {
    expect(() => global.fetch('https://api.mercadolibre.com/oauth/token')).toThrow(
      /rede real bloqueada/i,
    );
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd backend && npm test -- jest.setup.spec.ts`
Expected: FAIL — `backend/src/jest.setup.ts` doesn't exist yet, `global.fetch` still resolves to the real implementation (or `undefined`), so the guard isn't active.

- [ ] **Step 7: Implement the guard and wire it into the Jest config**

```typescript
// backend/src/jest.setup.ts
/**
 * Bloqueia qualquer chamada de rede real não mockada durante TODA a suíte
 * (design §9: "nenhum teste chegue a tocar a rede de verdade"). Rede de
 * segurança GERAL, independente de `MercadoLivreHttpClient`/`ML_FETCH` —
 * qualquer código que chame `fetch`/`global.fetch` diretamente sem mockar
 * cai aqui e falha alto, em vez de silenciosamente tentar uma chamada real.
 *
 * Carregado via `setupFiles` (NÃO `setupFilesAfterEnv`): `setupFiles` roda
 * antes da importação de qualquer arquivo de teste/produção daquele worker,
 * então nenhum módulo — incluindo `MercadoLivreOAuthModule` (Task 22), cujo
 * provider real usa `{ provide: ML_FETCH, useValue: fetch }` — consegue
 * capturar uma referência ao `fetch` real em tempo de import.
 *
 * O bloqueio é instalado UMA ÚNICA VEZ, no escopo do módulo, e NUNCA
 * restaurado (sem `afterEach`/`beforeEach`): um `afterEach` que devolvesse o
 * `fetch` real abriria uma janela real entre testes na qual uma chamada não
 * mockada teria sucesso de verdade. Todo teste que precisa da fronteira
 * HTTP usa exclusivamente seu próprio `ML_FETCH` injetado — nunca
 * `global.fetch` diretamente.
 */
global.fetch = (() => {
  throw new Error(
    'Chamada de rede real bloqueada nos testes — mocke a fronteira HTTP (ex.: forneça um `ML_FETCH` fake ao instanciar MercadoLivreHttpClient).',
  );
}) as typeof fetch;
```

Add to `backend/package.json`'s `"jest"` block:

```json
  "setupFiles": ["<rootDir>/jest.setup.ts"],
```

(insert it as a sibling of `"rootDir"`/`"testRegex"`, matching the existing key ordering style in that block. Do NOT use `setupFilesAfterEnv` here — see the comment above the guard for why.)

- [ ] **Step 8: Run it, confirm it passes, then run the whole `mercado-livre-oauth` test directory to confirm the guard doesn't break any already-mocked test**

Run: `cd backend && npm test -- jest.setup.spec.ts mercado-livre-http.client.spec.ts`
Expected: PASS — the guard test passes, and `MercadoLivreHttpClient`'s own tests are unaffected (they never touch `global.fetch`, only their own injected `fetchImpl` mock). Because the guard is installed once and never restored, `jest.setup.spec.ts`'s single test works regardless of test execution order within the file/worker — there is no "before the first `beforeEach`" gap to race against.

- [ ] **Step 9: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/mercado-livre-http.client.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-http.client.spec.ts backend/src/jest.setup.ts backend/src/jest.setup.spec.ts backend/package.json
git commit -m "feat(oauth): add MercadoLivreHttpClient with an explicit fetch DI token, split JSON-parse-failure into invalid_response, split invalid_client into client_configuration_error, block real network calls in tests"
```

## Task 12: `OAuthAuthorizationRequestsService` — real Postgres

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/oauth-authorization-requests.service.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/oauth-authorization-requests.service.spec.ts`

**Interfaces:**
- Consumes: `generateState`/`hashState`/`generatePkcePair` (Task 7), `EncryptionService` (existing), `OAuthAuthorizationRequest` entity (Task 4).
- Produces: `class OAuthAuthorizationRequestsService` with `createPending(input): Promise<{ id: string; state: string; codeChallenge: string }>` (throws `OAuthConnectionInProgressError`), `claimByState(state: string): Promise<OAuthAuthorizationRequest | null>`, `finalizeSuccess(id): Promise<boolean>`, `finalizeFailure(id, failureCode): Promise<boolean>`, `sweepExpiredPending(): Promise<number>`, `findStaleProcessingCandidates(cutoff): Promise<Array<{id, marketplaceAccountId}>>`, `failIfStillStaleProcessing(id, cutoff): Promise<boolean>` — consumed by Tasks 16, 19, 21.

This task requires the disposable Postgres from Task 5 (`TEST_DATABASE_URL` exported, both migrations applied). Each test truncates the tables it uses in a `beforeEach` to stay isolated.

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/integrations/mercado-livre-oauth/oauth-authorization-requests.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { OAuthAuthorizationRequest } from './oauth-authorization-request.entity';
import type { CreatedPendingRequest } from './oauth-authorization-requests.service';
import {
  OAuthAuthorizationRequestsService,
  OAuthConnectionInProgressError,
} from './oauth-authorization-requests.service';

describe('OAuthAuthorizationRequestsService (real Postgres)', () => {
  let dataSource: DataSource;
  let service: OAuthAuthorizationRequestsService;
  let accountId: string;
  let otherAccountId: string;
  let userId: string;

  beforeAll(async () => {
    dataSource = await createTestDataSource([OAuthAuthorizationRequest]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        OAuthAuthorizationRequestsService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: ConfigService,
          useValue: {
            get: (_key: string, fallback?: unknown) => fallback,
            getOrThrow: () => '3132333435363738393031323334353637383930313233343536373839303a'.slice(0, 64),
          },
        },
        EncryptionService,
      ],
    }).compile();

    service = moduleRef.get(OAuthAuthorizationRequestsService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // Ordem importa: oauth_authorization_requests referencia
    // marketplace_accounts e users por FK; marketplace_accounts referencia
    // users por FK — trunca na ordem inversa das dependências.
    await dataSource.query('TRUNCATE TABLE oauth_authorization_requests');
    await dataSource.query('TRUNCATE TABLE marketplace_accounts CASCADE');
    await dataSource.query('TRUNCATE TABLE users CASCADE');

    userId = randomUUID();
    await dataSource.query(
      `INSERT INTO users (id, name, email, password_hash, active) VALUES ($1, 'Test User', $2, 'x', true)`,
      [userId, `test-${userId}@example.com`],
    );

    accountId = randomUUID();
    otherAccountId = randomUUID();
    await dataSource.query(
      `INSERT INTO marketplace_accounts (id, marketplace, status) VALUES ($1, 'MERCADO_LIVRE', 'DISCONNECTED'), ($2, 'MERCADO_LIVRE', 'DISCONNECTED')`,
      [accountId, otherAccountId],
    );
  });

  it('createPending inserts a PENDING row and returns a usable state + codeChallenge', async () => {
    const result = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    expect(result.state.length).toBeGreaterThan(0);
    expect(result.codeChallenge.length).toBeGreaterThan(0);

    const rows = await dataSource.query(
      'SELECT status, encrypted_code_verifier FROM oauth_authorization_requests WHERE id = $1',
      [result.id],
    );
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].encrypted_code_verifier).not.toBeNull();
  });

  it('createPending expires a previous PENDING attempt for the same account', async () => {
    const first = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    const rows = await dataSource.query(
      'SELECT status, encrypted_code_verifier FROM oauth_authorization_requests WHERE id = $1',
      [first.id],
    );
    expect(rows[0].status).toBe('EXPIRED');
    expect(rows[0].encrypted_code_verifier).toBeNull();
  });

  it('createPending rejects with OAuthConnectionInProgressError when a PROCESSING attempt already exists', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(pending.state);

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBeInstanceOf(OAuthConnectionInProgressError);
  });

  it('createPending: two truly concurrent calls for the same account — exactly one wins, the other gets OAuthConnectionInProgressError, no PROCESSING attempt is ever expired', async () => {
    const results = await Promise.allSettled([
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<CreatedPendingRequest> =>
        r.status === 'fulfilled',
    );
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(OAuthConnectionInProgressError);

    const rows = await dataSource.query(
      `SELECT status FROM oauth_authorization_requests WHERE marketplace_account_id = $1`,
      [accountId],
    );
    // A tentativa vencedora fica PENDING (nenhuma das duas chamou
    // claimByState) — nenhuma linha pode ficar EXPIRED, pois isso só
    // aconteceria se a corrida tivesse gerado duas linhas PENDING.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
  });

  it('createPending: a unique violation on a DIFFERENT constraint (state_hash, not the active-attempt index) is never swallowed into OAuthConnectionInProgressError, and still rolls back + releases exactly once', async () => {
    // Prova que `isActiveAttemptConflict` diferencia por nome de constraint,
    // não apenas por SQLSTATE `23505` — uma colisão de `state_hash`
    // (criptograficamente quase impossível, mas testável por injeção) é um
    // erro real e deve propagar como tal, nunca virar
    // `OAuthConnectionInProgressError` (item 7 da revisão). Também confirma
    // que o rollback + release do QueryRunner acontecem mesmo neste caminho
    // de erro "não tratado" (item 5).
    const queryFailedError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "UQ_oauth_authorization_requests_state_hash"',
      ),
      {
        code: '23505',
        constraint: 'UQ_oauth_authorization_requests_state_hash',
      },
    );

    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([]) // SELECT ... status = 'PROCESSING' -> nenhuma
        .mockResolvedValueOnce(undefined) // UPDATE ... status = 'EXPIRED' ...
        .mockRejectedValueOnce(queryFailedError), // INSERT -> violação de unicidade
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(queryFailedError);

    expect(fakeQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending: falha em connect() propaga o erro original, não tenta rollback (nenhuma transação chegou a abrir) e ainda libera o QueryRunner exatamente uma vez', async () => {
    const connectError = new Error('connection reset');
    const fakeQueryRunner = {
      connect: jest.fn().mockRejectedValue(connectError),
      startTransaction: jest.fn(),
      query: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(connectError);

    expect(fakeQueryRunner.startTransaction).not.toHaveBeenCalled();
    expect(fakeQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending: falha em startTransaction() propaga o erro original, não tenta rollback e ainda libera o QueryRunner exatamente uma vez', async () => {
    const startTransactionError = new Error('could not start transaction');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockRejectedValue(startTransactionError),
      query: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(startTransactionError);

    expect(fakeQueryRunner.query).not.toHaveBeenCalled();
    expect(fakeQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending: falha em commitTransaction() faz rollback (transação estava ativa), propaga o erro original e libera o QueryRunner exatamente uma vez', async () => {
    const commitError = new Error('commit failed: connection lost');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([]) // SELECT ... status = 'PROCESSING' -> nenhuma
        .mockResolvedValueOnce(undefined) // UPDATE ... status = 'EXPIRED' ...
        .mockResolvedValueOnce(undefined), // INSERT -> sucesso
      commitTransaction: jest.fn().mockRejectedValue(commitError),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(commitError);

    expect(fakeQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('createPending for a different account is unaffected by another account being PROCESSING', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(pending.state);

    await expect(
      service.createPending({
        marketplaceAccountId: otherAccountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).resolves.toBeDefined();
  });

  it('claimByState atomically moves PENDING -> PROCESSING exactly once, second call returns null (replay)', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    const first = await service.claimByState(pending.state);
    const second = await service.claimByState(pending.state);

    expect(first?.status).toBe('PROCESSING');
    expect(second).toBeNull();
  });

  it('claimByState returns null for an unknown state', async () => {
    expect(await service.claimByState('never-existed')).toBeNull();
  });

  it('claimByState returns null for an expired PENDING row', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await dataSource.query(
      `UPDATE oauth_authorization_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [pending.id],
    );

    expect(await service.claimByState(pending.state)).toBeNull();
  });

  it('claimByState returns an object with real camelCase property names/values (not snake_case columns)', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    const claimed = await service.claimByState(pending.state);

    // Prova, por valor, que o `RETURNING` com aliases explícitos produz o
    // shape camelCase que os chamadores (Task 19's
    // `applyConnectionAndFinalizeAtomically`) realmente consomem — não um
    // cast que apenas finge converter `marketplace_account_id` em
    // `marketplaceAccountId` sem de fato renomear a coluna.
    expect(claimed).toMatchObject({
      id: pending.id,
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
      status: 'PROCESSING',
    });
    expect(claimed!.encryptedCodeVerifier).not.toBeNull();
    expect(claimed!.processingStartedAt).toBeInstanceOf(Date);
    expect(claimed!.consumedAt).toBeInstanceOf(Date);
    // Nenhuma propriedade snake_case deve vazar no objeto retornado.
    expect(claimed).not.toHaveProperty('marketplace_account_id');
    expect(claimed).not.toHaveProperty('processing_started_at');
  });

  it('finalizeSuccess only updates a PROCESSING row, and clears encrypted_code_verifier', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    const claimed = await service.claimByState(pending.state);

    expect(await service.finalizeSuccess(claimed!.id)).toBe(true);
    // Replay: already SUCCESS, must not "succeed" again.
    expect(await service.finalizeSuccess(claimed!.id)).toBe(false);

    const rows = await dataSource.query(
      'SELECT status, encrypted_code_verifier, completed_at FROM oauth_authorization_requests WHERE id = $1',
      [claimed!.id],
    );
    expect(rows[0].status).toBe('SUCCESS');
    expect(rows[0].encrypted_code_verifier).toBeNull();
    expect(rows[0].completed_at).not.toBeNull();
  });

  it('finalizeFailure only updates a PROCESSING row, stores the failureCode, clears encrypted_code_verifier', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    const claimed = await service.claimByState(pending.state);

    expect(
      await service.finalizeFailure(claimed!.id, 'IDENTITY_MISMATCH'),
    ).toBe(true);
    expect(
      await service.finalizeFailure(claimed!.id, 'IDENTITY_MISMATCH'),
    ).toBe(false);

    const rows = await dataSource.query(
      'SELECT status, failure_code, encrypted_code_verifier FROM oauth_authorization_requests WHERE id = $1',
      [claimed!.id],
    );
    expect(rows[0].status).toBe('FAILED');
    expect(rows[0].failure_code).toBe('IDENTITY_MISMATCH');
    expect(rows[0].encrypted_code_verifier).toBeNull();
  });

  it('sweepExpiredPending marks past-due PENDING rows EXPIRED and clears the verifier, leaves PROCESSING untouched', async () => {
    const expired = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await dataSource.query(
      `UPDATE oauth_authorization_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [expired.id],
    );

    const processingSeed = await service.createPending({
      marketplaceAccountId: otherAccountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(processingSeed.state);

    const count = await service.sweepExpiredPending();
    expect(count).toBe(1);

    const rows = await dataSource.query(
      'SELECT id, status FROM oauth_authorization_requests ORDER BY status',
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: expired.id, status: 'EXPIRED' },
        { id: processingSeed.id, status: 'PROCESSING' },
      ]),
    );
  });

  it('findStaleProcessingCandidates + failIfStillStaleProcessing recover an abandoned PROCESSING row', async () => {
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    const claimed = await service.claimByState(pending.state);
    const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    await dataSource.query(
      `UPDATE oauth_authorization_requests SET processing_started_at = $2 WHERE id = $1`,
      [claimed!.id, oldTimestamp],
    );

    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const candidates = await service.findStaleProcessingCandidates(cutoff);
    expect(candidates.map((c) => c.id)).toContain(claimed!.id);

    expect(await service.failIfStillStaleProcessing(claimed!.id, cutoff)).toBe(
      true,
    );

    const rows = await dataSource.query(
      'SELECT status, failure_code FROM oauth_authorization_requests WHERE id = $1',
      [claimed!.id],
    );
    expect(rows[0].status).toBe('FAILED');
    expect(rows[0].failure_code).toBe('CALLBACK_RESULT_UNKNOWN');
  });

  it('a violação REAL do PostgreSQL na constraint de tentativa ativa (UQ_oauth_authorization_requests_active_attempt) vira OAuthConnectionInProgressError — sem mock de erro, sem depender do idioma da mensagem do driver', async () => {
    // Complementa (não substitui) o teste com erro fabricado acima: aqui o
    // 23505 é o SQLSTATE real devolvido pelo PostgreSQL disparado por uma
    // segunda tentativa concorrente de verdade, provando que
    // `isActiveAttemptConflict` funciona contra o driver `pg` real, não
    // apenas contra um objeto de erro simulado em memória (item 4 da
    // segunda revisão).
    const pending = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });
    await service.claimByState(pending.state);

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBeInstanceOf(OAuthConnectionInProgressError);
  });

  it('uma violação REAL do PostgreSQL em UQ_oauth_authorization_requests_state_hash (colisão de state) NÃO vira OAuthConnectionInProgressError', async () => {
    // Prova, contra o banco real, que a checagem por nome de constraint
    // (não só SQLSTATE) rejeita corretamente uma colisão de `state_hash`
    // como o erro real que ela é, mesmo vindo do driver `pg` de verdade.
    const first = await service.createPending({
      marketplaceAccountId: accountId,
      initiatedByUserId: userId,
      marketplace: Marketplace.MERCADO_LIVRE,
    });

    // Sem controle direto sobre o gerador de state aleatório, a colisão é
    // simulada diretamente contra o banco real via um INSERT cru que reusa
    // o `state_hash` da primeira tentativa em outra conta — a mesma
    // constraint (`UQ_oauth_authorization_requests_state_hash`) que
    // `createPending` violaria em uma colisão real de state.
    await expect(
      dataSource.query(
        `INSERT INTO oauth_authorization_requests
           (id, marketplace_account_id, initiated_by_user_id, marketplace,
            state_hash, encrypted_code_verifier, status, expires_at)
         SELECT gen_random_uuid(), $1, $2, marketplace, state_hash, encrypted_code_verifier, status, expires_at
           FROM oauth_authorization_requests WHERE id = $3`,
        [otherAccountId, userId, first.id],
      ),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'UQ_oauth_authorization_requests_state_hash',
    });
  });

  it('uma violação de unicidade em uma constraint totalmente desconhecida (não active-attempt, não state_hash) não é convertida em OAuthConnectionInProgressError', async () => {
    const unknownConstraintError = Object.assign(
      new Error('duplicate key value violates unique constraint "some_other_future_index"'),
      { code: '23505', constraint: 'some_other_future_index' },
    );
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(unknownConstraintError),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: true,
    };

    const spy = jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(
        fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>,
      );

    await expect(
      service.createPending({
        marketplaceAccountId: accountId,
        initiatedByUserId: userId,
        marketplace: Marketplace.MERCADO_LIVRE,
      }),
    ).rejects.toBe(unknownConstraintError);

    expect(fakeQueryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- oauth-authorization-requests.service.spec.ts`
Expected: FAIL — `Cannot find module './oauth-authorization-requests.service'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/oauth-authorization-requests.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { generatePkcePair, generateState, hashState } from './pkce.util';
import type { OAuthAuthorizationRequest } from './oauth-authorization-request.entity';
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';

const PENDING_TTL_MS = 10 * 60 * 1000;

export class OAuthConnectionInProgressError extends Error {
  constructor() {
    super('Já existe uma tentativa de conexão em andamento para esta conta.');
  }
}

export interface CreatedPendingRequest {
  id: string;
  state: string;
  codeChallenge: string;
}

/**
 * Todas as escritas/leituras aqui usam SQL cru via `DataSource` (não um
 * `Repository<OAuthAuthorizationRequest>` injetado) — as operações desta
 * classe são exclusivamente `UPDATE ... RETURNING` atômicos e um `INSERT`
 * dentro de transação curta, exatamente como o design especifica; não há
 * nenhum uso de `Repository`/`QueryBuilder` a justificar essa injeção
 * adicional. `OAuthAuthorizationRequest` permanece importado apenas como
 * tipo, para tipar o retorno de `claimByState`.
 */
@Injectable()
export class OAuthAuthorizationRequestsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly encryptionService: EncryptionService,
  ) {}

  async createPending(input: {
    marketplaceAccountId: string;
    initiatedByUserId: string;
    marketplace: Marketplace;
  }): Promise<CreatedPendingRequest> {
    const state = generateState();
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const stateHash = hashState(state);
    const encryptedCodeVerifier = this.encryptionService.encrypt(codeVerifier);
    const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
    const id = randomUUID();

    // `connect()`/`startTransaction()` ficam DENTRO do try: se qualquer um
    // dos dois lançar, o `finally` abaixo ainda libera o QueryRunner
    // exatamente uma vez (item 1 da segunda revisão) — antes, uma falha em
    // `connect()`/`startTransaction()` pulava o `finally` e vazava a
    // conexão dedicada do pool.
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const processing = (await queryRunner.query(
        `SELECT id FROM oauth_authorization_requests
          WHERE marketplace_account_id = $1 AND status = 'PROCESSING' LIMIT 1`,
        [input.marketplaceAccountId],
      )) as Array<{ id: string }>;

      if (processing.length > 0) {
        throw new OAuthConnectionInProgressError();
      }

      await queryRunner.query(
        `UPDATE oauth_authorization_requests
            SET status = 'EXPIRED', completed_at = now(), encrypted_code_verifier = NULL
          WHERE marketplace_account_id = $1 AND status = 'PENDING'`,
        [input.marketplaceAccountId],
      );

      await queryRunner.query(
        `INSERT INTO oauth_authorization_requests
           (id, marketplace_account_id, initiated_by_user_id, marketplace,
            state_hash, encrypted_code_verifier, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)`,
        [
          id,
          input.marketplaceAccountId,
          input.initiatedByUserId,
          input.marketplace,
          stateHash,
          encryptedCodeVerifier,
          expiresAt,
        ],
      );

      await queryRunner.commitTransaction();
    } catch (error) {
      // Só faz rollback se uma transação de fato chegou a ficar ativa — uma
      // falha em `connect()` ou `startTransaction()` nunca abre transação,
      // então não há o que reverter.
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // Falha no próprio rollback não pode mascarar o erro original
          // que causou a falha da transação — ele é relançado abaixo mesmo
          // assim.
        }
      }

      if (error instanceof OAuthConnectionInProgressError) throw error;
      if (this.isActiveAttemptConflict(error)) {
        throw new OAuthConnectionInProgressError();
      }
      throw error;
    } finally {
      try {
        await queryRunner.release();
      } catch {
        // Idem: uma falha na liberação não pode suprimir o erro (ou o
        // resultado de sucesso) que já está sendo propagado/retornado.
      }
    }

    return { id, state, codeChallenge };
  }

  async claimByState(
    state: string,
  ): Promise<OAuthAuthorizationRequest | null> {
    const stateHash = hashState(state);
    // `RETURNING *` devolveria nomes de coluna em snake_case
    // (`marketplace_account_id`, `processing_started_at`, ...) e um cast
    // TypeScript não os renomeia para os campos camelCase que o chamador
    // (Task 19's `applyConnectionAndFinalizeAtomically`, o advisory lock)
    // realmente lê — por isso todo alias abaixo é explícito.
    const rows = (await this.dataSource.query(
      `UPDATE oauth_authorization_requests
          SET status = 'PROCESSING', processing_started_at = now(), consumed_at = now()
        WHERE state_hash = $1 AND status = 'PENDING' AND expires_at > now()
        RETURNING
          id AS "id",
          marketplace_account_id AS "marketplaceAccountId",
          initiated_by_user_id AS "initiatedByUserId",
          marketplace AS "marketplace",
          state_hash AS "stateHash",
          encrypted_code_verifier AS "encryptedCodeVerifier",
          status AS "status",
          failure_code AS "failureCode",
          expires_at AS "expiresAt",
          processing_started_at AS "processingStartedAt",
          consumed_at AS "consumedAt",
          completed_at AS "completedAt",
          created_at AS "createdAt"`,
      [stateHash],
    )) as OAuthAuthorizationRequest[];

    return rows[0] ?? null;
  }

  async finalizeSuccess(id: string): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `UPDATE oauth_authorization_requests
          SET status = 'SUCCESS', completed_at = now(), failure_code = NULL,
              encrypted_code_verifier = NULL
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING id`,
      [id],
    )) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async finalizeFailure(
    id: string,
    failureCode: MercadoLivreOAuthFailureCode,
  ): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `UPDATE oauth_authorization_requests
          SET status = 'FAILED', completed_at = now(), failure_code = $2,
              encrypted_code_verifier = NULL
        WHERE id = $1 AND status = 'PROCESSING'
        RETURNING id`,
      [id, failureCode],
    )) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async sweepExpiredPending(): Promise<number> {
    const rows = (await this.dataSource.query(
      `UPDATE oauth_authorization_requests
          SET status = 'EXPIRED', completed_at = now(), encrypted_code_verifier = NULL
        WHERE status = 'PENDING' AND expires_at <= now()
        RETURNING id`,
    )) as Array<{ id: string }>;
    return rows.length;
  }

  async findStaleProcessingCandidates(
    cutoff: Date,
  ): Promise<Array<{ id: string; marketplaceAccountId: string }>> {
    // Mais antigas primeiro + lote limitado: sem isso, uma execução do cron
    // com muitas candidatas concorrendo por locks poderia ficar rodando por
    // vários minutos (item 9 da revisão). `failIfStillStaleProcessing` é
    // chamada por candidata em `recoverStaleProcessing` (Task 21), então um
    // lote de 50 é reavaliado a cada execução do cron até esvaziar.
    return (await this.dataSource.query(
      `SELECT id, marketplace_account_id AS "marketplaceAccountId"
         FROM oauth_authorization_requests
        WHERE status = 'PROCESSING' AND processing_started_at <= $1
        ORDER BY processing_started_at ASC
        LIMIT 50`,
      [cutoff],
    )) as Array<{ id: string; marketplaceAccountId: string }>;
  }

  async failIfStillStaleProcessing(
    id: string,
    cutoff: Date,
  ): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `UPDATE oauth_authorization_requests
          SET status = 'FAILED', completed_at = now(), failure_code = 'CALLBACK_RESULT_UNKNOWN',
              encrypted_code_verifier = NULL
        WHERE id = $1 AND status = 'PROCESSING' AND processing_started_at <= $2
        RETURNING id`,
      [id, cutoff],
    )) as Array<{ id: string }>;
    return rows.length > 0;
  }

  // TypeORM's `QueryFailedError` copia as propriedades do erro do driver
  // `pg` (incluindo `code` e `constraint`) para a própria instância — não
  // depende de casar texto de mensagem, que varia por locale/versão do
  // PostgreSQL (item 7 da revisão). `23505` é o SQLSTATE de
  // `unique_violation`; só o índice `..._active_attempt` (Task 5) representa
  // uma tentativa concorrente legítima. Uma violação em
  // `UQ_oauth_authorization_requests_state_hash` (colisão de state
  // criptograficamente aleatório — praticamente impossível) NÃO deve virar
  // `OAuthConnectionInProgressError`: é um erro real, e deve propagar como
  // tal.
  private isActiveAttemptConflict(error: unknown): boolean {
    const pgError = this.extractPostgresError(error);
    return (
      pgError?.code === '23505' &&
      pgError.constraint === 'UQ_oauth_authorization_requests_active_attempt'
    );
  }

  private extractPostgresError(
    error: unknown,
  ): { code?: string; constraint?: string } | null {
    if (!(error instanceof Error)) return null;
    const candidate = error as Error & { code?: string; constraint?: string };
    return typeof candidate.code === 'string' ? candidate : null;
  }
}
```

Since this service no longer injects `Repository<OAuthAuthorizationRequest>`, drop `TypeOrmModule.forFeature([OAuthAuthorizationRequest])` from Task 23's `MercadoLivreOAuthModule` imports too — nothing in the module requests that repository token (see Task 23's fix note).

- [ ] **Step 4: Run it, confirm it passes (requires `TEST_DATABASE_URL` — do not run this without it; `beforeAll` throws otherwise, by design)**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- oauth-authorization-requests.service.spec.ts`
Expected: PASS (every `it` in the file above)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/oauth-authorization-requests.service.ts backend/src/integrations/mercado-livre-oauth/oauth-authorization-requests.service.spec.ts
git commit -m "feat(oauth): add OAuthAuthorizationRequestsService (createPending/claim/finalize/sweep)"
```

---

## Task 13: 🔍 CONCURRENCY CHECKPOINT — `AdvisoryLockService`, real Postgres contention test

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/advisory-lock.service.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/advisory-lock.service.spec.ts`

**Interfaces:**
- Consumes: `deriveAdvisoryLockKey` (Task 8).
- Produces: `class AdvisoryLockService` with `tryAcquire(accountId: string): Promise<AdvisoryLockHandle | null>`, `interface AdvisoryLockHandle { release(): Promise<void> }` — consumed by Task 19 (callback) and Task 20 (refresh).

- [ ] **Step 1: Write the failing tests (real Postgres — proves actual DB-level mutual exclusion, not just JS-level)**

```typescript
// backend/src/integrations/mercado-livre-oauth/advisory-lock.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { AdvisoryLockService } from './advisory-lock.service';
import { deriveAdvisoryLockKey } from './advisory-lock.util';

function makeConfigService(waitMs: number): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'ML_ACCOUNT_LOCK_WAIT_MS' ? waitMs : fallback,
  } as unknown as ConfigService;
}

describe('AdvisoryLockService (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    // Sem entidades: `AdvisoryLockService` só usa `pg_try_advisory_lock`/
    // `pg_advisory_unlock` via SQL cru, nunca um `Repository`. Ainda assim
    // usa o helper compartilhado (não um `new DataSource(...)` inline) para
    // manter um único ponto de criação de `DataSource` de teste em todo o
    // plano.
    dataSource = await createTestDataSource([]);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('acquires and releases a lock on a fresh account', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const handle = await service.tryAcquire(randomUUID());

    expect(handle).not.toBeNull();
    await handle!.release();
  });

  it('a second acquisition attempt on the SAME account fails while the first holds the lock, using two real connections', async () => {
    const accountId = randomUUID();
    const holder = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const contender = new AdvisoryLockService(dataSource, makeConfigService(300));

    const holderHandle = await holder.tryAcquire(accountId);
    expect(holderHandle).not.toBeNull();

    const contenderHandle = await contender.tryAcquire(accountId);
    expect(contenderHandle).toBeNull();

    await holderHandle!.release();
  });

  it('after release, a new acquisition on the same account succeeds again', async () => {
    const accountId = randomUUID();
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));

    const first = await service.tryAcquire(accountId);
    await first!.release();

    const second = await service.tryAcquire(accountId);
    expect(second).not.toBeNull();
    await second!.release();
  });

  it('locking account A never blocks a concurrent acquisition on account B', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));

    const handleA = await service.tryAcquire(randomUUID());
    const handleB = await service.tryAcquire(randomUUID());

    expect(handleA).not.toBeNull();
    expect(handleB).not.toBeNull();

    await handleA!.release();
    await handleB!.release();
  });

  it('releasing frees the underlying pg_advisory_lock at the database level', async () => {
    const accountId = randomUUID();
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const key = deriveAdvisoryLockKey(accountId).toString();

    const handle = await service.tryAcquire(accountId);
    await handle!.release();

    // Verificação e limpeza usam o MESMO QueryRunner (mesma conexão física
    // de verdade) — `dataSource.query(...)` em duas chamadas separadas não
    // garante isso (o pool pode devolver conexões diferentes a cada
    // chamada), e `pg_advisory_unlock` só tem efeito na sessão que
    // efetivamente detém o lock: destravar de uma sessão errada é um no-op
    // silencioso (retorna `false`, não lança), o que deixaria o lock preso
    // na conexão que o adquiriu até o pool reciclá-la.
    const verifier = dataSource.createQueryRunner();
    await verifier.connect();
    try {
      const rows = (await verifier.query(
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [key],
      )) as Array<{ acquired: boolean }>;
      expect(rows[0].acquired).toBe(true);

      const unlockRows = (await verifier.query(
        'SELECT pg_advisory_unlock($1::bigint) AS released',
        [key],
      )) as Array<{ released: boolean }>;
      expect(unlockRows[0].released).toBe(true);
    } finally {
      await verifier.release();
    }
  });

  it('an exception thrown while polling pg_try_advisory_lock still releases the QueryRunner exactly once, never leaves the connection dangling', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValue(new Error('connection reset')),
      release: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>);

    await expect(service.tryAcquire(randomUUID())).rejects.toThrow('connection reset');

    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): uma falha em pg_advisory_unlock ainda tenta liberar o QueryRunner exatamente uma vez, e propaga o erro do unlock', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const unlockError = new Error('connection reset during unlock');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockRejectedValueOnce(unlockError), // pg_advisory_unlock
      release: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>);

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(unlockError);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): uma falha em QueryRunner.release() propaga o erro, e uma segunda chamada a release() não tenta liberar de novo (idempotência mesmo após falha)', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const releaseError = new Error('pool exhausted, cannot release');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockResolvedValueOnce(undefined), // pg_advisory_unlock
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>);

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(releaseError);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);

    // Segunda chamada ao MESMO handle: não deve tentar `pg_advisory_unlock`
    // nem `queryRunner.release()` outra vez, mesmo a primeira tentativa
    // tendo falhado.
    await expect(handle!.release()).resolves.toBeUndefined();
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
    expect(fakeQueryRunner.query).toHaveBeenCalledTimes(2);
  });

  it('release(): duas chamadas consecutivas bem-sucedidas ao mesmo AdvisoryLockHandle só liberam o lock/QueryRunner uma única vez', async () => {
    const accountId = randomUUID();
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));

    const handle = await service.tryAcquire(accountId);
    expect(handle).not.toBeNull();

    await handle!.release();
    await expect(handle!.release()).resolves.toBeUndefined();

    // O lock já foi liberado de verdade na primeira chamada — uma nova
    // aquisição para a mesma conta deve funcionar normalmente, provando que
    // a segunda chamada a `release()` não tentou (e não conseguiria) um
    // segundo `pg_advisory_unlock` sobre uma conexão já fechada.
    const reacquired = await service.tryAcquire(accountId);
    expect(reacquired).not.toBeNull();
    await reacquired!.release();
  });

  it('tryAcquire(): timeout (nenhum acquired) seguido de falha em queryRunner.release() chama release() exatamente uma vez e propaga o erro do release', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const releaseError = new Error('pool exhausted during timeout cleanup');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      // Nunca adquire: toda chamada a pg_try_advisory_lock retorna false,
      // então o loop expira e cai no ramo de timeout (`return null`).
      query: jest.fn().mockResolvedValue([{ acquired: false }]),
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>);

    await expect(
      new AdvisoryLockService(dataSource, makeConfigService(50)).tryAcquire(randomUUID()),
    ).rejects.toBe(releaseError);

    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('tryAcquire(): falha de query durante o polling seguida de falha no cleanup preserva o erro da query original e chama release() exatamente uma vez', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const queryError = new Error('connection reset mid-poll');
    const releaseError = new Error('cleanup also failed');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValue(queryError),
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>);

    await expect(service.tryAcquire(randomUUID())).rejects.toBe(queryError);

    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): falha simultânea de pg_advisory_unlock e queryRunner.release() preserva o erro do unlock como erro primário', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const unlockError = new Error('unlock failed');
    const releaseError = new Error('release also failed');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockRejectedValueOnce(unlockError), // pg_advisory_unlock
      release: jest.fn().mockRejectedValue(releaseError),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>);

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(unlockError);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });

  it('release(): a segunda chamada ao mesmo handle não repete nem pg_advisory_unlock nem queryRunner.release(), mesmo após falha na primeira', async () => {
    const service = new AdvisoryLockService(dataSource, makeConfigService(1000));
    const unlockError = new Error('unlock failed');
    const fakeQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ acquired: true }]) // pg_try_advisory_lock
        .mockRejectedValueOnce(unlockError), // pg_advisory_unlock
      release: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockReturnValueOnce(fakeQueryRunner as unknown as ReturnType<DataSource['createQueryRunner']>);

    const handle = await service.tryAcquire(randomUUID());
    expect(handle).not.toBeNull();

    await expect(handle!.release()).rejects.toBe(unlockError);
    await expect(handle!.release()).resolves.toBeUndefined();

    // `query` só foi chamado 2x (lock + unlock) — a segunda `release()` não
    // reenviou `pg_advisory_unlock`, e `release` do QueryRunner continua em
    // 1 chamada só.
    expect(fakeQueryRunner.query).toHaveBeenCalledTimes(2);
    expect(fakeQueryRunner.release).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- advisory-lock.service.spec.ts`
Expected: FAIL — `Cannot find module './advisory-lock.service'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/advisory-lock.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { deriveAdvisoryLockKey } from './advisory-lock.util';

export interface AdvisoryLockHandle {
  release(): Promise<void>;
}

const POLL_INTERVAL_MS = 100;

/**
 * Advisory lock por conta, coordenando callback e refresh mesmo com
 * múltiplas instâncias do backend (design §3). Uma conexão DEDICADA
 * (QueryRunner) é usada para adquirir e liberar o mesmo lock — nunca a
 * conexão compartilhada do pool de repositórios.
 */
@Injectable()
export class AdvisoryLockService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async tryAcquire(accountId: string): Promise<AdvisoryLockHandle | null> {
    const waitMs = this.configService.get<number>(
      'ML_ACCOUNT_LOCK_WAIT_MS',
      3000,
    );
    const key = deriveAdvisoryLockKey(accountId).toString();
    const queryRunner = this.dataSource.createQueryRunner();

    // Helper de liberação IDEMPOTENTE, compartilhado por TODOS os caminhos
    // que podem liberar esta mesma conexão física: timeout (`return null`),
    // falha de `connect`/`query`/polling (`catch` abaixo) e o
    // `AdvisoryLockHandle.release()` retornado em caso de sucesso. O estado
    // "liberação iniciada" (`releaseStarted`) é marcado ANTES da primeira
    // tentativa de `queryRunner.release()` — não depois dela ter sucesso —
    // então mesmo que essa primeira tentativa lance, nenhum caminho
    // seguinte tenta liberar a mesma conexão de novo. Isto corrige um bug
    // real da versão anterior: se `queryRunner.release()` no ramo de
    // timeout lançasse, a exceção caía no `catch` externo, que chamava
    // `queryRunner.release()` uma SEGUNDA vez sobre a mesma conexão.
    let releaseStarted = false;
    const releaseQueryRunnerOnce = async (): Promise<void> => {
      if (releaseStarted) return;
      releaseStarted = true;
      await queryRunner.release();
    };

    // `connect()` fica DENTRO do `try`: se ele lançar (ex.: pool
    // esgotado), o `catch` abaixo ainda libera o `QueryRunner` — evitando
    // vazamento de conexão que existiria se `connect()` ficasse fora da
    // estrutura try/catch.
    try {
      await queryRunner.connect();
      const deadline = Date.now() + waitMs;

      while (Date.now() < deadline) {
        const rows = (await queryRunner.query(
          'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
          [key],
        )) as Array<{ acquired: boolean }>;

        if (rows[0]?.acquired) {
          // `handleReleaseStarted` trava o HANDLE (não a conexão física —
          // essa já é protegida por `releaseStarted`/`releaseQueryRunnerOnce`
          // acima) após a primeira chamada a `release()`: uma segunda
          // chamada ao mesmo handle não tenta reenviar `pg_advisory_unlock`
          // nem chamar `queryRunner.release()` de novo — mesmo que a
          // primeira tentativa de liberação tenha falhado (idempotência não
          // depende de sucesso).
          let handleReleaseStarted = false;
          return {
            release: async () => {
              if (handleReleaseStarted) return;
              handleReleaseStarted = true;

              // O erro do UNLOCK lógico (`pg_advisory_unlock`) é o erro
              // PRIMÁRIO desta operação — se ele e a liberação da conexão
              // (`queryRunner.release()`) falharem juntos, é o erro do
              // unlock que deve ser propagado, nunca mascarado pelo erro
              // secundário de cleanup da conexão.
              let primaryError: unknown;
              try {
                await queryRunner.query(
                  'SELECT pg_advisory_unlock($1::bigint)',
                  [key],
                );
              } catch (unlockError) {
                primaryError = unlockError;
              }

              try {
                await releaseQueryRunnerOnce();
              } catch (releaseError) {
                if (primaryError === undefined) primaryError = releaseError;
              }

              if (primaryError !== undefined) throw primaryError;
            },
          };
        }

        await this.sleep(POLL_INTERVAL_MS);
      }

      await releaseQueryRunnerOnce();
      return null;
    } catch (error) {
      // Aquisição, consulta ou o sleep entre tentativas falhou (ex.: conexão
      // caiu no meio do polling), OU a liberação no ramo de timeout acima
      // lançou. Em qualquer caso, o erro PRIMÁRIO é `error` — uma falha
      // secundária de `releaseQueryRunnerOnce()` aqui é apenas engolida
      // (a conexão já está marcada como "liberação iniciada", então nenhum
      // outro caminho tentará de novo) para nunca mascarar a causa raiz.
      try {
        await releaseQueryRunnerOnce();
      } catch {
        // Erro secundário de cleanup — intencionalmente descartado, ver
        // comentário acima. `releaseStarted` já garante que a conexão
        // nunca será liberada mais de uma vez.
      }
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 4: 🔍 Run it, confirm it passes (this proves real cross-connection mutual exclusion — do not skip)**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- advisory-lock.service.spec.ts`
Expected: PASS (every `it` in the file above, requires `TEST_DATABASE_URL` — `beforeAll` throws otherwise). The "second acquisition fails" test is deterministic, not timing-sensitive: `holder.tryAcquire` is fully awaited (lock physically held) before `contender.tryAcquire` is even called, and `holderHandle!.release()` only runs after the `contenderHandle` assertion — there is no window in which the outcome depends on relative timing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/advisory-lock.service.ts backend/src/integrations/mercado-livre-oauth/advisory-lock.service.spec.ts
git commit -m "feat(oauth): add AdvisoryLockService with real-Postgres contention coverage"
```


---

## Fim do Lote 2

Pare aqui. Não prossiga para a Task 14 nesta sessão — a Task 14 pertence ao Lote 3 (`2026-08-27-mercado-livre-oauth-batch-3.md`), que deve ser executado em uma sessão nova, lendo apenas o design aprovado, o índice mestre e o arquivo do Lote 3.
