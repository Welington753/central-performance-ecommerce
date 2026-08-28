# Mercado Livre OAuth (Fase 2) — Lote 3 de 4: Tasks 14–20

> **Antes de começar, leia nesta ordem e SOMENTE isto:**
> 1. O design aprovado — [docs/superpowers/specs/2026-08-27-mercado-livre-oauth-design.md](../specs/2026-08-27-mercado-livre-oauth-design.md).
> 2. O índice mestre curto — [2026-08-27-mercado-livre-oauth-implementation-plan.md](2026-08-27-mercado-livre-oauth-implementation-plan.md) (objetivo, constraints globais, estratégia de execução, tabela de lotes).
> 3. Este arquivo — se esta sessão começa no Checkpoint 5 (Tasks 14–18), leia do início; se retoma no Checkpoint 6 (Task 19, já com Tasks 14–18 commitadas) ou no Checkpoint 7 (Task 20, já com Tasks 14–19 commitadas), localize `## Task 19:` ou `## Task 20:` neste arquivo e leia a partir dali, sem reler as Tasks anteriores do lote.
> 4. Os arquivos reais do código citados pela tarefa em execução, somente quando necessário para confirmar assinaturas/config existentes.
>
> Não releia os outros três lotes — eles não são pré-requisito de contexto para este.

**Pré-requisito:** Lote 2 (Tasks 7–13, [2026-08-27-mercado-livre-oauth-batch-2.md](2026-08-27-mercado-livre-oauth-batch-2.md)) já implementado, testado e commitado nesta branch. Não prossiga se o commit do Lote 2 não existir.

**Sub-agentes:** não usar subagentes/agent teams por padrão para executar este lote. Use `superpowers:executing-plans`, tarefa por tarefa, sequencialmente, dentro desta sessão.

**Ao final deste lote:** a última tarefa (Task 20) é um ponto de parada. Pare ali e aguarde revisão externa antes de abrir uma nova sessão para o Lote 4.

---

## Task 14: `MarketplaceAccountResponseDto` + mapper; `findByIdOrFail`/`findByMarketplaceAndExternalSellerId`; controller gains a safe `GET` mapping and a `POST` create route

The current `GET /marketplace-accounts` returns the raw entity, which would leak `encryptedAccessToken`/`encryptedRefreshToken`/`encryptedCredentialMetadata` to the frontend the moment Task 24 starts consuming this endpoint for real. There is also no HTTP route to pre-create a `MarketplaceAccount` row (only the service method exists) — needed because the approved design's flow is "connect a pre-registered account" (design brainstorming Q1). Both gaps are fixed here, in the same controller file, before anything calls it for real.

**Files:**
- Create: `backend/src/integrations/marketplace-accounts/dto/marketplace-account-response.dto.ts`
- Create: `backend/src/integrations/marketplace-accounts/dto/marketplace-account-response.dto.spec.ts`
- Create: `backend/src/integrations/marketplace-accounts/dto/create-marketplace-account.dto.ts`
- Create: `backend/src/integrations/marketplace-accounts/dto/create-marketplace-account.dto.spec.ts`
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.ts`
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.controller.ts`
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.spec.ts`

**Interfaces:**
- Produces: `interface MarketplaceAccountResponseDto` — **only** `id`, `marketplace`, `externalSellerId`, `nickname`, `status`, `tokenExpiresAt`, `lastSuccessfulSyncAt`, `createdAt`, `updatedAt`. No `encrypted*` fields, no `connectedByUserId`, no `tokenVersion` — AND no `failureCode`/`errorSummary` either: design §7 defines `failureCode` as internal/auditoria, "nunca exposta integralmente ao navegador"; the frontend (Task 24) derives its own fixed, generic message from `status` alone, never from these two internal fields. Also produces `toMarketplaceAccountResponse(account: MarketplaceAccount): MarketplaceAccountResponseDto`.
- Produces: `class CreateMarketplaceAccountDto` — a real `class` with `class-validator` decorators (not a TypeScript `interface`, which is erased at runtime and would silently bypass the global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` already registered in `main.ts` — same pattern as the existing `LoginDto`). `marketplace` is restricted to exactly `MERCADO_LIVRE` (`@IsIn([Marketplace.MERCADO_LIVRE])` — Amazon/Shopee have no connector wired in this phase); `nickname` is optional. **`externalSellerId` is not a field on this class at all** — the global pipe's `forbidNonWhitelisted` rejects any request that includes it, and `externalSellerId` is only ever set by the backend after identity is confirmed via `/users/me` (design §6.2), never accepted from a client request.
- Produces: `MarketplaceAccountsService.findByIdOrFail(id: string): Promise<MarketplaceAccount>` (throws `NotFoundException`) and `findByMarketplaceAndExternalSellerId(marketplace, externalSellerId): Promise<MarketplaceAccount | null>` — consumed by Task 16 and Task 19.
- Produces: `POST /marketplace-accounts` (guarded, body validated against `CreateMarketplaceAccountDto`) returning `MarketplaceAccountResponseDto` — consumed by Task 24 (frontend).

- [ ] **Step 1: Write the failing DTO-mapper test**

```typescript
// backend/src/integrations/marketplace-accounts/dto/marketplace-account-response.dto.spec.ts
import { Marketplace } from '../../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-account.entity';
import { toMarketplaceAccountResponse } from './marketplace-account-response.dto';

describe('toMarketplaceAccountResponse', () => {
  it('never includes encrypted columns, connectedByUserId, tokenVersion, failureCode or errorSummary (design §7: internal/auditoria only)', () => {
    const account: MarketplaceAccount = {
      id: 'acc-1',
      marketplace: Marketplace.MERCADO_LIVRE,
      externalSellerId: '123',
      nickname: 'Loja principal',
      status: MarketplaceAccountStatus.ERROR,
      errorSummary: 'Esta conta do Mercado Livre já está conectada em outro registro.',
      failureCode: 'ACCOUNT_ALREADY_CONNECTED',
      encryptedAccessToken: 'iv:tag:cipher-access',
      encryptedRefreshToken: 'iv:tag:cipher-refresh',
      encryptedCredentialMetadata: null,
      connectedByUserId: 'user-1',
      tokenVersion: 4,
      tokenExpiresAt: new Date('2026-08-27T12:00:00.000Z'),
      lastSuccessfulSyncAt: null,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-27T00:00:00.000Z'),
    };

    const dto = toMarketplaceAccountResponse(account);
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('cipher-access');
    expect(serialized).not.toContain('cipher-refresh');
    expect(serialized).not.toContain('ACCOUNT_ALREADY_CONNECTED');
    expect(serialized).not.toContain('já está conectada em outro registro');
    expect(dto).not.toHaveProperty('encryptedAccessToken');
    expect(dto).not.toHaveProperty('encryptedRefreshToken');
    expect(dto).not.toHaveProperty('encryptedCredentialMetadata');
    expect(dto).not.toHaveProperty('connectedByUserId');
    expect(dto).not.toHaveProperty('tokenVersion');
    expect(dto).not.toHaveProperty('failureCode');
    expect(dto).not.toHaveProperty('errorSummary');
    expect(dto.status).toBe('ERROR'); // status É público — o frontend deriva sua própria mensagem fixa a partir dele
    expect(dto.tokenExpiresAt).toBe('2026-08-27T12:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- marketplace-account-response.dto.spec.ts`
Expected: FAIL — `Cannot find module './marketplace-account-response.dto'`

- [ ] **Step 3: Implement the DTO/mapper**

```typescript
// backend/src/integrations/marketplace-accounts/dto/marketplace-account-response.dto.ts
import type { Marketplace } from '../../contracts/marketplace.enum';
import type {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-account.entity';

/**
 * Nunca inclui `encrypted*`, `connectedByUserId`, `tokenVersion`,
 * `failureCode` ou `errorSummary` — os dois primeiros são detalhes internos
 * de credencial/concorrência, e os dois últimos são "interno/auditoria"
 * por definição do design (§7): o frontend nunca vê o vocabulário fechado
 * de `failureCode` nem o texto de `errorSummary` — ele deriva sua própria
 * mensagem genérica e fixa a partir de `status` (público por natureza: é
 * exatamente o mesmo enum `DISCONNECTED/CONNECTED/TOKEN_EXPIRED/ERROR` que
 * o design já trata como estado observável da conta).
 */
export interface MarketplaceAccountResponseDto {
  id: string;
  marketplace: Marketplace;
  externalSellerId: string | null;
  nickname: string | null;
  status: MarketplaceAccountStatus;
  tokenExpiresAt: string | null;
  lastSuccessfulSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toMarketplaceAccountResponse(
  account: MarketplaceAccount,
): MarketplaceAccountResponseDto {
  return {
    id: account.id,
    marketplace: account.marketplace,
    externalSellerId: account.externalSellerId,
    nickname: account.nickname,
    status: account.status,
    tokenExpiresAt: account.tokenExpiresAt
      ? account.tokenExpiresAt.toISOString()
      : null,
    lastSuccessfulSyncAt: account.lastSuccessfulSyncAt
      ? account.lastSuccessfulSyncAt.toISOString()
      : null,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- marketplace-account-response.dto.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Write the failing service tests for `findByIdOrFail`/`findByMarketplaceAndExternalSellerId`**

Add to `marketplace-accounts.service.spec.ts` (also add a `findOne(where)` method to `FakeMarketplaceAccountRepository` that filters `this.rows` by the given partial `where`, mirroring how TypeORM's `Repository.findOne` behaves for equality filters):

```typescript
  findOne(options: { where: Partial<MarketplaceAccount> }): Promise<MarketplaceAccount | null> {
    const entries = Object.entries(options.where) as Array<
      [keyof MarketplaceAccount, unknown]
    >;
    const found = this.rows.find((row) =>
      entries.every(([key, value]) => row[key] === value),
    );
    return Promise.resolve(found ?? null);
  }
