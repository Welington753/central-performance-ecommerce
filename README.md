# Central de Performance E-commerce

Sistema web interno de KPIs para e-commerce. Consolida pedidos de vários marketplaces
(Mercado Livre, Shopee e Amazon), calcula indicadores de vendas, acompanha problemas
(reclamações/devoluções), clientes e metas, e controla quem pode ver ou operar cada conta.

## Estado atual

- **Marketplaces:** Mercado Livre, Shopee e Amazon, cada um com módulo próprio em
  `backend/src/integrations/`:
  - Mercado Livre: OAuth, sincronização de pedidos, classificação logística (Full), reclamações
    (Problemas) e renovação automática de token.
  - Shopee: OAuth, sincronização de pedidos e flag de fulfillment.
  - Amazon: SP-API como aplicação privada (LWA), verificação de conexão e sincronização de
    pedidos. Ver [`docs/amazon-sp-api-private-app-setup.md`](docs/amazon-sp-api-private-app-setup.md)
    e [`docs/amazon-connection-readiness.md`](docs/amazon-connection-readiness.md).
- **Credenciais:** tokens e metadados de conexão ficam criptografados no banco (AES-256-GCM,
  chave `CREDENTIAL_ENCRYPTION_KEY`).
- **Acesso:** login com sessão em cookies HttpOnly (access + refresh token), usuários, papéis
  (`ADMIN`, `ANALYST`, `VIEWER`), permissões por chave (ex.: `dashboard.view`, `sync.run`),
  exceções por usuário e escopo por conta (todas, selecionadas ou nenhuma).
- **Páginas** (todas protegidas, exceto login): Dashboard (e Metas), Full, Clientes, Problemas,
  Integrações, Sincronizações e Usuários.
- **Conectores:** `ConnectorRegistryService` e a interface `MarketplaceConnector` existem como
  contrato do núcleo, mas as classes em `integrations/connectors/` ainda são stubs
  (`implemented: false`). A lógica real de cada marketplace vive nos módulos próprios acima.

Arquitetura e regras de dependência: [`docs/architecture.md`](docs/architecture.md).

## Estrutura

```
backend/    NestJS + TypeScript + PostgreSQL (TypeORM) + Jest
frontend/   Next.js (App Router) + TypeScript + Tailwind CSS
docs/       Arquitetura e guias de integração
deploy/     Notas de deploy (Render e staging)
.github/    Workflow de CI
```

## Rodar localmente

Pré-requisitos: Node.js 24 e um PostgreSQL 16 acessível por `DATABASE_URL` (local ou
hospedado; o projeto não exige Docker).

**Backend**

```bash
cd backend
npm ci
cp .env.example .env     # preencha com valores seus; nunca commite o .env
npm run migration:run    # aplica as migrations no banco de DATABASE_URL
npm run seed:admin       # cria o primeiro admin (INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD)
npm run start:dev
```

Variáveis obrigatórias (veja os comentários em [`backend/.env.example`](backend/.env.example)):
`DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `ML_CLIENT_ID`,
`ML_CLIENT_SECRET`, `ML_REDIRECT_URI`, `FRONTEND_URL` e `COOKIE_SECURE`. O backend recusa subir
se alguma faltar ou for inválida. As variáveis de Shopee e Amazon são opcionais. Fora de
produção o Swagger fica em `/docs`.

**Frontend**

```bash
cd frontend
npm ci
cp .env.example .env.local   # NEXT_PUBLIC_API_URL = URL do backend
npm run dev -- -p 3001       # a mesma origem deve estar em FRONTEND_URL, no backend
```

## Migrations

Schema controlado só por migrations (`synchronize` é sempre `false`), em
`backend/src/database/migrations`. Scripts: `npm run migration:run`, `migration:revert` e
`migration:generate` (em `backend/`). Colunas de marketplace são `varchar`, então um novo
marketplace não exige migration só por existir.

## Sincronizações, workers e backfills

Rodam **dentro do processo da API** (não há worker separado):

| Recurso | Flag | Padrão no código |
|---|---|---|
| Sincronização automática de contas conectadas | `MARKETPLACE_AUTO_SYNC_ENABLED` (intervalo: `MARKETPLACE_AUTO_SYNC_INTERVAL_MINUTES`, padrão 60) | desligada |
| Backfill de histórico de pedidos | `BACKFILL_WORKER_ENABLED` | ligado |
| Reclassificação logística Full do Mercado Livre | `ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED` | desligada |
| Sincronização de problemas (reclamações) | `PROBLEMS_SYNC_WORKER_ENABLED` | desligada |

Backfill e reclassificação só processam jobs criados por ação explícita do usuário na tela de
Sincronizações. A renovação de token do Mercado Livre roda por cron a cada 5 minutos. Auto-sync e
workers ficam sempre desligados com `NODE_ENV=test`. Detalhes de lease, retry e idempotência em
[`docs/architecture.md`](docs/architecture.md).

## Testes e CI

```bash
cd backend  && npx jest --ci      # exige TEST_DATABASE_URL (PostgreSQL 16 descartável, já migrado)
cd frontend && npx jest --ci
```

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em pull requests, em
push para `main` e `feat/**` e manualmente, com três jobs paralelos:

- `backend-static`: ESLint, regras de qualidade, `tsc`, `architecture.spec.ts` e build.
- `backend-tests`: PostgreSQL 16 descartável, migrations e suíte Jest completa.
- `frontend`: ESLint, regras de qualidade, `tsc`, Jest e `next build`.

O CI usa só variáveis sintéticas. Ficam fora dele, por exigirem infraestrutura extra, os specs
`migrate-ml-accounts.integration.spec.ts` (segundo banco migrado) e
`connection-options.integration.spec.ts` (PostgreSQL com TLS).

## Deploy

O deploy é **manual**: o `render.yaml` usa `autoDeployTrigger: off`, então um push não publica
nada. O blueprint descreve um ambiente de avaliação (Render Free, backend e frontend em
Docker, frontend com rewrites same-origin para o backend). Ver
[`deploy/render/README.md`](deploy/render/README.md) e
[`deploy/staging/README.md`](deploy/staging/README.md).

## Limitações conhecidas

- Workers e auto-sync dependem de a API estar acordada: no Render Free o serviço dorme por
  inatividade e jobs ficam parados até o próximo acesso.
- A sincronização automática está desligada por padrão e precisa ser ligada por configuração.
- Os conectores do registry ainda não são usados pelos fluxos reais (ver "Estado atual").
- O CI ainda não cobre os dois specs de `migrate-ml-accounts` (ver "Testes e CI").
- A receita líquida não deve ser chamada de "lucro" enquanto não existir custo de mercadoria
  no sistema.
