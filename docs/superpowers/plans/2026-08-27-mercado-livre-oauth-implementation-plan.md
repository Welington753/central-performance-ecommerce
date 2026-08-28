# Mercado Livre OAuth (Fase 2) Implementation Plan — Índice Mestre

> **For agentic workers:** Este é o índice mestre. Ele **não contém as 25 tarefas** — cada tarefa vive em exatamente um dos quatro arquivos de lote abaixo, para que uma sessão nova nunca precise reler o plano inteiro (~7.700 linhas) para executar um único lote.
>
> Para executar um lote: abra uma sessão nova e leia, nesta ordem, **somente**:
> 1. O design aprovado — [docs/superpowers/specs/2026-08-27-mercado-livre-oauth-design.md](../specs/2026-08-27-mercado-livre-oauth-design.md).
> 2. Este índice mestre (objetivo, arquitetura, constraints globais, estratégia de execução abaixo).
> 3. O arquivo do lote a ser executado.
> 4. Os arquivos reais do código citados pela tarefa em execução, somente quando necessário para confirmar assinaturas/config existentes.
>
> REQUIRED SUB-SKILL: Use superpowers:executing-plans, sequentially, task-by-task, dentro do lote. Não usar subagentes/agent teams por padrão. Não usar subagent-driven-development — ver "Execution Strategy" abaixo para o cronograma de lotes/checkpoints.

**Goal:** Implement secure multi-account Mercado Livre OAuth 2.0 (Authorization Code + PKCE S256) — connect/reconnect flow, callback, encrypted token storage, coordinated automatic renewal, and safe logging — exactly as approved in the design doc, with zero real calls to Mercado Livre and zero code touching sales sync/Product Ads/Omie/Amazon/Shopee.

**Architecture:** A new, isolated NestJS module `integrations/mercado-livre-oauth` (outside the core dirs guarded by `architecture.spec.ts`) owns everything OAuth-specific: state/PKCE generation, the `oauth_authorization_requests` tracking table, a Postgres-advisory-lock-coordinated token service, and a scheduled renewal/cleanup job. `MarketplaceAccount` gains `errorSummary`/`failureCode`/`connectedByUserId`/`tokenVersion` for CAS-safe credential writes. All external HTTP is isolated in one `MercadoLivreHttpClient`, mocked at the HTTP boundary in every automated test — nothing here ever calls the real Mercado Livre.

**Tech Stack:** NestJS 11, TypeORM 0.3 (raw SQL for atomic UPDATE/lock statements), PostgreSQL 16, Jest/ts-jest, Next.js 16 (App Router) + React 19 for the frontend piece.

**Spec:** [docs/superpowers/specs/2026-08-27-mercado-livre-oauth-design.md](../specs/2026-08-27-mercado-livre-oauth-design.md) (approved 27/08/2026, commit `1126aaa9f1fd57333793dd0a7070824421b28dd7`) — this plan implements that document section by section; read both together.

## Global Constraints