```

```typescript
  it('findByIdOrFail returns the account when it exists', async () => {
    const created = await service.create({ marketplace: Marketplace.MERCADO_LIVRE });
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
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd backend && npm test -- marketplace-accounts.service.spec.ts`
Expected: FAIL — `service.findByIdOrFail is not a function`

- [ ] **Step 7: Implement in the service**

Add to `marketplace-accounts.service.ts` (add `NotFoundException` to the `@nestjs/common` import):

```typescript
  async findByIdOrFail(id: string): Promise<MarketplaceAccount> {
    const account = await this.repository.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }
    return account;
  }

  async findByMarketplaceAndExternalSellerId(
    marketplace: Marketplace,
    externalSellerId: string,
  ): Promise<MarketplaceAccount | null> {
    return this.repository.findOne({ where: { marketplace, externalSellerId } });
  }
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd backend && npm test -- marketplace-accounts.service.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 9: Write the failing `CreateMarketplaceAccountDto` validation tests**

```typescript
// backend/src/integrations/marketplace-accounts/dto/create-marketplace-account.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMarketplaceAccountDto } from './create-marketplace-account.dto';

async function validateBody(body: Record<string, unknown>) {
  const instance = plainToInstance(CreateMarketplaceAccountDto, body);
  // Mesmas opções do ValidationPipe global registrado em main.ts.
  return validate(instance, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateMarketplaceAccountDto', () => {
  it('accepts a valid MERCADO_LIVRE body with no nickname', async () => {
    expect(await validateBody({ marketplace: 'MERCADO_LIVRE' })).toHaveLength(0);
  });

  it('accepts an optional nickname', async () => {
    expect(
      await validateBody({ marketplace: 'MERCADO_LIVRE', nickname: 'Loja principal' }),
    ).toHaveLength(0);
  });

  it('rejects a marketplace other than MERCADO_LIVRE (Amazon/Shopee have no connector wired in this phase)', async () => {
    const errors = await validateBody({ marketplace: 'AMAZON' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an unrecognized marketplace string', async () => {
    const errors = await validateBody({ marketplace: 'NOT_A_MARKETPLACE' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an externalSellerId sent by the client — never accepted from a request body (design §6.2: só preenchido após /users/me)', async () => {
    const errors = await validateBody({
      marketplace: 'MERCADO_LIVRE',
      externalSellerId: 'client-supplied-seller-id',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects any other unexpected extra field', async () => {
    const errors = await validateBody({ marketplace: 'MERCADO_LIVRE', unexpected: 'x' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 10: Run it, confirm it fails**

Run: `cd backend && npm test -- create-marketplace-account.dto.spec.ts`
Expected: FAIL — `Cannot find module './create-marketplace-account.dto'`

- [ ] **Step 11: Implement the DTO class (a real class — required for the global `ValidationPipe` in `main.ts` to have any decorator metadata to validate against; a plain `interface` here would silently validate nothing)**

```typescript
// backend/src/integrations/marketplace-accounts/dto/create-marketplace-account.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Marketplace } from '../../contracts/marketplace.enum';

export class CreateMarketplaceAccountDto {
  @ApiProperty({ enum: [Marketplace.MERCADO_LIVRE] })
  @IsIn([Marketplace.MERCADO_LIVRE])
  marketplace!: Marketplace.MERCADO_LIVRE;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nickname?: string;

  // Deliberadamente SEM campo `externalSellerId`: o `ValidationPipe` global
  // (`forbidNonWhitelisted: true`, main.ts) rejeita qualquer corpo que o
  // inclua. Só é preenchido pelo backend após a identidade ser confirmada
  // via `/users/me` (design §6.2) — nunca aceito do cliente.
}
```

- [ ] **Step 12: Run it, confirm it passes**

Run: `cd backend && npm test -- create-marketplace-account.dto.spec.ts`
Expected: PASS (all 6 cases above)

- [ ] **Step 13: Update the controller — map `GET`, add `POST` using the real DTO class**

Replace `marketplace-accounts.controller.ts` entirely with:

```typescript
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { CreateMarketplaceAccountDto } from './dto/create-marketplace-account.dto';
import { toMarketplaceAccountResponse } from './dto/marketplace-account-response.dto';
import type { MarketplaceAccountResponseDto } from './dto/marketplace-account-response.dto';
import { MarketplaceAccountsService } from './marketplace-accounts.service';

@ApiTags('marketplace-accounts')
@ApiCookieAuth()
@UseGuards(AccessTokenGuard)
@Controller('marketplace-accounts')
export class MarketplaceAccountsController {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
  ) {}

  @Get()
  async findAll(): Promise<MarketplaceAccountResponseDto[]> {
    const accounts = await this.marketplaceAccountsService.findAll();
    return accounts.map(toMarketplaceAccountResponse);
  }

  @Post()
  async create(
    @Body() dto: CreateMarketplaceAccountDto,
  ): Promise<MarketplaceAccountResponseDto> {
    // Mapeamento explícito (nunca `...dto`): garante que, mesmo que o DTO
    // ganhe campos novos no futuro, só o que está listado aqui chega ao
    // serviço — `externalSellerId` nunca é aceito nesta rota.
    const account = await this.marketplaceAccountsService.create({
      marketplace: dto.marketplace,
      nickname: dto.nickname ?? null,
    });
    return toMarketplaceAccountResponse(account);
  }
}
```

- [ ] **Step 14: Run the full backend test suite to confirm nothing else broke**

Run: `cd backend && npm test`
Expected: PASS (all suites, including the untouched `architecture.spec.ts`)

- [ ] **Step 15: Commit**

```bash
git add backend/src/integrations/marketplace-accounts/
git commit -m "feat(oauth): add MarketplaceAccountResponseDto, POST /marketplace-accounts, lookup helpers"
```

---

## Task 15: `MarketplaceAccountsService` CAS methods — `applySuccessfulConnection`, `markError`, `applyRefreshedTokens`, `markTokenExpired`, `findConnectedDueForRenewal`

**Files:**
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.ts`
- Modify: `backend/src/integrations/marketplace-accounts/marketplace-accounts.service.spec.ts`

**Interfaces:**
- Produces: `applySuccessfulConnection(input, externalQueryRunner?): Promise<'applied' | 'version_conflict' | 'external_seller_conflict'>` — the optional second parameter lets a caller that already holds an open `QueryRunner`/transaction (Task 19's atomic callback-persistence method) share it, so the account CAS and the paired `OAuthAuthorizationRequest` finalization commit or roll back together, exactly as design §6.2 step 11 requires ("mesma transação... rollback completo"). Called with no second argument (as in this task's own tests below), it manages its own self-contained transaction — behavior identical to before.
- Produces: `markError(input): Promise<boolean>`, `applyRefreshedTokens(input): Promise<boolean>`, `markTokenExpired(input): Promise<boolean>`, `findConnectedDueForRenewal(dueBefore: Date, limit: number): Promise<MarketplaceAccount[]>` — all single-row conditional writes to `marketplace_accounts` only (design never requires these to be jointly atomic with the request table — only the SUCCESS commit is). Consumed by Task 19 (callback) and Task 20 (refresh/renewal).

