# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Central de Performance E-commerce: sistema web interno de KPIs, com arquitetura preparada
para integrar múltiplos marketplaces (Mercado Livre, Amazon, Shopee, ...) via conectores
plugáveis. Monorepo com `backend/` (NestJS + TypeScript + PostgreSQL/TypeORM + Jest) e
`frontend/` (Next.js App Router + TypeScript + Tailwind CSS). Sem Docker — PostgreSQL via
`DATABASE_URL`.

## Comandos

Backend (`cd backend`):
- `npm run start:dev` — servidor com watch. Swagger em `/docs` quando `NODE_ENV != production`.
- `npm test` / `npm run test:watch` / `npm run test:cov` — Jest (`rootDir: src`, arquivos `*.spec.ts`).
  Um único teste: `npm test -- <caminho-ou-padrão>` (ex.: `npm test -- auth/auth.service.spec.ts`).
- `npm run lint` — ESLint com `--fix`.
- `npm run build` — `nest build`.
- `npm run migration:generate` / `migration:run` / `migration:revert` — TypeORM.
- `npm run seed:admin` — cria admin inicial via `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`.

Frontend (`cd frontend`):
- `npm run dev` / `npm run build` / `npm start`.
- `npm test` / `npm run test:watch` — Jest + Testing Library.
- `npm run lint` — ESLint.

Setup local: `npm install` em cada pasta, copiar `.env.example` (`backend/.env`,
`frontend/.env.local`) e preencher valores reais — nunca commitar `.env`. Backend recusa
subir se faltar `NODE_ENV`, `PORT`, `DATABASE_URL`, `ACCESS_TOKEN_SECRET`,
`CREDENTIAL_ENCRYPTION_KEY`, `FRONTEND_URL`, `COOKIE_SECURE`.

## Arquitetura

Princípio central (validado automaticamente por
`backend/src/integrations/architecture.spec.ts`, que varre o código-fonte e falha se violado):
nenhum módulo do núcleo (`auth`, `users`, `sync`, `common`, `health`,
`integrations/marketplace-accounts`) pode importar ou referenciar diretamente uma classe
concreta de conector (`MercadoLivreConnector`, `AmazonConnector`, `ShopeeConnector`).

- `Marketplace` é um enum TypeScript (`MERCADO_LIVRE`, `AMAZON`, `SHOPEE`); no PostgreSQL toda
  coluna correspondente é `varchar` (nunca enum nativo), para que um novo marketplace não
  exija migration de schema.
- `backend/src/integrations/contracts/marketplace-connector.interface.ts` define a interface
  `MarketplaceConnector`; cada conector concreto vive em
  `backend/src/integrations/connectors/*.connector.ts`.
- `ConnectorRegistryService` (`integrations/connectors/connector-registry.service.ts`) é a
  única peça do sistema que conhece as classes concretas; o resto depende só da interface e
  do token `MARKETPLACE_CONNECTORS`.
- `MarketplaceAccount` guarda credenciais por conta/marketplace
  (`encryptedAccessToken`/`encryptedRefreshToken`/`encryptedCredentialMetadata`), cifradas via
  `EncryptionService` (AES-256-GCM, chave `CREDENTIAL_ENCRYPTION_KEY`). `SyncRun` registra
  histórico de sincronizações. Detalhes e passo a passo para adicionar um marketplace novo em
  [`docs/architecture.md`](docs/architecture.md).
- Camadas do backend: controllers não podem acessar TypeORM diretamente (`Repository`,
  `DataSource`, `EntityManager`, `InjectRepository`) — regra ESLint
  `quality/no-direct-data-access` (erro) em `backend/eslint.config.mjs`. Acesso a dados fica em
  services/repositories.
- Regras ESLint customizadas adicionais (`backend/eslint-rules/`, também no frontend):
  `quality/max-lines` (aviso acima de 350 linhas) e `quality/no-direct-console` (aviso; usar
  `Logger` do NestJS em vez de `console.*`).
- Frontend: rotas protegidas (`/dashboard`, `/integracoes`, `/sincronizacoes`) agrupadas em
  `frontend/src/app/(protegido)/`, exigem sessão válida no backend; `/login` é pública.

## Regras permanentes do projeto (sessão)

Regras globais válidas em toda sessão. Instruções específicas de tarefa vivem no prompt, não aqui.

## 1. Idioma e comunicação

- Responder e produzir relatórios em português do Brasil.
- Ser direto e objetivo; evitar prosa desnecessária.

## 2. Sessões e escopo

- Uma tarefa por sessão.
- Executar somente o que foi explicitamente pedido; parar no checkpoint definido.
- Se a tarefa mudar, interromper, avisar o usuário e solicitar o início de uma nova sessão antes de continuar.
- Buscas direcionadas; evitar varreduras amplas sem necessidade.
- Não criar documentos, resumos ou relatórios extras se não forem pedidos.

## 3. Planejamento

- Usar Plan Mode antes de codificar tarefas complexas ou com múltiplas abordagens possíveis.
- Aguardar aprovação explícita do plano antes de implementar.
- Não usar subagentes ou agent teams sem autorização explícita do usuário.

## 4. Segurança e dados

- Nunca exibir, imprimir ou registrar segredos, tokens ou chaves.
- Não ler arquivos `.env` sem autorização explícita; preferir `.env.example` e os nomes das variáveis.
- Preservar alterações preexistentes do usuário; nunca sobrescrever trabalho em progresso sem confirmar.
- Não fazer commit, push, deploy, migration, sincronização ou chamadas a serviços reais sem autorização explícita.

## 5. Git

- Nunca usar comandos destrutivos (`reset --hard`, `push --force`, `clean -f`, `checkout .` etc.) sem autorização explícita.
- Staging seletivo com caminhos explícitos; nunca `git add .` ou `git add -A`.
- Rodar `git status` antes de qualquer operação que possa descartar trabalho não commitado.

## 6. Implementação e testes

- Usar TDD em alterações funcionais.
- Durante implementação, rodar testes direcionados ao escopo alterado.
- No checkpoint final, executar suíte completa, typecheck, lint e diff check quando forem aplicáveis e proporcionais à tarefa.
- Nunca esconder ou omitir falhas de teste ao resumir a saída.
- Escopo pequeno; evitar abstrações e features além do pedido.

## 7. Infraestrutura

- Usar bancos e containers descartáveis para testes destrutivos.
- Limpar recursos temporários (containers, arquivos, processos) ao final.
- Não alterar infraestrutura compartilhada sem autorização explícita.

## 8. Relatório final

- Reportar: o que mudou, resultado dos testes, `git status`, limitações ou itens não executados.
- Confirmar explicitamente ausência de push/deploy quando aplicável.
- Avisar quando o contexto da sessão estiver próximo do limite, recomendando nova sessão.
