# Implementation Plan — Fase 1: Fundação

## Objetivo desta fase
Criar a fundação do `central-performance-ecommerce`: backend NestJS + frontend Next.js,
arquitetura multi-marketplace por conectores, autenticação interna, criptografia genérica
de credenciais, entidades e migrations iniciais, e telas básicas sem dados fictícios.
**Nenhuma chamada externa a marketplaces é feita nesta fase.**

## Estrutura de pastas
```
central-performance-ecommerce/
  backend/
    src/
      auth/                      # login, refresh, logout, guards, argon2
      users/                     # User entity + service
      integrations/
        contracts/               # MarketplaceConnector interface, Marketplace enum
        connectors/              # MercadoLivreConnector, AmazonConnector, ShopeeConnector (stubs)
        marketplace-accounts/    # MarketplaceAccount entity + controller/service
      sync/                      # SyncRun entity + controller/service
      health/                    # GET /health
      common/                    # encryption service, redaction interceptor/logger, filters
      config/                    # env validation (Joi/class-validator)
      database/                  # TypeORM datasource + migrations
    test/ (jest unit tests colocated as *.spec.ts)
  frontend/
    src/app/
      login/
      dashboard/
      integracoes/
      sincronizacoes/
  docs/
  README.md
  .gitignore
```

## Decisões-chave
- **Multi-marketplace genérico**: `Marketplace` é um enum TS (`MERCADO_LIVRE`, `AMAZON`, `SHOPEE`),
  persistido como `varchar` no Postgres (sem `enum` de banco) para evitar migrations ao
  adicionar canais. Núcleo (`sync`, `marketplace-accounts`, `auth`) nunca importa classes
  específicas de conector; conectores implementam `MarketplaceConnector` e são resolvidos
  por um registry (`Map<Marketplace, MarketplaceConnector>`) injetado via token DI genérico.
- **Sem chamadas externas**: os 3 conectores existem apenas como stubs que implementam a
  interface e lançam `NotImplementedException`/retornam status "não implementado".
- **Criptografia**: `EncryptionService` genérico (AES-256-GCM), nome não específico de ML,
  usado para `encryptedAccessToken`/`encryptedRefreshToken`/`encryptedCredentialMetadata`.
  Valida `CREDENTIAL_ENCRYPTION_KEY` (32 bytes) no boot; sem default; nunca logado.
- **Refresh token**: hash (sha256) armazenado em `UserSession.refreshTokenHash`, nunca texto
  puro; rotação a cada refresh (sessão antiga revogada, nova criada); cookies HttpOnly,
  `Secure` via env, `SameSite=Lax`.
- **Senhas**: argon2.
- **Testes de banco**: unit tests com repositórios TypeORM mockados (sem exigir Postgres real
  rodando); não bloqueiam CI. `synchronize: false` sempre; migration única inicial cobre as
  4 tabelas.
- **Frontend**: App Router, Tailwind, cor de destaque `#8C0E33`, estados estáticos (sem
  integração real, sem números fictícios), fetch para backend feito via API routes/fetch
  client apontando para `NEXT_PUBLIC_API_URL`.
- **Sem Docker**: `DATABASE_URL` via `.env`; scripts `npm run migration:run` etc.

## Passos de execução
1. Scaffolding raiz: `.gitignore`, `README.md`, `docs/`, este plano. (feito por mim)
2. Backend (NestJS) — delegado a subagente independente (ver prompt dedicado).
3. Frontend (Next.js) — delegado a subagente independente, em paralelo ao backend (não
   depende de chamadas reais ao backend).
4. Validação final por mim: `npm run build` e `npm test` no backend, `npm run build` no
   frontend, checagem de segredos, checagem de dados fictícios, git init + commit.

## Critérios de aceite (resumo)
Ver lista completa fornecida pelo usuário. Resumo: builds passam, testes passam, sem
`synchronize: true`, sem segredo versionado, sem token em texto puro, arquitetura aceita
múltiplos marketplaces, nenhuma chamada externa realizada, README sem Docker, telas
login/dashboard/integrações/sincronizações presentes sem dado fictício.