This task needs real Postgres (the CAS `WHERE token_version = ...` semantics and the `external_seller_id` unique-index conflict can't be faithfully exercised by the in-memory fake). It reuses the disposable database from Task 5.

- [ ] **Step 1: Write the failing tests**

```typescript
// Append to marketplace-accounts.service.spec.ts — new describe block, real Postgres.
```

Add this whole block at the end of the file (keep the existing fake-repository `describe` block untouched above it):

```typescript
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';

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
       VALUES ($1, 'MERCADO_LIVRE', $2, $3, $4)`,
      [
        id,
        overrides.status ?? 'DISCONNECTED',
        overrides.tokenVersion ?? 0,
        overrides.externalSellerId ?? null,
      ],
    );
    return id;
  }

  beforeEach(async () => {
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

    const rows = await dataSource.query(
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
    const rows = await dataSource.query(
      'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(rows[0].status).toBe('DISCONNECTED');
    expect(rows[0].token_version).toBe(5);
  });

  it('applySuccessfulConnection returns external_seller_conflict and preserves the winning account when externalSellerId is already taken', async () => {
    await seedAccount({ status: 'CONNECTED', externalSellerId: 'taken-seller' });
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
    const losingRow = await dataSource.query(
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
      const withinTx = await queryRunner.query(
        'SELECT status FROM marketplace_accounts WHERE id = $1',
        [id],
      );
      expect(withinTx[0].status).toBe('CONNECTED');

      // ...mas ainda NÃO commitada — outra conexão não vê a mudança.
      const outsideTx = await dataSource.query(
        'SELECT status FROM marketplace_accounts WHERE id = $1',
        [id],
      );
      expect(outsideTx[0].status).toBe('DISCONNECTED');

      // O chamador decide: aqui, propositalmente, faz ROLLBACK em vez de commit.
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }

    const afterRollback = await dataSource.query(
      'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
      [id],
    );
    expect(afterRollback[0].status).toBe('DISCONNECTED');
    expect(afterRollback[0].token_version).toBe(0);
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

    const rows = await dataSource.query(
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
    const rows = await dataSource.query(
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
    const rows = await dataSource.query(
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

    const rows = await dataSource.query(
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
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- marketplace-accounts.service.spec.ts`
Expected: FAIL — `service.applySuccessfulConnection is not a function`, and the constructor call `new MarketplaceAccountsService(repo, dataSource)` fails (extra arg not yet accepted).

- [ ] **Step 3: Implement**

Modify `marketplace-accounts.service.ts`'s constructor to also inject `DataSource`, and add the five methods:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, QueryRunner, Repository } from 'typeorm';
import type { Marketplace } from '../contracts/marketplace.enum';
import type { CreateMarketplaceAccountInput } from './dto/create-marketplace-account.input';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from './marketplace-account.entity';

export interface FindMarketplaceAccountsFilter {
  marketplace?: Marketplace;
}

export type ApplySuccessfulConnectionOutcome =
  | 'applied'
  | 'version_conflict'
  | 'external_seller_conflict';

@Injectable()
export class MarketplaceAccountsService {
  constructor(
    @InjectRepository(MarketplaceAccount)
    private readonly repository: Repository<MarketplaceAccount>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ...(keep findAll, create, findByIdOrFail, findByMarketplaceAndExternalSellerId from Task 14 unchanged)...

  /**
   * CAS da conta para CONNECTED. Aceita opcionalmente um `QueryRunner` já
   * aberto por um chamador que precisa combinar esta escrita, na MESMA
   * transação, com outra tabela (Task 19's callback: esta escrita +
   * `oauth_authorization_requests` PROCESSING→SUCCESS têm que commitar ou
   * reverter juntas — design §6.2 passo 11). Quando um `QueryRunner`
   * externo é passado, este método NÃO chama `connect`/`startTransaction`/
   * `commitTransaction`/`rollbackTransaction`/`release` — só executa o
   * `UPDATE` e devolve o resultado; o chamador é dono do ciclo de vida da
   * transação. Sem um `QueryRunner` externo (uso normal, como nos testes
   * deste task), o método continua totalmente autocontido, como antes.
   */
  async applySuccessfulConnection(
    input: {
      id: string;
      expectedTokenVersion: number;
      externalSellerId: string;
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      tokenExpiresAt: Date;
      connectedByUserId: string | null;
    },
    externalQueryRunner?: QueryRunner,
  ): Promise<ApplySuccessfulConnectionOutcome> {
    const queryRunner = externalQueryRunner ?? this.dataSource.createQueryRunner();
    const ownsTransaction = !externalQueryRunner;

    // `connect()`/`startTransaction()` ficam DENTRO do `try` (não antes
    // dele): se `connect()` suceder mas `startTransaction()` lançar, o
    // `finally` abaixo ainda libera a conexão — evitando vazamento de
    // conexão que existiria se essas duas chamadas ficassem fora da
    // estrutura try/catch/finally.
    try {
      if (ownsTransaction) {
        await queryRunner.connect();
        await queryRunner.startTransaction();
      }

      const rows = (await queryRunner.query(
        `UPDATE marketplace_accounts
            SET encrypted_access_token = $1,
                encrypted_refresh_token = $2,
                token_expires_at = $3,
                external_seller_id = $4,
                status = 'CONNECTED',
                error_summary = NULL,
                failure_code = NULL,
                connected_by_user_id = $5,
                token_version = token_version + 1,
                updated_at = now()
          WHERE id = $6 AND token_version = $7
          RETURNING id`,
        [
          input.encryptedAccessToken,
          input.encryptedRefreshToken,
          input.tokenExpiresAt,
          input.externalSellerId,
          input.connectedByUserId,
          input.id,
          input.expectedTokenVersion,
        ],
      )) as Array<{ id: string }>;

      if (ownsTransaction) await queryRunner.commitTransaction();
      return rows.length > 0 ? 'applied' : 'version_conflict';
    } catch (error) {
      // `isTransactionActive` cobre o caso em que `connect()` teve sucesso
      // mas `startTransaction()` lançou (nenhuma transação chegou a ficar
      // ativa) — chamar `rollbackTransaction()` nesse caso lançaria um erro
      // próprio do driver e mascararia o erro original.
      if (ownsTransaction && queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      if (this.isUniqueSellerIdViolation(error)) return 'external_seller_conflict';
      throw error;
    } finally {
      if (ownsTransaction) await queryRunner.release();
    }
  }

  async markError(input: {
    id: string;
    expectedTokenVersion: number;
    failureCode: string;
    errorSummary: string;
  }): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `UPDATE marketplace_accounts
          SET status = 'ERROR', failure_code = $2, error_summary = $3, updated_at = now()
        WHERE id = $1 AND token_version = $4
        RETURNING id`,
      [input.id, input.failureCode, input.errorSummary, input.expectedTokenVersion],
    )) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async applyRefreshedTokens(input: {
    id: string;
    expectedTokenVersion: number;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    tokenExpiresAt: Date;
  }): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `UPDATE marketplace_accounts
          SET encrypted_access_token = $1,
              encrypted_refresh_token = $2,
              token_expires_at = $3,
              status = 'CONNECTED',
              failure_code = NULL,
              error_summary = NULL,
              token_version = token_version + 1,
              updated_at = now()
        WHERE id = $4 AND token_version = $5
        RETURNING id`,
      [
        input.encryptedAccessToken,
        input.encryptedRefreshToken,
        input.tokenExpiresAt,
        input.id,
        input.expectedTokenVersion,
      ],
    )) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async markTokenExpired(input: {
    id: string;
    expectedTokenVersion: number;
    failureCode: string;
    errorSummary: string;
  }): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `UPDATE marketplace_accounts
          SET status = 'TOKEN_EXPIRED', failure_code = $2, error_summary = $3, updated_at = now()
        WHERE id = $1 AND token_version = $4
        RETURNING id`,
      [input.id, input.failureCode, input.errorSummary, input.expectedTokenVersion],
    )) as Array<{ id: string }>;
    return rows.length > 0;
  }

  async findConnectedDueForRenewal(
    dueBefore: Date,
    limit: number,
  ): Promise<MarketplaceAccount[]> {
    return this.repository.find({
      where: {
        status: MarketplaceAccountStatus.CONNECTED,
        tokenExpiresAt: LessThanOrEqual(dueBefore),
      },
      // Mais urgente primeiro: quando o lote é limitado por `limit`, as
      // contas cujo token expira mais cedo têm prioridade.
      order: { tokenExpiresAt: 'ASC' },
      take: limit,
    });
  }

  // Mesmo padrão de Task 12's `isActiveAttemptConflict`: usa `code`/
  // `constraint` estruturados do driver `pg` (via `QueryFailedError`), nunca
  // texto de mensagem — o nome da constraint é definido em
  // `backend/src/database/migrations/1787837395713-init-schema.ts` (Fase 1,
  // já existente) e nunca muda por locale.
  private isUniqueSellerIdViolation(error: unknown): boolean {
    const pgError = this.extractPostgresError(error);
    return (
      pgError?.code === '23505' &&
      pgError.constraint ===
        'UQ_marketplace_accounts_marketplace_external_seller_id'
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

Also update `marketplace-accounts.service.spec.ts`'s existing fake-repository `describe` block: the `Test.createTestingModule` providers list must now also provide a `DataSource` token (a minimal `{}` stub is enough — the fake-repo tests never call the new CAS methods), otherwise Nest's DI will fail to construct the service:

```typescript
        {
          provide: DataSource,
          useValue: {},
        },
```

(add the `DataSource` import from `'typeorm'` at the top of the spec file.)

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- marketplace-accounts.service.spec.ts`
Expected: PASS (every `it` in both the fake-repository `describe` block and the real-Postgres `describe` block above — requires `TEST_DATABASE_URL`; `beforeAll` throws otherwise).

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/marketplace-accounts/
git commit -m "feat(oauth): add CAS methods to MarketplaceAccountsService (applySuccessfulConnection/markError/applyRefreshedTokens/markTokenExpired/findConnectedDueForRenewal)"
```

---

## Task 16: Connect flow — `MercadoLivreOAuthService.startConnection` + `POST .../connect`

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.spec.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.spec.ts`

**Interfaces:**
- Consumes: `MarketplaceAccountsService.findByIdOrFail` (Task 14), `OAuthAuthorizationRequestsService.createPending`/`OAuthConnectionInProgressError` (Task 12), `buildAuthorizationUrl` (Task 9), `AccessTokenGuard`/`CurrentUser`/`AccessTokenPayload` (existing auth module).
- Produces: `class MercadoLivreOAuthService` with `startConnection(input: { marketplaceAccountId: string; initiatedByUserId: string }): Promise<{ authorizationUrl: string }>` (throws `NotFoundException` for a non-connectable account, `ConflictException('OAUTH_CONNECTION_IN_PROGRESS')` when busy) — Task 19 adds `handleCallback` and Task 20 adds `ensureValidAccessToken` to this same class. Produces `MercadoLivreOAuthController` with `POST marketplace-accounts/:id/mercado-livre/connect` — Task 19 adds the `GET .../callback` route to this same controller.

- [ ] **Step 1: Write the failing service tests (fakes for both collaborators — no DB needed here, unit-level)**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import {
  MarketplaceAccount,
  MarketplaceAccountStatus,
} from '../marketplace-accounts/marketplace-account.entity';
import { OAuthConnectionInProgressError } from './oauth-authorization-requests.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

function account(overrides: Partial<MarketplaceAccount> = {}): MarketplaceAccount {
  return {
    id: 'acc-1',
    marketplace: Marketplace.MERCADO_LIVRE,
    externalSellerId: null,
    nickname: null,
    status: MarketplaceAccountStatus.DISCONNECTED,
    errorSummary: null,
    failureCode: null,
    encryptedAccessToken: null,
    encryptedRefreshToken: null,
    encryptedCredentialMetadata: null,
    connectedByUserId: null,
    tokenVersion: 0,
    tokenExpiresAt: null,
    lastSuccessfulSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function configService(): ConfigService {
  const values: Record<string, unknown> = {
    ML_CLIENT_ID: 'app-id',
    ML_REDIRECT_URI: 'https://api.example.com/integrations/mercado-livre/callback',
  };
  return {
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('MercadoLivreOAuthService.startConnection', () => {
  it('builds an authorization URL when the account is connectable', async () => {
    const marketplaceAccountsService = {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
    };
    const authorizationRequestsService = {
      createPending: jest.fn().mockResolvedValue({
        id: 'req-1',
        state: 'state-value',
        codeChallenge: 'challenge-value',
      }),
    };

    const service = new MercadoLivreOAuthService(
      marketplaceAccountsService as never,
      authorizationRequestsService as never,
      {} as never, // AdvisoryLockService, unused by startConnection
      {} as never, // MercadoLivreHttpClient, unused by startConnection
      {} as never, // EncryptionService, unused by startConnection
      configService(),
      {} as never, // DataSource, unused by startConnection
    );

    const result = await service.startConnection({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
    });

    expect(result.authorizationUrl).toContain('state=state-value');
    expect(result.authorizationUrl).toContain('code_challenge=challenge-value');
    expect(authorizationRequestsService.createPending).toHaveBeenCalledWith({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
      marketplace: Marketplace.MERCADO_LIVRE,
    });
  });

  it.each([
    Marketplace.AMAZON,
    Marketplace.SHOPEE,
  ])('rejects with NotFoundException when the account marketplace is %s', async (marketplace) => {
    const marketplaceAccountsService = {
      findByIdOrFail: jest.fn().mockResolvedValue(account({ marketplace })),
    };
    const service = new MercadoLivreOAuthService(
      marketplaceAccountsService as never,
      { createPending: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      configService(),
      {} as never,
    );

    await expect(
      service.startConnection({ marketplaceAccountId: 'acc-1', initiatedByUserId: 'u' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps OAuthConnectionInProgressError to a 409 ConflictException', async () => {
    const marketplaceAccountsService = {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
    };
    const authorizationRequestsService = {
      createPending: jest.fn().mockRejectedValue(new OAuthConnectionInProgressError()),
    };
    const service = new MercadoLivreOAuthService(
      marketplaceAccountsService as never,
      authorizationRequestsService as never,
      {} as never,
      {} as never,
      {} as never,
      configService(),
      {} as never,
    );

    await expect(
      service.startConnection({ marketplaceAccountId: 'acc-1', initiatedByUserId: 'u' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-oauth.service.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-oauth.service'`

- [ ] **Step 3: Implement the service (only `startConnection` for now — `handleCallback`/`ensureValidAccessToken` are added by Tasks 19/20 to this same file)**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from './advisory-lock.service';
import { buildAuthorizationUrl } from './build-authorization-url';
import { MercadoLivreHttpClient } from './mercado-livre-http.client';
import {
  OAuthAuthorizationRequestsService,
  OAuthConnectionInProgressError,
} from './oauth-authorization-requests.service';

const CONNECTABLE_STATUSES: MarketplaceAccountStatus[] = [
  MarketplaceAccountStatus.DISCONNECTED,
  MarketplaceAccountStatus.TOKEN_EXPIRED,
  MarketplaceAccountStatus.ERROR,
  MarketplaceAccountStatus.CONNECTED,
];

@Injectable()
export class MercadoLivreOAuthService {
  constructor(
    private readonly marketplaceAccountsService: MarketplaceAccountsService,
    private readonly authorizationRequestsService: OAuthAuthorizationRequestsService,
    private readonly advisoryLockService: AdvisoryLockService,
    private readonly httpClient: MercadoLivreHttpClient,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
    // Não usado por `startConnection` — só é lido por `handleCallback`
    // (Task 19), que precisa abrir uma transação compartilhada entre o CAS
    // da conta e a finalização da tentativa. Introduzido já aqui, e não na
    // Task 19, para que a assinatura do construtor nunca mude no meio do
    // plano — todo call site (Tasks 16, 19, 20, 23) usa a mesma ordem de 7
    // argumentos desde o início.
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Autorização interna nesta fase (design §6.1): sem RBAC/ownership na Fase
   * 1, qualquer usuário interno autenticado e ativo pode conectar/reconectar
   * qualquer conta — `initiatedByUserId` só serve para auditoria.
   */
  async startConnection(input: {
    marketplaceAccountId: string;
    initiatedByUserId: string;
  }): Promise<{ authorizationUrl: string }> {
    const account = await this.marketplaceAccountsService.findByIdOrFail(
      input.marketplaceAccountId,
    );

    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE ||
      !CONNECTABLE_STATUSES.includes(account.status)
    ) {
      throw new NotFoundException('Conta de marketplace não encontrada.');
    }

    try {
      const pending = await this.authorizationRequestsService.createPending({
        marketplaceAccountId: account.id,
        initiatedByUserId: input.initiatedByUserId,
        marketplace: Marketplace.MERCADO_LIVRE,
      });

      return {
        authorizationUrl: buildAuthorizationUrl({
          clientId: this.configService.getOrThrow<string>('ML_CLIENT_ID'),
          redirectUri: this.configService.getOrThrow<string>('ML_REDIRECT_URI'),
          state: pending.state,
          codeChallenge: pending.codeChallenge,
        }),
      };
    } catch (error) {
      if (error instanceof OAuthConnectionInProgressError) {
        throw new ConflictException('OAUTH_CONNECTION_IN_PROGRESS');
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-oauth.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing controller test**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.spec.ts
import { MercadoLivreOAuthController } from './mercado-livre-oauth.controller';

describe('MercadoLivreOAuthController.connect', () => {
  it('delegates to the service with the account id and the authenticated user id', async () => {
    const service = {
      startConnection: jest.fn().mockResolvedValue({ authorizationUrl: 'https://auth.mercadolivre.com.br/authorization?...' }),
    };
    const controller = new MercadoLivreOAuthController(service as never);

    const result = await controller.connect('acc-1', { sub: 'user-1', email: 'a@b.com' });

    expect(service.startConnection).toHaveBeenCalledWith({
      marketplaceAccountId: 'acc-1',
      initiatedByUserId: 'user-1',
    });
    expect(result.authorizationUrl).toContain('authorization');
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-oauth.controller.spec.ts`
Expected: FAIL — `Cannot find module './mercado-livre-oauth.controller'`

- [ ] **Step 7: Implement (only the `connect` route for now — Task 19 adds `callback` to this same file)**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.ts
import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../auth/interfaces/access-token-payload.interface';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';

@ApiTags('mercado-livre-oauth')
@Controller()
export class MercadoLivreOAuthController {
  constructor(private readonly service: MercadoLivreOAuthService) {}

  @ApiCookieAuth()
  @UseGuards(AccessTokenGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('marketplace-accounts/:id/mercado-livre/connect')
  @HttpCode(HttpStatus.OK)
  async connect(
    // `ParseUUIDPipe` rejeita IDs inválidos com 400 antes de chegarem ao
    // Postgres — sem isso, um `:id` mal formado vira erro 500 (sintaxe
    // inválida para `uuid`) em vez de um 404/400 previsível.
    @Param('id', ParseUUIDPipe) id: string,
    // `AccessTokenGuard` (acima) garante que a requisição nunca chega aqui
    // sem um usuário autenticado válido — por isso `user` não é opcional, e
    // não há `user!` escondendo essa garantia do compilador.
    @CurrentUser() user: AccessTokenPayload,
  ): Promise<{ authorizationUrl: string }> {
    return this.service.startConnection({
      marketplaceAccountId: id,
      initiatedByUserId: user.sub,
    });
  }
}
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-oauth.controller.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.spec.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.ts backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.spec.ts
git commit -m "feat(oauth): add connect flow (startConnection + POST .../connect)"
```

## Task 17: `callback-params.validator.ts`

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/callback-params.validator.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/callback-params.validator.spec.ts`

**Interfaces:**
- Produces: `type CallbackQuery = Record<string, string | string[] | undefined>`, `type CallbackParamsResult = { valid: true; state: string; code: string; error: null } | { valid: true; state: string; code: null; error: string } | { valid: false }`, `function validateCallbackParams(query: CallbackQuery): CallbackParamsResult` — consumed by Task 19. By construction, `error_description`/`error_uri` are validated for size only and never appear anywhere in `CallbackParamsResult` (design §6.2 step 1, "nunca... em errorSummary ou exceções").

- [ ] **Step 1: Write the failing tests**

```typescript
// backend/src/integrations/mercado-livre-oauth/callback-params.validator.spec.ts
import { validateCallbackParams } from './callback-params.validator';

describe('validateCallbackParams', () => {
  it('accepts state + code', () => {
    const result = validateCallbackParams({ state: 's', code: 'c' });
    expect(result).toEqual({ valid: true, state: 's', code: 'c', error: null });
  });

  it('accepts state + error (access_denied)', () => {
    const result = validateCallbackParams({ state: 's', error: 'access_denied' });
    expect(result).toEqual({ valid: true, state: 's', code: null, error: 'access_denied' });
  });

  it('accepts state + error + error_description + error_uri, but discards them from the result', () => {
    const result = validateCallbackParams({
      state: 's',
      error: 'access_denied',
      error_description: 'the user said no',
      error_uri: 'https://example.com/docs',
    });
    expect(result).toEqual({ valid: true, state: 's', code: null, error: 'access_denied' });
    expect(JSON.stringify(result)).not.toContain('the user said no');
  });

  it('rejects missing state', () => {
    expect(validateCallbackParams({ code: 'c' })).toEqual({ valid: false });
  });

  it('rejects both code and error present (never both)', () => {
    expect(
      validateCallbackParams({ state: 's', code: 'c', error: 'access_denied' }),
    ).toEqual({ valid: false });
  });

  it('rejects neither code nor error present', () => {
    expect(validateCallbackParams({ state: 's' })).toEqual({ valid: false });
  });

  it('rejects an array value for a repeated param (duplication)', () => {
    expect(
      validateCallbackParams({ state: ['a', 'b'], code: 'c' }),
    ).toEqual({ valid: false });
    expect(
      validateCallbackParams({ state: 's', code: ['a', 'b'] }),
    ).toEqual({ valid: false });
  });

  it('rejects an unexpected parameter', () => {
    expect(
      validateCallbackParams({ state: 's', code: 'c', unexpected: 'x' }),
    ).toEqual({ valid: false });
  });

  it('rejects error_description/error_uri sent alongside code (only valid alongside error)', () => {
    expect(
      validateCallbackParams({
        state: 's',
        code: 'c',
        error_description: 'x',
      }),
    ).toEqual({ valid: false });
  });

  it('rejects a state longer than 512 characters', () => {
    expect(
      validateCallbackParams({ state: 'x'.repeat(513), code: 'c' }),
    ).toEqual({ valid: false });
  });

  it('rejects a code longer than 2048 characters', () => {
    expect(
      validateCallbackParams({ state: 's', code: 'x'.repeat(2049) }),
    ).toEqual({ valid: false });
  });

  it('rejects an error_description longer than 1024 characters', () => {
    expect(
      validateCallbackParams({
        state: 's',
        error: 'access_denied',
        error_description: 'x'.repeat(1025),
      }),
    ).toEqual({ valid: false });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- callback-params.validator.spec.ts`
Expected: FAIL — `Cannot find module './callback-params.validator'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/callback-params.validator.ts
export type CallbackQuery = Record<string, string | string[] | undefined>;

export type CallbackParamsResult =
  | { valid: true; state: string; code: string; error: null }
  | { valid: true; state: string; code: null; error: string }
  | { valid: false };

const MAX_STATE_LENGTH = 512;
const MAX_CODE_LENGTH = 2048;
const MAX_ERROR_LENGTH = 128;
const MAX_ERROR_DESCRIPTION_LENGTH = 1024;
const MAX_ERROR_URI_LENGTH = 2048;
const ALLOWED_KEYS = new Set([
  'state',
  'code',
  'error',
  'error_description',
  'error_uri',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * design §6.2 passo 1: `state` obrigatório; exatamente um entre `code` e
 * `error`; `error_description`/`error_uri` só como complemento opcional de
 * `error`, validados só por tamanho e NUNCA propagados no resultado (nunca
 * logados/persistidos/redirecionados/em errorSummary ou exceções).
 */
export function validateCallbackParams(
  query: CallbackQuery,
): CallbackParamsResult {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_KEYS.has(key)) return { valid: false };
  }

  const state = query.state;
  const code = query.code;
  const error = query.error;
  const errorDescription = query.error_description;
  const errorUri = query.error_uri;

  if (!isNonEmptyString(state) || state.length > MAX_STATE_LENGTH) {
    return { valid: false };
  }

  const hasCode = isNonEmptyString(code);
  const hasError = isNonEmptyString(error);

  if (hasCode === hasError) return { valid: false }; // XOR

  if (hasCode) {
    if (errorDescription !== undefined || errorUri !== undefined) {
      return { valid: false };
    }
    if ((code as string).length > MAX_CODE_LENGTH) return { valid: false };
    return { valid: true, state, code: code as string, error: null };
  }

  if ((error as string).length > MAX_ERROR_LENGTH) return { valid: false };
  if (
    errorDescription !== undefined &&
    (typeof errorDescription !== 'string' ||
      errorDescription.length > MAX_ERROR_DESCRIPTION_LENGTH)
  ) {
    return { valid: false };
  }
  if (
    errorUri !== undefined &&
    (typeof errorUri !== 'string' || errorUri.length > MAX_ERROR_URI_LENGTH)
  ) {
    return { valid: false };
  }

  return { valid: true, state, code: null, error: error as string };
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- callback-params.validator.spec.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/callback-params.validator.ts backend/src/integrations/mercado-livre-oauth/callback-params.validator.spec.ts
git commit -m "feat(oauth): add callback query-param validator (state/code XOR error)"
```

---

## Task 18: `buildCallbackRedirectUrl` util

**Files:**
- Create: `backend/src/integrations/mercado-livre-oauth/callback-redirect-url.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/callback-redirect-url.spec.ts`

**Interfaces:**
- Consumes: `MercadoLivreOAuthPublicReason` (Task 2).
- Produces: `buildCallbackRedirectUrl(input: { frontendUrl: string; reason: 'success' | MercadoLivreOAuthPublicReason }): string` — consumed by Task 19.

- [ ] **Step 1: Write the failing test**

```typescript
// backend/src/integrations/mercado-livre-oauth/callback-redirect-url.spec.ts
import { buildCallbackRedirectUrl } from './callback-redirect-url';

describe('buildCallbackRedirectUrl', () => {
  it('builds a success URL pointing at the fixed /integracoes path', () => {
    const url = buildCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com',
      reason: 'success',
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://app.example.com');
    expect(parsed.pathname).toBe('/integracoes');
    expect(parsed.searchParams.get('ml')).toBe('success');
    expect(parsed.searchParams.get('reason')).toBe('success');
  });

  it('builds an error URL with ml=error and the given reason', () => {
    const url = buildCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com',
      reason: 'IDENTITY_MISMATCH',
    });
    const parsed = new URL(url);

    expect(parsed.searchParams.get('ml')).toBe('error');
    expect(parsed.searchParams.get('reason')).toBe('IDENTITY_MISMATCH');
  });

  it('ignores any path already present in frontendUrl — always /integracoes', () => {
    const url = buildCallbackRedirectUrl({
      frontendUrl: 'https://app.example.com/some/other/path',
      reason: 'success',
    });
    expect(new URL(url).pathname).toBe('/integracoes');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- callback-redirect-url.spec.ts`
Expected: FAIL — `Cannot find module './callback-redirect-url'`

- [ ] **Step 3: Implement**

```typescript
// backend/src/integrations/mercado-livre-oauth/callback-redirect-url.ts
import type { MercadoLivreOAuthPublicReason } from './callback-reason.mapper';

/**
 * Redirect final do callback (design §6.2 passo 13): sempre a URL fixa
 * `FRONTEND_URL/integracoes`, montada com a API `URL` (nunca concatenação de
 * strings), nunca um `returnUrl` arbitrário.
 */
export function buildCallbackRedirectUrl(input: {
  frontendUrl: string;
  reason: 'success' | MercadoLivreOAuthPublicReason;
}): string {
  const url = new URL('/integracoes', input.frontendUrl);
  url.searchParams.set('ml', input.reason === 'success' ? 'success' : 'error');
  url.searchParams.set('reason', input.reason);
  return url.toString();
}
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- callback-redirect-url.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/integrations/mercado-livre-oauth/callback-redirect-url.ts backend/src/integrations/mercado-livre-oauth/callback-redirect-url.spec.ts
git commit -m "feat(oauth): add buildCallbackRedirectUrl (fixed /integracoes target)"
```

---

## Task 19: 🔍 CALLBACK CHECKPOINT — `handleCallback` orchestration + `GET .../callback`

This is the central task of the whole feature: it wires together every failure branch from design §6.2 into one orchestrated method, using fakes for `MarketplaceAccountsService`/`OAuthAuthorizationRequestsService`/`AdvisoryLockService`/`MercadoLivreHttpClient`/`EncryptionService` (all already unit-tested in isolation by Tasks 6-15) plus one real-Postgres end-to-end test proving two concurrent callbacks on the same account don't corrupt state.

**Files:**
- Modify: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.ts` (add `handleCallback`)
- Modify: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.spec.ts` (add a new `describe('handleCallback')` block)
- Modify: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.ts` (add the `callback` route)
- Modify: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.controller.spec.ts`
- Create: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-callback.integration.spec.ts` (real Postgres, two concurrent callbacks)

**Interfaces:**
- Produces: `MercadoLivreOAuthService.handleCallback(query: CallbackQuery): Promise<{ redirectUrl: string }>` — NEVER throws, for an expected OAuth flow outcome OR for a genuinely unexpected internal error (design §6.2: "Redireciona sempre" — a top-level `try/catch` guarantees this so the browser coming back from Mercado Livre never sees a raw `500`). Produces `GET integrations/mercado-livre/callback` (no guard — design §6.2, authorized only by `state`), which always responds with a `302` redirect, never a JSON error body.
- Produces: `MercadoLivreOAuthService`'s private `applyConnectionAndFinalizeAtomically(input): Promise<'applied' | 'version_conflict' | 'external_seller_conflict' | 'request_not_processing'>` — the account CAS (`MarketplaceAccountsService.applySuccessfulConnection`, Task 15, called with a shared `QueryRunner`) and the `oauth_authorization_requests` `PROCESSING → SUCCESS` write happen in ONE transaction, committed only if both affect exactly one row (design §6.2 step 11: "Mesma transação... rollback completo"); any exception from either write rolls back (if the transaction is still active) and always releases the `QueryRunner` exactly once. This uses the `DataSource` already injected as the 7th constructor parameter since Task 16 — no constructor change happens in this task.

- [ ] **Step 1: Write the failing unit tests — one per branch of design §6.2**

Add to `mercado-livre-oauth.service.spec.ts` a helper factory and a `describe('handleCallback')` block:

```typescript
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';

interface FakeQueryRunner {
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  query: jest.Mock;
  readonly isTransactionActive: boolean;
}

// `isTransactionActive` replica o campo real de `QueryRunner`: começa
// `false`, vira `true` quando `startTransaction()` resolve, e volta a
// `false` quando `commitTransaction()`/`rollbackTransaction()` resolve —
// exatamente o que `applyConnectionAndFinalizeAtomically` inspeciona antes
// de decidir se chama `rollbackTransaction()` em seu `catch`. Overrides que
// substituem `startTransaction`/`commitTransaction`/`rollbackTransaction`
// por um mock que rejeita (para simular exceção) preservam esse
// comportamento por padrão — a implementação de overrides fica responsável
// por deixar `isTransactionActive` num estado coerente com o que o mock
// simula (ver testes de injeção de exceção abaixo).
function makeFakeQueryRunner(
  overrides: Partial<Omit<FakeQueryRunner, 'isTransactionActive'>> = {},
): FakeQueryRunner {
  const state = { active: false };
  const runner = {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockImplementation(async () => {
      state.active = true;
    }),
    commitTransaction: jest.fn().mockImplementation(async () => {
      state.active = false;
    }),
    rollbackTransaction: jest.fn().mockImplementation(async () => {
      state.active = false;
    }),
    release: jest.fn().mockResolvedValue(undefined),
    // Resultado padrão: o UPDATE de oauth_authorization_requests (a única
    // query que a implementação real dispara diretamente neste QueryRunner
    // — `applySuccessfulConnection` é um mock à parte, não toca nele de
    // verdade) afeta 1 linha, simulando PROCESSING → SUCCESS bem-sucedido.
    query: jest.fn().mockResolvedValue([{ id: 'req-1' }]),
    ...overrides,
  };
  return Object.defineProperty(runner, 'isTransactionActive', {
    get: () => state.active,
    enumerable: true,
  }) as FakeQueryRunner;
}

interface Collaborators {
  marketplaceAccountsService: {
    findByIdOrFail: jest.Mock;
    findByMarketplaceAndExternalSellerId: jest.Mock;
    applySuccessfulConnection: jest.Mock;
    markError: jest.Mock;
  };
  authorizationRequestsService: {
    claimByState: jest.Mock;
    finalizeFailure: jest.Mock;
  };
  advisoryLockService: { tryAcquire: jest.Mock };
  httpClient: { exchangeCode: jest.Mock; fetchIdentity: jest.Mock };
  encryptionService: { encrypt: jest.Mock; decrypt: jest.Mock };
  configService: ConfigService;
  dataSource: { createQueryRunner: jest.Mock };
  queryRunner: FakeQueryRunner;
}

function claimedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    marketplaceAccountId: 'acc-1',
    initiatedByUserId: 'user-1',
    encryptedCodeVerifier: 'iv:tag:verifier',
    ...overrides,
  };
}

function makeCollaborators(): Collaborators {
  const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
  const queryRunner = makeFakeQueryRunner();
  return {
    marketplaceAccountsService: {
      findByIdOrFail: jest.fn().mockResolvedValue(account()),
      findByMarketplaceAndExternalSellerId: jest.fn().mockResolvedValue(null),
      applySuccessfulConnection: jest.fn().mockResolvedValue('applied'),
      markError: jest.fn().mockResolvedValue(true),
    },
    authorizationRequestsService: {
      claimByState: jest.fn().mockResolvedValue(claimedRequest()),
      finalizeFailure: jest.fn().mockResolvedValue(true),
    },
    advisoryLockService: {
      tryAcquire: jest.fn().mockResolvedValue(lockHandle),
    },
    httpClient: {
      exchangeCode: jest.fn().mockResolvedValue({
        kind: 'success',
        token: {
          accessToken: 'APP_USR-1',
          refreshToken: 'TG-1',
          expiresInSeconds: 10800,
          userId: 42,
          tokenType: 'bearer',
          scope: 'offline_access read',
        },
      }),
      fetchIdentity: jest.fn().mockResolvedValue({ kind: 'success', externalUserId: 42 }),
    },
    encryptionService: {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn(() => 'plain-code-verifier'),
    },
    configService: {
      getOrThrow: (key: string) =>
        ({ FRONTEND_URL: 'https://app.example.com' } as Record<string, string>)[key],
    } as unknown as ConfigService,
    dataSource: { createQueryRunner: jest.fn().mockReturnValue(queryRunner) },
    queryRunner,
  };
}

function buildService(c: Collaborators) {
  return new MercadoLivreOAuthService(
    c.marketplaceAccountsService as never,
    c.authorizationRequestsService as never,
    c.advisoryLockService as never,
    c.httpClient as never,
    c.encryptionService as never,
    c.configService,
    c.dataSource as never,
  );
}

describe('MercadoLivreOAuthService.handleCallback', () => {
  it('redirects to OAUTH_CALLBACK_INVALID on malformed params (missing state)', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ code: 'c' });

    expect(redirectUrl).toContain('reason=OAUTH_CALLBACK_INVALID');
    expect(c.authorizationRequestsService.claimByState).not.toHaveBeenCalled();
  });

  it('redirects to OAUTH_CALLBACK_INVALID when the state cannot be claimed (unknown/expired/reused)', async () => {
    const c = makeCollaborators();
    c.authorizationRequestsService.claimByState.mockResolvedValue(null);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(redirectUrl).toContain('reason=OAUTH_CALLBACK_INVALID');
  });

  it('claims the state BEFORE interpreting error=access_denied, then finalizes FAILED/AUTHORIZATION_DENIED', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      error: 'access_denied',
    });

    expect(c.authorizationRequestsService.claimByState).toHaveBeenCalledWith('s');
    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'AUTHORIZATION_DENIED',
    );
    expect(redirectUrl).toContain('reason=AUTHORIZATION_DENIED');
    expect(c.advisoryLockService.tryAcquire).not.toHaveBeenCalled();
  });

  it('maps any other provider error to FAILED/AUTHORIZATION_PROVIDER_ERROR -> OAUTH_CALLBACK_INVALID', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({
      state: 's',
      error: 'server_error',
    });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'AUTHORIZATION_PROVIDER_ERROR',
    );
    expect(redirectUrl).toContain('reason=OAUTH_CALLBACK_INVALID');
  });

  it('finalizes FAILED/ACCOUNT_BUSY and redirects to TRY_AGAIN_LATER when the advisory lock is not acquired', async () => {
    const c = makeCollaborators();
    c.advisoryLockService.tryAcquire.mockResolvedValue(null);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_BUSY',
    );
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
    expect(c.httpClient.exchangeCode).not.toHaveBeenCalled();
  });

  it('finalizes FAILED/CREDENTIAL_DECRYPTION_FAILED when the stored code_verifier cannot be decrypted, releases the lock', async () => {
    const c = makeCollaborators();
    c.encryptionService.decrypt.mockImplementation(() => {
      throw new Error('bad auth tag');
    });
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'CREDENTIAL_DECRYPTION_FAILED',
    );
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it.each([
    ['definitive_error', 'TOKEN_EXCHANGE_FAILED'],
    ['client_configuration_error', 'TOKEN_EXCHANGE_FAILED'],
    ['unknown_result', 'CALLBACK_RESULT_UNKNOWN'],
    ['invalid_response', 'INVALID_TOKEN_RESPONSE'],
  ] as const)('maps exchangeCode outcome %s to failureCode %s', async (kind, failureCode) => {
    const c = makeCollaborators();
    c.httpClient.exchangeCode.mockResolvedValue({ kind });
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      failureCode,
    );
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('never resends the same code: exchangeCode is called at most once per callback', async () => {
    const c = makeCollaborators();
    c.httpClient.exchangeCode.mockResolvedValue({ kind: 'unknown_result' });
    const service = buildService(c);

    await service.handleCallback({ state: 's', code: 'c' });

    expect(c.httpClient.exchangeCode).toHaveBeenCalledTimes(1);
  });

  it('finalizes FAILED/IDENTITY_LOOKUP_FAILED when /users/me fails, never persists tokens', async () => {
    const c = makeCollaborators();
    c.httpClient.fetchIdentity.mockResolvedValue({ kind: 'failure' });
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'IDENTITY_LOOKUP_FAILED',
    );
    expect(c.marketplaceAccountsService.applySuccessfulConnection).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('finalizes FAILED/IDENTITY_MISMATCH when /users/me id differs from the token user_id', async () => {
    const c = makeCollaborators();
    c.httpClient.fetchIdentity.mockResolvedValue({ kind: 'success', externalUserId: 999 });
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'IDENTITY_MISMATCH',
    );
    expect(redirectUrl).toContain('reason=IDENTITY_MISMATCH');
  });

  it('reconnection: accepts when the returned identity matches the account\'s existing externalSellerId', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({ externalSellerId: '42', status: MarketplaceAccountStatus.TOKEN_EXPIRED }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.marketplaceAccountsService.applySuccessfulConnection).toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=success');
  });

  it('reconnection: rejects with IDENTITY_MISMATCH when the returned identity differs, preserves the original account', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({ externalSellerId: '777', status: MarketplaceAccountStatus.TOKEN_EXPIRED }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'IDENTITY_MISMATCH',
    );
    expect(c.marketplaceAccountsService.applySuccessfulConnection).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=IDENTITY_MISMATCH');
  });

  it('duplicate externalSellerId (pre-check): marks the attempt FAILED/ACCOUNT_ALREADY_CONNECTED and the target account ERROR, never touches the winning account', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByMarketplaceAndExternalSellerId.mockResolvedValue(
      account({ id: 'other-acc', externalSellerId: '42' }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_ALREADY_CONNECTED',
    );
    expect(c.marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-1', failureCode: 'ACCOUNT_ALREADY_CONNECTED' }),
    );
    expect(c.marketplaceAccountsService.applySuccessfulConnection).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=ACCOUNT_ALREADY_CONNECTED');
  });

  it('duplicate externalSellerId (race at CAS time): maps external_seller_conflict the same way as the pre-check', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.applySuccessfulConnection.mockResolvedValue(
      'external_seller_conflict',
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_ALREADY_CONNECTED',
    );
    expect(redirectUrl).toContain('reason=ACCOUNT_ALREADY_CONNECTED');
  });

  it('revalidates the account\'s marketplace after re-reading it post-lock: a non-MERCADO_LIVRE account finalizes FAILED/ACCOUNT_STATE_CONFLICT WITHOUT calling the ML (design §6.2 hardening — this is the vocabulary entry\'s only call site)', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      account({ marketplace: Marketplace.AMAZON }),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'ACCOUNT_STATE_CONFLICT',
    );
    expect(c.httpClient.exchangeCode).not.toHaveBeenCalled();
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('finalizes FAILED/TOKEN_RESULT_NOT_COMMITTED on a version_conflict CAS result, opens no lasting transaction (rolled back), never retries', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.applySuccessfulConnection.mockResolvedValue(
      'version_conflict',
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'TOKEN_RESULT_NOT_COMMITTED',
    );
    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(c.marketplaceAccountsService.applySuccessfulConnection).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('finalizes FAILED/TOKEN_RESULT_NOT_COMMITTED when the account CAS applies but the paired request-finalization UPDATE affects zero rows (request_not_processing) — proves the two writes are NOT independently committed', async () => {
    const c = makeCollaborators();
    c.queryRunner.query.mockResolvedValue([]); // 0 linhas: a tentativa não estava mais PROCESSING
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalled();
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(c.authorizationRequestsService.finalizeFailure).toHaveBeenCalledWith(
      'req-1',
      'TOKEN_RESULT_NOT_COMMITTED',
    );
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by the account CAS (applySuccessfulConnection) rolls back the shared transaction and releases the QueryRunner exactly once, never leaves it dangling', async () => {
    const c = makeCollaborators();
    c.marketplaceAccountsService.applySuccessfulConnection.mockRejectedValue(
      new Error('cas boom'),
    );
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by the PROCESSING→SUCCESS UPDATE rolls back the shared transaction and releases the QueryRunner exactly once', async () => {
    const c = makeCollaborators();
    c.queryRunner.query.mockRejectedValue(new Error('update boom'));
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by commitTransaction still rolls back (a failed COMMIT leaves the transaction active in real TypeORM/Postgres — isTransactionActive is only set false by a COMMIT that resolves) and releases the QueryRunner exactly once', async () => {
    const c = makeCollaborators();
    c.queryRunner.commitTransaction.mockRejectedValue(new Error('commit boom'));
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by queryRunner.connect() never opens a transaction (no rollback attempted) but still releases the QueryRunner exactly once, and the callback still redirects (never throws to the caller)', async () => {
    const c = makeCollaborators();
    const connectError = new Error('connection reset');
    c.queryRunner.connect.mockRejectedValue(connectError);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.queryRunner.startTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('an exception thrown by queryRunner.startTransaction() never leaves isTransactionActive true (no rollback attempted) but still releases the QueryRunner exactly once, and the callback still redirects', async () => {
    const c = makeCollaborators();
    const startTransactionError = new Error('could not start transaction');
    c.queryRunner.startTransaction.mockRejectedValue(startTransactionError);
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.marketplaceAccountsService.applySuccessfulConnection).not.toHaveBeenCalled();
    expect(c.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });

  it('happy path: applies the connection and the request finalization in ONE transaction (shared QueryRunner), commits once, redirects to reason=success, releases the lock', async () => {
    const c = makeCollaborators();
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(c.dataSource.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(c.marketplaceAccountsService.applySuccessfulConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'acc-1',
        externalSellerId: '42',
        encryptedAccessToken: 'enc:APP_USR-1',
        encryptedRefreshToken: 'enc:TG-1',
        connectedByUserId: 'user-1',
      }),
      c.queryRunner, // MESMO QueryRunner passado para o UPDATE de oauth_authorization_requests
    );
    expect(c.queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'SUCCESS'"),
      ['req-1'],
    );
    expect(c.queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(c.queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(c.queryRunner.release).toHaveBeenCalledTimes(1);
    expect(redirectUrl).toContain('reason=success');
  });

  it('threads a null connectedByUserId through when the original OAuthAuthorizationRequest.initiatedByUserId is null (FK ON DELETE SET NULL — design §6.2/§4)', async () => {
    const c = makeCollaborators();
    c.authorizationRequestsService.claimByState.mockResolvedValue(
      claimedRequest({ initiatedByUserId: null }),
    );
    const service = buildService(c);

    await service.handleCallback({ state: 's', code: 'c' });

    expect(c.marketplaceAccountsService.applySuccessfulConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connectedByUserId: null }),
      c.queryRunner,
    );
  });

  it('always releases the advisory lock AND still redirects (never throws / never a raw 500) even when a downstream step fails unexpectedly', async () => {
    const c = makeCollaborators();
    c.httpClient.fetchIdentity.mockRejectedValue(new Error('unexpected'));
    const service = buildService(c);
    const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
    c.advisoryLockService.tryAcquire.mockResolvedValue(lockHandle);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
    expect(lockHandle.release).toHaveBeenCalled();
  });

  it('never throws even for an error raised before the lock is acquired (e.g. claimByState itself failing) — always redirects', async () => {
    const c = makeCollaborators();
    c.authorizationRequestsService.claimByState.mockRejectedValue(new Error('db down'));
    const service = buildService(c);

    const { redirectUrl } = await service.handleCallback({ state: 's', code: 'c' });

    expect(redirectUrl).toContain('reason=TRY_AGAIN_LATER');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-oauth.service.spec.ts`
Expected: FAIL — `service.handleCallback is not a function`

- [ ] **Step 3: Add a `Logger` field, implement `handleCallback` + the private `applyConnectionAndFinalizeAtomically`**

`@InjectDataSource() private readonly dataSource: DataSource` já existe no construtor desde a Task 16 (não usado até agora) — não redeclare o construtor aqui, só adicione o campo `logger` e os métodos abaixo à classe existente. Isso mantém a assinatura do construtor idêntica (7 parâmetros, mesma ordem) do começo ao fim do plano — nenhum call site precisa mudar entre a Task 16 e esta.

```typescript
// Add/adjust these imports at the top of mercado-livre-oauth.service.ts:
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { redactSensitiveData } from '../../common/logging/redact.util';
import type { CallbackQuery } from './callback-params.validator';
import { validateCallbackParams } from './callback-params.validator';
import { buildCallbackRedirectUrl } from './callback-redirect-url';
import { mapFailureCodeToPublicReason } from './callback-reason.mapper';
import type { MercadoLivreOAuthFailureCode } from './mercado-livre-oauth-failure-code';

// Add a logger field to the existing class (constructor from Task 16 is unchanged):
@Injectable()
export class MercadoLivreOAuthService {
  private readonly logger = new Logger(MercadoLivreOAuthService.name);

  // ...(constructor and startConnection from Task 16 unchanged)...

  async handleCallback(query: CallbackQuery): Promise<{ redirectUrl: string }> {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const redirect = (reason: 'success' | ReturnType<typeof mapFailureCodeToPublicReason>) =>
      ({ redirectUrl: buildCallbackRedirectUrl({ frontendUrl, reason }) });

    try {
      const parsed = validateCallbackParams(query);
      if (!parsed.valid) return redirect('OAUTH_CALLBACK_INVALID');

      const claimed = await this.authorizationRequestsService.claimByState(parsed.state);
      if (!claimed) return redirect('OAUTH_CALLBACK_INVALID');

      if (parsed.error !== null) {
        const failureCode: MercadoLivreOAuthFailureCode =
          parsed.error === 'access_denied'
            ? 'AUTHORIZATION_DENIED'
            : 'AUTHORIZATION_PROVIDER_ERROR';
        await this.authorizationRequestsService.finalizeFailure(claimed.id, failureCode);
        return redirect(mapFailureCodeToPublicReason(failureCode));
      }

      const code = parsed.code as string;
      const lock = await this.advisoryLockService.tryAcquire(claimed.marketplaceAccountId);
      if (!lock) {
        await this.authorizationRequestsService.finalizeFailure(claimed.id, 'ACCOUNT_BUSY');
        return redirect(mapFailureCodeToPublicReason('ACCOUNT_BUSY'));
      }

      try {
        const account = await this.marketplaceAccountsService.findByIdOrFail(
          claimed.marketplaceAccountId,
        );
        const expectedTokenVersion = account.tokenVersion;

        // Revalidação pós-lock (design §6.2 hardening): a conta pode, em
        // teoria, ter mudado entre a criação da tentativa e este ponto.
        // Só o marketplace é checável de forma significativa aqui — os
        // demais campos relevantes (identidade, token_version) já são
        // protegidos pelo CAS mais abaixo.
        if (account.marketplace !== Marketplace.MERCADO_LIVRE) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'ACCOUNT_STATE_CONFLICT',
          );
          return redirect(mapFailureCodeToPublicReason('ACCOUNT_STATE_CONFLICT'));
        }

        let codeVerifier: string;
        try {
          codeVerifier = this.encryptionService.decrypt(
            claimed.encryptedCodeVerifier as string,
          );
        } catch {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'CREDENTIAL_DECRYPTION_FAILED',
          );
          return redirect(mapFailureCodeToPublicReason('CREDENTIAL_DECRYPTION_FAILED'));
        }

        const exchange = await this.httpClient.exchangeCode({ code, codeVerifier });
        if (exchange.kind !== 'success') {
          // `definitive_error` (invalid_grant) e `client_configuration_error`
          // (invalid_client) são ambos tratados como falha DEFINITIVA da
          // troca no callback (design §6.2 passo 7 cita os dois lado a
          // lado) — a distinção entre eles só importa no refresh (Task 20),
          // onde `client_configuration_error` NUNCA pode virar TOKEN_EXPIRED.
          const failureCode: MercadoLivreOAuthFailureCode =
            exchange.kind === 'definitive_error' || exchange.kind === 'client_configuration_error'
              ? 'TOKEN_EXCHANGE_FAILED'
              : exchange.kind === 'invalid_response'
                ? 'INVALID_TOKEN_RESPONSE'
                : 'CALLBACK_RESULT_UNKNOWN';
          await this.authorizationRequestsService.finalizeFailure(claimed.id, failureCode);
          return redirect(mapFailureCodeToPublicReason(failureCode));
        }

        const identity = await this.httpClient.fetchIdentity(exchange.token.accessToken);
        if (identity.kind !== 'success') {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'IDENTITY_LOOKUP_FAILED',
          );
          return redirect(mapFailureCodeToPublicReason('IDENTITY_LOOKUP_FAILED'));
        }

        if (identity.externalUserId !== exchange.token.userId) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'IDENTITY_MISMATCH',
          );
          return redirect(mapFailureCodeToPublicReason('IDENTITY_MISMATCH'));
        }

        const externalSellerId = String(identity.externalUserId);

        if (
          account.externalSellerId !== null &&
          account.externalSellerId !== externalSellerId
        ) {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'IDENTITY_MISMATCH',
          );
          return redirect(mapFailureCodeToPublicReason('IDENTITY_MISMATCH'));
        }

        if (account.externalSellerId === null) {
          const existing =
            await this.marketplaceAccountsService.findByMarketplaceAndExternalSellerId(
              Marketplace.MERCADO_LIVRE,
              externalSellerId,
            );
          if (existing && existing.id !== account.id) {
            await this.authorizationRequestsService.finalizeFailure(
              claimed.id,
              'ACCOUNT_ALREADY_CONNECTED',
            );
            await this.marketplaceAccountsService.markError({
              id: account.id,
              expectedTokenVersion,
              failureCode: 'ACCOUNT_ALREADY_CONNECTED',
              errorSummary:
                'Esta conta do Mercado Livre já está conectada em outro registro.',
            });
            return redirect(mapFailureCodeToPublicReason('ACCOUNT_ALREADY_CONNECTED'));
          }
        }

        // ÚNICA escrita de "sucesso": CAS da conta + PROCESSING→SUCCESS da
        // tentativa, na MESMA transação (design §6.2 passo 11).
        const outcome = await this.applyConnectionAndFinalizeAtomically({
          accountId: account.id,
          expectedTokenVersion,
          externalSellerId,
          encryptedAccessToken: this.encryptionService.encrypt(exchange.token.accessToken),
          encryptedRefreshToken: this.encryptionService.encrypt(exchange.token.refreshToken),
          tokenExpiresAt: new Date(Date.now() + exchange.token.expiresInSeconds * 1000),
          connectedByUserId: claimed.initiatedByUserId,
          authorizationRequestId: claimed.id,
        });

        if (outcome === 'external_seller_conflict') {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'ACCOUNT_ALREADY_CONNECTED',
          );
          await this.marketplaceAccountsService.markError({
            id: account.id,
            expectedTokenVersion,
            failureCode: 'ACCOUNT_ALREADY_CONNECTED',
            errorSummary:
              'Esta conta do Mercado Livre já está conectada em outro registro.',
          });
          return redirect(mapFailureCodeToPublicReason('ACCOUNT_ALREADY_CONNECTED'));
        }

        if (outcome === 'version_conflict' || outcome === 'request_not_processing') {
          await this.authorizationRequestsService.finalizeFailure(
            claimed.id,
            'TOKEN_RESULT_NOT_COMMITTED',
          );
          return redirect(mapFailureCodeToPublicReason('TOKEN_RESULT_NOT_COMMITTED'));
        }

        return redirect('success');
      } finally {
        await lock.release();
      }
    } catch (error) {
      // design §6.2: "Redireciona sempre" — mesmo um erro interno
      // inesperado (ex.: conexão com o banco caiu) nunca vira um 500 cru
      // para o navegador voltando do Mercado Livre. Mensagem estática ao
      // usuário; o detalhe (sanitizado — nunca segredo bruto) só vai para
      // o log interno.
      this.logger.error('mercado_livre_callback_unexpected_error', {
        message: redactSensitiveData(
          error instanceof Error ? error.message : 'erro desconhecido',
        ),
      });
      return redirect('TRY_AGAIN_LATER');
    }
  }

  /**
   * CAS da `MarketplaceAccount` + `oauth_authorization_requests`
   * `PROCESSING → SUCCESS`, na mesma transação (design §6.2 passo 11).
   * `applySuccessfulConnection` (Task 15) recebe este `QueryRunner`
   * compartilhado — não gerencia commit/rollback quando recebe um.
   */
  private async applyConnectionAndFinalizeAtomically(input: {
    accountId: string;
    expectedTokenVersion: number;
    externalSellerId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    tokenExpiresAt: Date;
    connectedByUserId: string | null;
    authorizationRequestId: string;
  }): Promise<
    'applied' | 'version_conflict' | 'external_seller_conflict' | 'request_not_processing'
  > {
    // `connect()`/`startTransaction()` ficam DENTRO do try: se qualquer um
    // dos dois lançar, o `finally` abaixo ainda libera o QueryRunner
    // exatamente uma vez (item 2 da segunda revisão) — antes, uma falha em
    // `connect()`/`startTransaction()` pulava o `finally` e vazava a
    // conexão dedicada.
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const accountOutcome = await this.marketplaceAccountsService.applySuccessfulConnection(
        {
          id: input.accountId,
          expectedTokenVersion: input.expectedTokenVersion,
          externalSellerId: input.externalSellerId,
          encryptedAccessToken: input.encryptedAccessToken,
          encryptedRefreshToken: input.encryptedRefreshToken,
          tokenExpiresAt: input.tokenExpiresAt,
          connectedByUserId: input.connectedByUserId,
        },
        queryRunner,
      );

      if (accountOutcome !== 'applied') {
        await queryRunner.rollbackTransaction();
        return accountOutcome;
      }

      const requestRows = (await queryRunner.query(
        `UPDATE oauth_authorization_requests
            SET status = 'SUCCESS', completed_at = now(), failure_code = NULL, encrypted_code_verifier = NULL
          WHERE id = $1 AND status = 'PROCESSING'
          RETURNING id`,
        [input.authorizationRequestId],
      )) as Array<{ id: string }>;

      if (requestRows.length !== 1) {
        await queryRunner.rollbackTransaction();
        return 'request_not_processing';
      }

      await queryRunner.commitTransaction();
      return 'applied';
    } catch (error) {
      // Uma exceção lançada pelo CAS (`applySuccessfulConnection`) ou pelo
      // `UPDATE` de finalização chegava direto ao `finally` sem rollback
      // explícito (item 5 da revisão) — a transação ficava aberta até o
      // `release()` devolver a conexão ao pool ainda com trabalho não
      // commitado nela. `isTransactionActive` evita chamar
      // `rollbackTransaction()` numa transação que já foi finalizada por um
      // dos `return`s acima (aqueles já fazem seu próprio rollback).
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch {
          // Falha no próprio rollback não pode mascarar o erro original
          // que causou a falha da transação — ele é relançado abaixo mesmo
          // assim.
        }
      }
      throw error;
    } finally {
      try {
        await queryRunner.release();
      } catch {
        // Idem: uma falha na liberação não pode suprimir o erro (ou o
        // resultado) que já está sendo propagado/retornado.
      }
    }
  }
```

- [ ] **Step 4: Run it, confirm all unit tests pass**

Run: `cd backend && npm test -- mercado-livre-oauth.service.spec.ts`
Expected: PASS (every `startConnection` test from Task 16 plus every `handleCallback` test above).

- [ ] **Step 5: Write the failing controller test for the callback route**

Add to `mercado-livre-oauth.controller.spec.ts`:

```typescript
  it('callback: redirects (302) to whatever URL the service returns, never a JSON body', async () => {
    const service = {
      handleCallback: jest.fn().mockResolvedValue({
        redirectUrl: 'https://app.example.com/integracoes?ml=success&reason=success',
      }),
    };
    const controller = new MercadoLivreOAuthController(service as never);
    const res = { redirect: jest.fn() };

    await controller.callback({ state: 's', code: 'c' }, res as never);

    expect(service.handleCallback).toHaveBeenCalledWith({ state: 's', code: 'c' });
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://app.example.com/integracoes?ml=success&reason=success',
    );
  });
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-oauth.controller.spec.ts`
Expected: FAIL — `controller.callback is not a function`

- [ ] **Step 7: Implement (add to the same controller from Task 16 — no `AccessTokenGuard`, design §6.2)**

```typescript
// Add these imports to mercado-livre-oauth.controller.ts:
import { Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { CallbackQuery } from './callback-params.validator';

// Add this method inside MercadoLivreOAuthController:
  @Get('integrations/mercado-livre/callback')
  async callback(
    @Query() query: CallbackQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { redirectUrl } = await this.service.handleCallback(query);
    res.redirect(302, redirectUrl);
  }
```

- [ ] **Step 8: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-oauth.controller.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: 🔍 Write and run real-Postgres integration tests — concurrency, atomicity, and replay**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-callback.integration.spec.ts
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from './advisory-lock.service';
import { MercadoLivreOAuthService } from './mercado-livre-oauth.service';
import { OAuthAuthorizationRequest } from './oauth-authorization-request.entity';
import { OAuthAuthorizationRequestsService } from './oauth-authorization-requests.service';

function fakeConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    FRONTEND_URL: 'https://app.example.com',
    ML_ACCOUNT_LOCK_WAIT_MS: 2000,
    CREDENTIAL_ENCRYPTION_KEY:
      '3132333435363738393031323334353637383930313233343536373839303a',
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
    dataSource = await createTestDataSource([OAuthAuthorizationRequest, MarketplaceAccount]);

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
    const advisoryLockService = new AdvisoryLockService(dataSource, configService);
    const httpClient = {
      exchangeCode: async () => ({
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
      fetchIdentity: async () => ({ kind: 'success' as const, externalUserId: 555 }),
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

    const reasons = [first.redirectUrl, second.redirectUrl].map(
      (url) => new URL(url).searchParams.get('reason'),
    );
    expect(reasons.filter((r) => r === 'success')).toHaveLength(1);
    expect(reasons.filter((r) => r === 'OAUTH_CALLBACK_INVALID')).toHaveLength(1);

    const rows = await dataSource.query(
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
    const first = await service.handleCallback({ state: pending.state, code: 'c' });
    expect(new URL(first.redirectUrl).searchParams.get('reason')).toBe('success');

    const beforeReplay = await dataSource.query(
      'SELECT status, token_version FROM marketplace_accounts WHERE id = $1',
      [accountId],
    );

    const replay = await service.handleCallback({ state: pending.state, code: 'c' });
    expect(new URL(replay.redirectUrl).searchParams.get('reason')).toBe(
      'OAUTH_CALLBACK_INVALID',
    );

    const afterReplay = await dataSource.query(
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
    const first = await service.handleCallback({ state: pending.state, error: 'access_denied' });
    expect(new URL(first.redirectUrl).searchParams.get('reason')).toBe('AUTHORIZATION_DENIED');

    const replay = await service.handleCallback({ state: pending.state, code: 'c' });
    expect(new URL(replay.redirectUrl).searchParams.get('reason')).toBe(
      'OAUTH_CALLBACK_INVALID',
    );

    const rows = await dataSource.query(
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
    const claimed = await authorizationRequestsService.claimByState(pending.state);
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
    const account = await dataSource.query(
      'SELECT token_version FROM marketplace_accounts WHERE id = $1',
      [accountId],
    );
    const outcome = await (service as unknown as {
      applyConnectionAndFinalizeAtomically: (input: unknown) => Promise<string>;
    }).applyConnectionAndFinalizeAtomically({
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

    const rows = await dataSource.query(
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

    const result = await service.handleCallback({ state: pending.state, code: 'c' });
    expect(new URL(result.redirectUrl).searchParams.get('reason')).toBe(
      'ACCOUNT_ALREADY_CONNECTED',
    );

    const winnerRow = await dataSource.query(
      'SELECT status, encrypted_access_token, token_version FROM marketplace_accounts WHERE id = $1',
      [winnerId],
    );
    expect(winnerRow[0].status).toBe('CONNECTED');
    expect(winnerRow[0].encrypted_access_token).toBe('enc:winner-a');
    expect(winnerRow[0].token_version).toBe(3); // intocado

    const loserRow = await dataSource.query(
      'SELECT status FROM marketplace_accounts WHERE id = $1',
      [loserId],
    );
    expect(loserRow[0].status).toBe('ERROR');
  });
});
```

Note on the "callback racing against refresh, same advisory lock" scenario from design §9: that test needs `MercadoLivreOAuthService.ensureValidAccessToken`, which doesn't exist until Task 20 — it's written there (Task 20's own real-Postgres integration test), not duplicated here, purely for TDD ordering (you can't test a method before it exists).

Run: `cd backend && CREDENTIAL_ENCRYPTION_KEY="3132333435363738393031323334353637383930313233343536373839303a" TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- mercado-livre-oauth-callback.integration.spec.ts`
Expected: PASS (every test above) — the first test's mutual exclusion comes from `claimByState`'s atomic `UPDATE ... WHERE status='PENDING'`, which can only match once under concurrent execution (Postgres row-level locking serializes the two statements).

- [ ] **Step 10: Run the full backend suite once more to confirm nothing regressed**

Run: `cd backend && TEST_DATABASE_URL="$TEST_DATABASE_URL" CREDENTIAL_ENCRYPTION_KEY="3132333435363738393031323334353637383930313233343536373839303a" npm test`
Expected: PASS (every suite)

- [ ] **Step 11: 🔍 Commit (checkpoint — review the whole callback flow against design §6.2 before moving on)**

```bash
git add backend/src/integrations/mercado-livre-oauth/
git commit -m "feat(oauth): implement handleCallback orchestration + GET .../callback (design §6.2)"
```

## Task 20: 🔍 TOKENS CHECKPOINT — `ensureValidAccessToken` + `refreshAccessToken` (design §6.4)

**Files:**
- Modify: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.ts` (add `ensureValidAccessToken` + a private `assertEligibleForToken`/`isWithinLeeway`)
- Modify: `backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth.service.spec.ts`

**Interfaces:**
- Produces: `MercadoLivreOAuthService.ensureValidAccessToken(accountId: string): Promise<string>` (throws `ConflictException` with one of `ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN`/`ACCOUNT_BUSY`/`CREDENTIAL_DECRYPTION_FAILED`/`REFRESH_TOKEN_REJECTED`/`REFRESH_RESULT_UNKNOWN`/`REFRESH_RESULT_NOT_COMMITTED` on failure) — consumed by Task 22's renewal job and reserved for future sync code (design §3, "reservado para uso futuro").

- [ ] **Step 1: Write the failing tests — one per branch of design §6.4**

Add to `mercado-livre-oauth.service.spec.ts`:

```typescript
function connectedAccount(overrides: Partial<MarketplaceAccount> = {}): MarketplaceAccount {
  return account({
    status: MarketplaceAccountStatus.CONNECTED,
    externalSellerId: '42',
    encryptedAccessToken: 'enc:old-access',
    encryptedRefreshToken: 'enc:old-refresh',
    tokenExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // dentro da janela padrão de leeway (15min)
    tokenVersion: 3,
    ...overrides,
  });
}

describe('MercadoLivreOAuthService.ensureValidAccessToken', () => {
  function makeTokenCollaborators() {
    const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
    return {
      marketplaceAccountsService: {
        findByIdOrFail: jest.fn().mockResolvedValue(connectedAccount()),
        applyRefreshedTokens: jest.fn().mockResolvedValue(true),
        markTokenExpired: jest.fn().mockResolvedValue(true),
        markError: jest.fn().mockResolvedValue(true),
      },
      authorizationRequestsService: {},
      advisoryLockService: { tryAcquire: jest.fn().mockResolvedValue(lockHandle) },
      httpClient: {
        refreshToken: jest.fn().mockResolvedValue({
          kind: 'success',
          token: {
            accessToken: 'APP_USR-new',
            refreshToken: 'TG-new',
            expiresInSeconds: 10800,
            userId: 42,
            tokenType: 'bearer',
            scope: 'offline_access read',
          },
        }),
      },
      encryptionService: {
        encrypt: jest.fn((v: string) => `enc:${v}`),
        decrypt: jest.fn((v: string) => v.replace('enc:', '')),
      },
      configService: {
        getOrThrow: () => undefined,
        get: (key: string, fallback?: unknown) =>
          key === 'ML_TOKEN_REFRESH_LEEWAY_MS' ? 900000 : fallback,
      } as unknown as ConfigService,
      lockHandle,
    };
  }

  function buildTokenService(c: ReturnType<typeof makeTokenCollaborators>) {
    return new MercadoLivreOAuthService(
      c.marketplaceAccountsService as never,
      c.authorizationRequestsService as never,
      c.advisoryLockService as never,
      c.httpClient as never,
      c.encryptionService as never,
      c.configService,
      {} as never, // DataSource, unused by ensureValidAccessToken
    );
  }

  it.each([
    MarketplaceAccountStatus.DISCONNECTED,
    MarketplaceAccountStatus.TOKEN_EXPIRED,
    MarketplaceAccountStatus.ERROR,
  ])('never returns a token for a %s account, even with a future tokenExpiresAt', async (status) => {
    const c = makeTokenCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      connectedAccount({ status, tokenExpiresAt: new Date(Date.now() + 3600_000) }),
    );
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow();
    expect(c.advisoryLockService.tryAcquire).not.toHaveBeenCalled();
  });

  it('fast path: returns the current token without acquiring the lock or calling the ML when well within the leeway window', async () => {
    const c = makeTokenCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      connectedAccount({ tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }),
    );
    const service = buildTokenService(c);

    const token = await service.ensureValidAccessToken('acc-1');

    expect(token).toBe('old-access');
    expect(c.advisoryLockService.tryAcquire).not.toHaveBeenCalled();
    expect(c.httpClient.refreshToken).not.toHaveBeenCalled();
  });

  it('renews when inside the leeway window: acquires the lock, calls refreshToken, applies CAS, returns the new token', async () => {
    const c = makeTokenCollaborators();
    const service = buildTokenService(c);

    const token = await service.ensureValidAccessToken('acc-1');

    expect(c.advisoryLockService.tryAcquire).toHaveBeenCalledWith('acc-1');
    expect(c.httpClient.refreshToken).toHaveBeenCalledWith({ refreshToken: 'old-refresh' });
    expect(c.marketplaceAccountsService.applyRefreshedTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'acc-1',
        expectedTokenVersion: 3,
        encryptedAccessToken: 'enc:APP_USR-new',
        encryptedRefreshToken: 'enc:TG-new',
      }),
    );
    expect(token).toBe('APP_USR-new');
    expect(c.lockHandle.release).toHaveBeenCalled();
  });

  it('re-checks eligibility AFTER acquiring the lock: an account that stopped being CONNECTED while waiting for the lock is rejected without calling the ML', async () => {
    const c = makeTokenCollaborators();
    c.marketplaceAccountsService.findByIdOrFail
      .mockResolvedValueOnce(connectedAccount())
      .mockResolvedValueOnce(connectedAccount({ status: MarketplaceAccountStatus.ERROR }));
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow();
    expect(c.httpClient.refreshToken).not.toHaveBeenCalled();
    expect(c.lockHandle.release).toHaveBeenCalled();
  });

  it('rethrows ACCOUNT_BUSY when the lock cannot be acquired', async () => {
    const c = makeTokenCollaborators();
    c.advisoryLockService.tryAcquire.mockResolvedValue(null);
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(/ACCOUNT_BUSY/);
  });

  it('refresh token rejected definitively (invalid_grant) -> marks TOKEN_EXPIRED with REFRESH_TOKEN_REJECTED, never reuses the old refresh token', async () => {
    const c = makeTokenCollaborators();
    c.httpClient.refreshToken.mockResolvedValue({ kind: 'definitive_error' });
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /REFRESH_TOKEN_REJECTED/,
    );
    expect(c.marketplaceAccountsService.markTokenExpired).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-1', failureCode: 'REFRESH_TOKEN_REJECTED' }),
    );
  });

  it('refresh outcome unknown (timeout) -> marks ERROR with REFRESH_RESULT_UNKNOWN, no blind retry', async () => {
    const c = makeTokenCollaborators();
    c.httpClient.refreshToken.mockResolvedValue({ kind: 'unknown_result' });
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /REFRESH_RESULT_UNKNOWN/,
    );
    expect(c.marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-1', failureCode: 'REFRESH_RESULT_UNKNOWN' }),
    );
    expect(c.httpClient.refreshToken).toHaveBeenCalledTimes(1);
  });

  it('refresh outcome is a structurally invalid 200 body -> ALSO maps to REFRESH_RESULT_UNKNOWN (design §7\'s account-status table has no entry for INVALID_TOKEN_RESPONSE — the provider may have rotated the refresh token even with a malformed response, so it is treated as ambiguous, never as harmless)', async () => {
    const c = makeTokenCollaborators();
    c.httpClient.refreshToken.mockResolvedValue({ kind: 'invalid_response' });
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /REFRESH_RESULT_UNKNOWN/,
    );
    expect(c.marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-1', failureCode: 'REFRESH_RESULT_UNKNOWN' }),
    );
  });

  it('refresh outcome is client_configuration_error (invalid_client) -> maps to REFRESH_RESULT_UNKNOWN, account goes to ERROR by CAS, NEVER TOKEN_EXPIRED (a misconfigured client_id/client_secret does not prove the refresh token itself was rejected)', async () => {
    const c = makeTokenCollaborators();
    c.httpClient.refreshToken.mockResolvedValue({ kind: 'client_configuration_error' });
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /REFRESH_RESULT_UNKNOWN/,
    );
    expect(c.marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-1', failureCode: 'REFRESH_RESULT_UNKNOWN' }),
    );
    expect(c.marketplaceAccountsService.markTokenExpired).not.toHaveBeenCalled();
  });

  it('CAS fails after the ML already issued new tokens (REFRESH_RESULT_NOT_COMMITTED) -> re-reads the account for real, preserves whatever it finds, does NOT force any account status write', async () => {
    const c = makeTokenCollaborators();
    c.marketplaceAccountsService.applyRefreshedTokens.mockResolvedValue(false);
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /REFRESH_RESULT_NOT_COMMITTED/,
    );
    // findByIdOrFail: 1x elegibilidade inicial + 1x releitura pós-lock + 1x
    // releitura real após o REFRESH_RESULT_NOT_COMMITTED (não é só um comentário).
    expect(c.marketplaceAccountsService.findByIdOrFail).toHaveBeenCalledTimes(3);
    expect(c.marketplaceAccountsService.markError).not.toHaveBeenCalled();
    expect(c.marketplaceAccountsService.markTokenExpired).not.toHaveBeenCalled();
    expect(c.marketplaceAccountsService.applyRefreshedTokens).toHaveBeenCalledTimes(1); // refresh token anterior nunca reutilizado
  });

  it('a failed decryption of the stored refresh token -> ERROR/CREDENTIAL_DECRYPTION_FAILED, releases the lock', async () => {
    const c = makeTokenCollaborators();
    c.encryptionService.decrypt.mockImplementation(() => {
      throw new Error('bad auth tag');
    });
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /CREDENTIAL_DECRYPTION_FAILED/,
    );
    expect(c.marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'CREDENTIAL_DECRYPTION_FAILED' }),
    );
    expect(c.lockHandle.release).toHaveBeenCalled();
  });

  it('a failed decryption of the ACCESS token on the FAST PATH (before any lock) also maps to CREDENTIAL_DECRYPTION_FAILED — decrypt failures are not only handled for the refresh token post-lock', async () => {
    const c = makeTokenCollaborators();
    c.marketplaceAccountsService.findByIdOrFail.mockResolvedValue(
      connectedAccount({ tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }), // dentro do leeway: fast path
    );
    c.encryptionService.decrypt.mockImplementation(() => {
      throw new Error('bad auth tag');
    });
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /CREDENTIAL_DECRYPTION_FAILED/,
    );
    expect(c.marketplaceAccountsService.markError).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'CREDENTIAL_DECRYPTION_FAILED' }),
    );
    expect(c.advisoryLockService.tryAcquire).not.toHaveBeenCalled(); // fast path nunca chega a adquirir o lock
  });

  it('a failed decryption of the ACCESS token on the post-lock re-check also maps to CREDENTIAL_DECRYPTION_FAILED', async () => {
    const c = makeTokenCollaborators();
    // Elegível no fast path (fora do leeway, então segue para o lock), e
    // ainda dentro do leeway na releitura pós-lock — mas a descriptografia
    // do access token falha nesse ponto específico.
    c.marketplaceAccountsService.findByIdOrFail
      .mockResolvedValueOnce(connectedAccount())
      .mockResolvedValueOnce(connectedAccount({ tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) }));
    c.encryptionService.decrypt.mockImplementation(() => {
      throw new Error('bad auth tag');
    });
    const service = buildTokenService(c);

    await expect(service.ensureValidAccessToken('acc-1')).rejects.toThrow(
      /CREDENTIAL_DECRYPTION_FAILED/,
    );
    expect(c.httpClient.refreshToken).not.toHaveBeenCalled();
    expect(c.lockHandle.release).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `cd backend && npm test -- mercado-livre-oauth.service.spec.ts`
Expected: FAIL — `service.ensureValidAccessToken is not a function`

- [ ] **Step 3: Implement (append to the same class)**

```typescript
// Add this method + these private helpers inside MercadoLivreOAuthService:
  async ensureValidAccessToken(accountId: string): Promise<string> {
    const leewayMs = this.configService.get<number>(
      'ML_TOKEN_REFRESH_LEEWAY_MS',
      900000,
    );

    const account = await this.assertEligibleForToken(accountId);
    if (this.isWithinLeeway(account.tokenExpiresAt, leewayMs)) {
      return this.decryptOrMarkError(account, account.encryptedAccessToken as string);
    }

    const lock = await this.advisoryLockService.tryAcquire(accountId);
    if (!lock) {
      throw new ConflictException('ACCOUNT_BUSY');
    }

    try {
      const reread = await this.assertEligibleForToken(accountId);
      if (this.isWithinLeeway(reread.tokenExpiresAt, leewayMs)) {
        return this.decryptOrMarkError(reread, reread.encryptedAccessToken as string);
      }

      const refreshTokenPlain = await this.decryptOrMarkError(
        reread,
        reread.encryptedRefreshToken as string,
      );

      const refreshOutcome = await this.httpClient.refreshToken({
        refreshToken: refreshTokenPlain,
      });

      if (refreshOutcome.kind === 'definitive_error') {
        await this.marketplaceAccountsService.markTokenExpired({
          id: accountId,
          expectedTokenVersion: reread.tokenVersion,
          failureCode: 'REFRESH_TOKEN_REJECTED',
          errorSummary: 'O Mercado Livre rejeitou o refresh token. Reconexão necessária.',
        });
        throw new ConflictException('REFRESH_TOKEN_REJECTED');
      }

      if (
        refreshOutcome.kind === 'unknown_result' ||
        refreshOutcome.kind === 'invalid_response' ||
        refreshOutcome.kind === 'client_configuration_error'
      ) {
        // design §7: a tabela de status de conta para falhas de renovação
        // só define REFRESH_TOKEN_REJECTED / REFRESH_RESULT_UNKNOWN /
        // REFRESH_RESULT_NOT_COMMITTED / CREDENTIAL_DECRYPTION_FAILED — não
        // INVALID_TOKEN_RESPONSE. Uma resposta 200 estruturalmente inválida
        // durante o refresh é tratada como REFRESH_RESULT_UNKNOWN também: o
        // provedor pode ter rotacionado o refresh token mesmo com uma
        // resposta malformada, então o resultado é ambíguo, nunca
        // "claramente inofensivo". `client_configuration_error`
        // (invalid_client) entra no MESMO ramo por razão distinta: um
        // client_id/client_secret mal configurado no nosso lado não prova
        // nada sobre o refresh_token apresentado — tratá-lo como
        // REFRESH_TOKEN_REJECTED forçaria a conta para TOKEN_EXPIRED sem
        // causa real no token do usuário, exigindo reconexão desnecessária.
        await this.marketplaceAccountsService.markError({
          id: accountId,
          expectedTokenVersion: reread.tokenVersion,
          failureCode: 'REFRESH_RESULT_UNKNOWN',
          errorSummary: 'Não foi possível confirmar a renovação do token.',
        });
        throw new ConflictException('REFRESH_RESULT_UNKNOWN');
      }

      const applied = await this.marketplaceAccountsService.applyRefreshedTokens({
        id: accountId,
        expectedTokenVersion: reread.tokenVersion,
        encryptedAccessToken: this.encryptionService.encrypt(refreshOutcome.token.accessToken),
        encryptedRefreshToken: this.encryptionService.encrypt(refreshOutcome.token.refreshToken),
        tokenExpiresAt: new Date(Date.now() + refreshOutcome.token.expiresInSeconds * 1000),
      });

      if (!applied) {
        // REFRESH_RESULT_NOT_COMMITTED (design §6.4/§7): outra operação já
        // mudou a tokenVersion (ex.: reconexão concorrente). Relê de
        // verdade a conta (não é só um comentário) e preserva
        // integralmente o que encontrar — NUNCA sobrescreve, NUNCA força
        // nenhum status, só alerta sobre a chamada atual.
        const currentState = await this.marketplaceAccountsService.findByIdOrFail(accountId);
        this.logger.warn('mercado_livre_refresh_result_not_committed', {
          accountId,
          currentStatus: currentState.status,
          currentTokenVersion: currentState.tokenVersion,
        });
        throw new ConflictException('REFRESH_RESULT_NOT_COMMITTED');
      }

      return refreshOutcome.token.accessToken;
    } finally {
      await lock.release();
    }
  }

  private isWithinLeeway(tokenExpiresAt: Date | null, leewayMs: number): boolean {
    if (!tokenExpiresAt) return false;
    return tokenExpiresAt.getTime() > Date.now() + leewayMs;
  }

  private async assertEligibleForToken(accountId: string) {
    const account = await this.marketplaceAccountsService.findByIdOrFail(accountId);
    if (
      account.marketplace !== Marketplace.MERCADO_LIVRE ||
      account.status !== MarketplaceAccountStatus.CONNECTED ||
      !account.encryptedAccessToken ||
      !account.encryptedRefreshToken ||
      !account.tokenExpiresAt
    ) {
      throw new ConflictException('ACCOUNT_NOT_ELIGIBLE_FOR_TOKEN');
    }
    return account;
  }

  /**
   * Descriptografa qualquer credencial armazenada (access ou refresh
   * token) e trata falha uniformemente — usado tanto no fast path (sem
   * lock: `markError` é uma escrita condicional autocontida, segura sem
   * lock) quanto na releitura pós-lock, para o access token E o refresh
   * token (item explícito da revisão: a falha de descriptografia não era
   * tratada no fast path nem para o access token pós-lock antes desta
   * correção).
   */
  private async decryptOrMarkError(
    account: MarketplaceAccount,
    encryptedValue: string,
  ): Promise<string> {
    try {
      return this.encryptionService.decrypt(encryptedValue);
    } catch {
      await this.marketplaceAccountsService.markError({
        id: account.id,
        expectedTokenVersion: account.tokenVersion,
        failureCode: 'CREDENTIAL_DECRYPTION_FAILED',
        errorSummary: 'Falha ao descriptografar credencial armazenada.',
      });
      throw new ConflictException('CREDENTIAL_DECRYPTION_FAILED');
    }
  }
```

- [ ] **Step 4: Run it, confirm it passes**

Run: `cd backend && npm test -- mercado-livre-oauth.service.spec.ts`
Expected: PASS (every test in the file).

- [ ] **Step 5: 🔍 Write and run the real-Postgres test proving a callback and a refresh on the SAME account are coordinated by the same advisory lock (deferred from Task 19 — `ensureValidAccessToken` didn't exist yet there)**

```typescript
// backend/src/integrations/mercado-livre-oauth/mercado-livre-oauth-lock-coordination.integration.spec.ts
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { createTestDataSource } from '../../test-utils/create-test-data-source';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { MarketplaceAccount } from '../marketplace-accounts/marketplace-account.entity';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { AdvisoryLockService } from './advisory-lock.service';
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
    FRONTEND_URL: 'https://app.example.com',
    ML_ACCOUNT_LOCK_WAIT_MS: 500, // curto: o teste quer ver ACCOUNT_BUSY, não esperar o padrão de 3s
    ML_TOKEN_REFRESH_LEEWAY_MS: 900000,
    CREDENTIAL_ENCRYPTION_KEY:
      '3132333435363738393031323334353637383930313233343536373839303a',
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
    dataSource = await createTestDataSource([OAuthAuthorizationRequest, MarketplaceAccount]);

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
      [accountId, encryptionService.encrypt('old-access'), encryptionService.encrypt('old-refresh')],
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
    const advisoryLockServiceForRefresh = new AdvisoryLockService(dataSource, configService);
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

    const advisoryLockServiceForCallback = new AdvisoryLockService(dataSource, configService);
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

    const refreshPromise = refreshService.ensureValidAccessToken(accountId).catch((e: Error) => e);
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
    const reason = new URL(
      (callbackResult as { redirectUrl: string }).redirectUrl,
    ).searchParams.get('reason');
    expect(reason).toBe('TRY_AGAIN_LATER'); // ACCOUNT_BUSY -> TRY_AGAIN_LATER
  });
});
```

Run: `cd backend && CREDENTIAL_ENCRYPTION_KEY="3132333435363738393031323334353637383930313233343536373839303a" TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test -- mercado-livre-oauth-lock-coordination.integration.spec.ts`
Expected: PASS (1 test). Determinístico — nenhuma etapa depende de um `setTimeout` arbitrário.

- [ ] **Step 6: 🔍 Commit (checkpoint — review token renewal/CAS logic against design §6.4/§7 before moving on)**

```bash
git add backend/src/integrations/mercado-livre-oauth/
git commit -m "feat(oauth): implement ensureValidAccessToken (design §6.4), coordinate with callback via the shared advisory lock"
```

---


---

## Fim do Lote 3

Pare aqui. Não prossiga para a Task 21 nesta sessão — a Task 21 pertence ao Lote 4 (`2026-08-27-mercado-livre-oauth-batch-4.md`), que deve ser executado em uma sessão nova, lendo apenas o design aprovado, o índice mestre e o arquivo do Lote 4.
