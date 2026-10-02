# Arquitetura

Visão para quem chega no projeto. Estado e como rodar: [`README.md`](../README.md).

## Camadas e limites

```
frontend (Next.js) --rewrites same-origin--> backend (NestJS) --> PostgreSQL
                                                  |
        core: auth, users, sync, common, health, marketplace-accounts
                                                  |
        integrações por marketplace: mercado-livre-*, shopee-*, amazon-*
        pipeline comum: marketplace-orders, marketplace-sync, marketplace-problems
        analytics: marketplace-analytics (KPIs, metas)   customers
```

- **Core** (`auth`, `users`, `sync`, `common`, `health`, `integrations/marketplace-accounts`):
  não conhece nenhum marketplace concreto.
- **Integrações por marketplace** (`mercado-livre-oauth`, `mercado-livre-orders`,
  `mercado-livre-claims`, `shopee-oauth`, `shopee-orders`, `amazon-sp-api`,
  `amazon-connection`, `amazon-orders`): falam com as APIs externas, mapeiam a resposta e
  entregam dados normalizados ao pipeline comum.
- **Pipeline comum**: `marketplace-orders` persiste pedidos, itens e compradores (estratégia em
  [`marketplace-order-normalization-strategy.md`](marketplace-order-normalization-strategy.md));
  `marketplace-sync` orquestra sincronização automática e backfill; `marketplace-problems`
  guarda reclamações e seus jobs de sincronização.
- **Analytics** (`marketplace-analytics`): KPIs consolidados, séries, rankings Full/logística e
  metas mensais, lidos do banco com SQL agregado. Só lê dados já normalizados.
- **Frontend** (`frontend/src/app`): páginas Dashboard, Full, Clientes, Problemas, Integrações,
  Sincronizações e Usuários. Chama a API via `src/lib/api.ts`. Com `BACKEND_PROXY_URL` definido
  no build, o Next.js reescreve uma lista fechada de prefixos (`/auth`, `/health`,
  `/marketplace-accounts`, ...) para o backend, para que cookies funcionem same-origin
  (ver `frontend/next.config.ts`).

## Regra crítica: o core não importa conector concreto

Nenhum módulo do core pode importar ou citar `MercadoLivreConnector`, `AmazonConnector` ou
`ShopeeConnector`. O teste `backend/src/integrations/architecture.spec.ts` varre essas pastas
e falha se algum nome aparecer.

`MarketplaceConnector` (`integrations/contracts/`) e `ConnectorRegistryService`
(`integrations/connectors/`) são o contrato de extensão. **As três classes de conector ainda são
stubs** (`getCapabilities()` retorna `implemented: false`, sem chamada de rede); a lógica real
vive nos módulos por marketplace listados acima, que ainda não passam pelo registry.

`Marketplace` é um enum TypeScript (`MERCADO_LIVRE`, `AMAZON`, `SHOPEE`); no banco as colunas
são `varchar`, nunca enum nativo.

## Autenticação e autorização

- **Sessão:** login emite access token (JWT, curta duração) e refresh token em cookies
  HttpOnly. Refresh rotaciona a sessão (`user_sessions`); senhas com argon2.
- **Guards:** `AccessTokenGuard` valida a sessão; `PermissionGuard` exige a permissão do
  endpoint (catálogo em `users/permissions.catalog.ts`); `AdminGuard` restringe o que é só de
  admin.
- **Papéis e permissões:** `ADMIN`, `ANALYST` e `VIEWER` têm presets de permissões; cada usuário
  pode ter exceções (`user_permission_overrides`). O `PermissionResolverService` calcula o
  resultado efetivo. O último admin ativo é protegido (`last-admin-guard`).
- **Escopo por conta:** `accountScopeMode` do usuário (todas, selecionadas ou nenhuma) é
  aplicado por `AccountScopeService` em consultas e ações; fora do escopo a ação é negada.
- Mudanças de acesso gravam auditoria (`user_audit_logs`).

## Credenciais de marketplace

`MarketplaceAccount` suporta várias contas por marketplace. Tokens e metadados são cifrados
com `EncryptionService` (AES-256-GCM, `CREDENTIAL_ENCRYPTION_KEY`). Callback e refresh de
token são serializados por conta com advisory lock do PostgreSQL
(`integrations/shared/advisory-lock.service.ts`), válido com mais de uma instância da API.

## Jobs e workers

Todos rodam no processo da API (`@nestjs/schedule` e timers). Flags e padrões estão no README.

| Job | Papel |
|---|---|
| Auto-sync (`marketplace-auto-sync`) | A cada N minutos sincroniza contas conectadas, uma de cada vez, sob advisory lock |
| Backfill (`marketplace-backfill-worker`) | Completa histórico de pedidos em chunks |
| Reclassificação Full ML | Reclassifica logística de pedidos históricos |
| Sync de problemas | Busca e atualiza reclamações do Mercado Livre |
| Renovação de token ML | Cron a cada 5 minutos |

Padrões comuns dos workers de job (backfill, reclassificação, problemas):

- **Lease/CAS:** o job é reivindicado por `UPDATE ... RETURNING` condicionado ao estado
  (claim transacional; no backfill com `FOR UPDATE SKIP LOCKED`), com `lease_owner` e `lease_expires_at`. Duas instâncias
  nunca processam o mesmo job; um lease vencido pode ser retomado.
- **Retry/backoff:** erro de provedor, rate limit ou token indisponível move o job para
  `WAITING_RETRY` com backoff (na reclassificação Full, mais longo em rate limit). Respostas não recuperáveis
  falham o job em vez de repetir.
- **Idempotência:** pedidos entram com `INSERT ... ON CONFLICT DO UPDATE` (único por conta e id
  externo), problemas idem; reprocessar o mesmo chunk não duplica linhas. Reclamações com
  falha de autorização ficam em quarentena e não derrubam o ciclo das demais.
- **Progresso durável:** jobs e cursores ficam em tabelas, então sobrevivem a reinício.

## Banco e migrations

PostgreSQL via TypeORM, `synchronize` sempre `false`: o schema vem só de
`backend/src/database/migrations`. Specs de integração rodam contra um PostgreSQL real
descartável já migrado (`TEST_DATABASE_URL`).

## Adicionar um novo marketplace

1. Adicionar o valor ao enum `Marketplace`.
2. Criar o(s) módulo(s) de integração (OAuth/credenciais, cliente HTTP, sincronização de
   pedidos) em `integrations/<marketplace>-*`, entregando dados ao pipeline comum.
3. Criar `NovoConnector implements MarketplaceConnector` e registrá-lo no
   `ConnectorRegistryService`.
4. Cobrir com testes e manter `architecture.spec.ts` verde. Migration só se o marketplace exigir
   campos novos.

## CI

`.github/workflows/ci.yml`: `backend-static`, `backend-tests` (PostgreSQL 16 descartável) e
`frontend`, em paralelo. Detalhes no README.