- Never call the real Mercado Livre API in any automated test — every test mocks the HTTP boundary (`MercadoLivreHttpClient`'s injected `fetch`); `/authorization` is never an HTTP call at all, only URL construction (design §2, §9).
- Never create real credentials/secrets/env values — `.env` stays untouched; tests use fake/random values for `ML_CLIENT_ID`/`ML_CLIENT_SECRET`/`CREDENTIAL_ENCRYPTION_KEY`.
- Never touch sales sync, Product Ads, Omie, Amazon, or Shopee code.
- Never modify `backend/src/database/migrations/1787837395713-init-schema.ts` — all schema changes go in one new, isolated migration (design §4).
- Respect the existing connector-isolation rule validated by `backend/src/integrations/architecture.spec.ts` — nothing in `auth/`, `users/`, `sync/`, `common/`, `health/`, `integrations/marketplace-accounts/` may reference a concrete connector class. The new `integrations/mercado-livre-oauth/` module lives outside those scanned dirs.
- PKCE is always `S256`; never implement `plain` (design §2).
- `scope` is never sent as a request parameter (not documented); privilege is enforced by validating the *response* requires `read` and rejects `write` (design §2, §6.2 step 7, §10).
- TDD throughout: every behavior starts with a failing test, then the minimal implementation, then a passing run, then a commit.
- All entity status/code columns are `varchar`, never a native Postgres `enum` (existing project convention, restated in design §4).
- `SnakeNamingStrategy` is already configured (`typeorm-options.factory.ts`) — camelCase entity properties map automatically to snake_case columns; do not add explicit `name:` overrides unless truly needed.
- Integration tests that touch real Postgres need a disposable **PostgreSQL 16** instance (design §11) — see Task 5 (Lote 1) for how to start one, and the shared `createTestDataSource(entities)` helper (Task 5) that every real-Postgres suite must use, with `SnakeNamingStrategy` configured.
- No test uses `.skip`/`.only`/an equivalent (including `xdescribe`/`xit`/`xtest`) to silently no-op — a real-Postgres suite that cannot reach `TEST_DATABASE_URL` must **fail loudly** (`beforeAll` throws), never skip (see the per-task `requireTestDatabaseUrl()` helper introduced in Task 5).

## Execution Strategy

Este plano roda com **superpowers:executing-plans**, sequencialmente, uma tarefa por vez. **Uma sessão nova por checkpoint** — não uma sessão por lote, não subagent-driven-development, e não as 25 tarefas em uma única sessão. As 25 tarefas estão divididas em quatro arquivos de lote, cada um terminando em uma parada para revisão externa antes do próximo lote começar:

| Lote | Tasks | Arquivo | Termina em |
|---|---|---|---|
| 1 | 1–6 | [2026-08-27-mercado-livre-oauth-batch-1.md](2026-08-27-mercado-livre-oauth-batch-1.md) | Task 6 (🔍 LOGS CHECKPOINT) — também cobre o 🔍 MIGRATION CHECKPOINT da Task 5 no meio do lote |
| 2 | 7–13 | [2026-08-27-mercado-livre-oauth-batch-2.md](2026-08-27-mercado-livre-oauth-batch-2.md) | Task 13 (🔍 CONCURRENCY CHECKPOINT) |
| 3 | 14–20 | [2026-08-27-mercado-livre-oauth-batch-3.md](2026-08-27-mercado-livre-oauth-batch-3.md) | Task 20 (🔍 TOKENS CHECKPOINT) — também cobre o 🔍 CALLBACK CHECKPOINT da Task 19 no meio do lote |
| 4 | 21–25 | [2026-08-27-mercado-livre-oauth-batch-4.md](2026-08-27-mercado-livre-oauth-batch-4.md) | Task 25 (🔍 HOMOLOGAÇÃO CHECKPOINT) |

Ao final de cada lote — e em cada tarefa marcada com 🔍 dentro de um lote — pare e aguarde revisão externa antes de continuar. Não avance além de uma tarefa de checkpoint apenas por julgamento próprio. Isso mantém cada revisão pequena o bastante para ser lida de fato, e evita queimar todo o orçamento de implementação antes que um desvio de design seja detectado.

Cada arquivo de lote define, em seu próprio cabeçalho, o pré-requisito exato (commit do lote anterior) e a instrução de parada ao final — não repita esse texto aqui.

### Checkpoints recomendados (economia de contexto dentro de um lote)

Um lote inteiro (até ~2.400 linhas) não precisa ser relido só porque uma sessão nova retoma de um checkpoint intermediário. Dentro de cada lote, ao abrir uma sessão nova para um checkpoint específico, localize a seção pelo cabeçalho `## Task N:` e leia **somente as Tasks daquele checkpoint** — as Tasks anteriores do mesmo lote já foram implementadas/commitadas em sessões passadas e não precisam ser relidas, só o código real que elas produziram (passo 4 da ordem de leitura).

| Checkpoint | Tasks | Lote/arquivo |
|---|---|---|
| 1 | 1–5 | Lote 1 |
| 2 | 6 (🔍 LOGS) | Lote 1 |
| 3 | 7–11 | Lote 2 |
| 4 | 12–13 (🔍 CONCURRENCY) | Lote 2 |
| 5 | 14–18 | Lote 3 |
| 6 | 19 (🔍 CALLBACK) | Lote 3 |
| 7 | 20 (🔍 TOKENS) | Lote 3 |
| 8 | 21–23 | Lote 4 |
| 9 | 24 (🔍 FRONTEND) | Lote 4 |
| 10 | 25 (🔍 HOMOLOGAÇÃO) | Lote 4 |

Cada checkpoint termina com um relatório curto antes de a sessão seguinte continuar — não é necessário aguardar o fim do lote inteiro para reportar.

---

## Self-Review

**Spec coverage** (design doc §-by-§ against the tasks above):
- §1 Escopo / arquitetura isolada → Tasks 3-4, 23 (module lives outside `architecture.spec.ts` scanned dirs).
- §2 Referência oficial (S256-only, no `scope` param, `/authorization` never HTTP) → Tasks 7, 9, 11 (design decisions embedded directly in the code + comments).
- §3 Componentes / advisory lock key algorithm → Tasks 8, 11, 13, 22, 23.
- §4 Modelo de dados (colunas, índices separados PENDING/PROCESSING, migration isolada, `token_version`) → Tasks 3, 4, 5.
- §5 Variáveis de ambiente → Task 1.
- §6.1 Iniciar conexão → Task 16.
- §6.2 Callback (ordem estrita, claim antes de interpretar erro, lock, revalidação pós-lock, troca, identidade, **CAS + finalização atômicos na mesma transação**, redirect seguro mesmo em erro inesperado) → Tasks 17, 18, 19.
- §6.3 Rotinas de limpeza (índices separados, lock antes de recuperar PROCESSING) → Tasks 5 (indices), 21.
- §6.4 Renovação (elegibilidade antes e depois do lock — incluindo falha de descriptografia do access token em ambos os pontos —, REFRESH_RESULT_NOT_COMMITTED relê de verdade e preserva estado, resposta inválida durante refresh vira REFRESH_RESULT_UNKNOWN e não um código fora da tabela de status) → Task 20.
- §7 Vocabulário fechado + tabelas de mapeamento → Task 2 (mapper), Tasks 19-20 (usage sites match the tables exactly; a tabela de status de conta para refresh não recebe nenhum código fora dela mesma).
- §8 Logs (exato/sufixo/fragmento + sanitizador recursivo **realmente ligado a `redactSensitiveData`**, `LoggingInterceptor` corrigido para nunca logar query string) → Task 6.
- §9 Testes obrigatórios → distributed across every task; every item explicitly named in the design's test list (two concurrent connects, callback-vs-refresh race — Task 20 —, two-instance job race — Task 22 —, replay after SUCCESS/FAILED — Task 19 —, recovery-vs-active-lock — Task 21 —, PKCE cleanup on 4 outcomes, advisory lock determinism, `/authorization` never mocked as HTTP) now has a concrete test somewhere in Tasks 12, 13, 19, 20, 21, 22 — none were left as an unfulfilled bullet point.
- §10 Validação de resposta (expires_in ceiling, token_type, scope) → Task 10, used by Task 11.
- §11 Homologação + pendência operacional → Task 25 (automated parts, now including the frontend test suite and a secret scan that never prints raw file content); the manual DevCenter/production validation from design §11 is explicitly OUT of this plan's scope (it requires real credentials, which this plan is forbidden from creating — flag it to the user in the final report as the one remaining manual step).
- §12 Decisões pendentes → intentionally not resolved by this plan (they require operational/DevCenter access outside of what an implementation plan can do); still true after implementation, no task attempts to guess them.

**Placeholder scan:** no `TBD`/`TODO`/"add appropriate error handling"/"similar to Task N" phrasing anywhere above — every step has literal, complete code or an exact shell command with its exact expected output.

**Type consistency check performed:** `MercadoLivreOAuthFailureCode`, `TokenExchangeOutcome`, `IdentityLookupOutcome`, `ApplySuccessfulConnectionOutcome`, `CallbackParamsResult`, `MercadoLivreOAuthPublicReason`, `ML_FETCH`, and the `MercadoLivreOAuthService` constructor parameter order (7 parameters, `DataSource` included from Task 16 onward — every call site across Tasks 16, 19, 20, 23 was updated together) are each defined exactly once and reused with the identical shape everywhere they're consumed — no renamed methods or drifted signatures between definition and use sites.

**Scope check:** every file touched maps to something the approved design doc explicitly requires, or (Task 14's `POST /marketplace-accounts` route + real `class-validator` DTO, Task 24's frontend DTO leak fix, Task 11's `ML_FETCH` injection token, Task 5's `require-test-database-url` helper) is a small, load-bearing gap the design's own chosen flow cannot work without — each is noted inline as to why, not silently smuggled in.

**Corrections applied in this review round (external review of the previous version of this plan) — verified against the design doc, not just applied blindly:**
- **Atomicity (design §6.2 step 11, "mesma transação... rollback completo"):** the previous version committed the `MarketplaceAccount` CAS and the `OAuthAuthorizationRequest` `PROCESSING→SUCCESS` write as two separate transactions — a real violation, since a crash between them could leave the account `CONNECTED` with the attempt still `PROCESSING`. Fixed in Tasks 15 + 19: `applySuccessfulConnection` now optionally accepts an external `QueryRunner`, and a new `applyConnectionAndFinalizeAtomically` (Task 19) does both writes in one transaction, verified by dedicated real-Postgres tests (rollback-on-injected-failure, account-never-CONNECTED-unless-attempt-SUCCESS).
- **No test silently skips:** every `describe.skip`-based conditional was replaced with `requireTestDatabaseUrl()`, which throws if `TEST_DATABASE_URL` is missing (Task 5's new helper, applied in Tasks 12, 13, 15, 19, 20, 22).
- **FK integrity in real-Postgres tests:** `initiatedByUserId`/`connectedByUserId` are foreign keys to `users.id` (Task 5's migration) — the previous tests passed a bare `randomUUID()` with no matching row, which would fail with a foreign-key violation the first time these tests actually ran against Postgres. Fixed by seeding a real `users` row in every affected test file's `beforeEach`.
- **Multi-account coverage (the design's primary requirement):** Task 24's previous version used `accounts.find(...)`, showing only the first Mercado Livre account. Rewritten to list every Mercado Livre account with its own status/action, plus "Adicionar outra conta", with tests for two simultaneous accounts and double-click protection on both the per-account connect button and the add-account button.
- **DI correctness (`MercadoLivreHttpClient`):** a constructor default value (`fetchImpl: typeof fetch = fetch`) is invisible to Nest's DI container and would have failed module compilation the first time something outside a hand-built unit test instantiated the class. Fixed with an explicit `ML_FETCH` injection token.
- **Internal-only fields never reach the frontend:** `failureCode`/`errorSummary` were being returned by `MarketplaceAccountResponseDto` (Task 14) despite design §7 defining `failureCode` as internal/auditoria. Removed from the DTO; the frontend (Task 24) now derives all user-facing text from `status` alone, via fixed local message tables.
- **Client input can't set `externalSellerId`:** the original `POST /marketplace-accounts` used a plain TypeScript interface as the `@Body()` type, which the project's own global `ValidationPipe` (`whitelist`/`forbidNonWhitelisted`, `main.ts`) cannot validate against (interfaces have no runtime metadata) — so a client could have supplied `externalSellerId` directly, bypassing the "only set after `/users/me`" rule entirely. Fixed with a real `class-validator` DTO class (Task 14), matching the existing `LoginDto` pattern.
- Every other confirmed finding from the review (redirect URI pathname/HTTPS-except-development, migration column/index counts, the `Bearer` regex callback-signature bug, `LoggingInterceptor` logging raw query strings, JSON-parse failures misclassified as `unknown_result`, `INVALID_TOKEN_RESPONSE` written to a status table that doesn't define it, `findConnectedDueForRenewal` lacking an `ORDER BY`, and the unsafe `cat` of untracked files in the secret-scan step) is fixed at its specific task, referenced inline where it was changed.

**Segunda revisão externa (2026-08-28) — correções incorporadas nos quatro lotes acima:** SQL cru com aliases camelCase explícitos em `claimByState` (Lote 2, Task 12); construtor de `MercadoLivreOAuthService` consistente com `DataSource` desde a Task 16 (Lote 3); `SnakeNamingStrategy` via helper `createTestDataSource` compartilhado em todas as suítes reais (Lote 1, Task 5, usado em Tasks 12/13/15/19/20/22); sanitização da mensagem de erro no `LoggingInterceptor` e guard de rede global instalado antes da importação dos arquivos (Lote 1, Task 6); lifecycle de transação/lock corrigido com testes de injeção de exceção em `applySuccessfulConnection`, `applyConnectionAndFinalizeAtomically` e `AdvisoryLockService.tryAcquire` (Lote 2/3); timeout ativo durante toda a operação HTTP e classificação correta de erros OAuth em `postToken` (Lote 2, Task 11); códigos estruturados do PostgreSQL (`23505` + `constraint`) em vez de match de texto (Lote 2, Tasks 12/13); teste real de duas conexões concorrentes em `createPending` (Lote 2, Task 12); limpeza/concorrência determinística com ordenação, limite de lote, isolamento por candidata, e barreiras/promessas controladas substituindo `setTimeout` nos testes de callback-vs-refresh e job de duas instâncias (Lote 2 Task 12/13, Lote 3 Task 20, Lote 4 Tasks 21/22); `ParseUUIDPipe` no controller e `user` não-opcional (Lote 3, Task 14/16); teste de compilação do módulo com `CommonModule`/overrides de repository/`ML_FETCH` explícitos (Lote 4, Task 23); `useRef` como trava síncrona no frontend, banner de erro exigindo `ml=error` + `reason` conhecido, e `waitFor`/`act` nos testes assíncronos (Lote 4, Task 24); homologação consolidada (sem reexecução duplicada), busca de skip/only ampliada a `xdescribe`/`xit`/`xtest` em backend e frontend, e secret scan com `gitleaks --redact`, allowlist explícita e caminhos NUL-safe (Lote 4, Task 25). O plano foi dividido nestes quatro arquivos de lote nesta mesma revisão (item 13).
