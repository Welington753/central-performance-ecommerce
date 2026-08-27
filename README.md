# Central de Performance E-commerce

Sistema web interno de KPIs para e-commerce, com arquitetura preparada para integrar
múltiplos marketplaces (Mercado Livre, Amazon, Shopee, ...) por meio de conectores
plugáveis.

> **Status: Fase 1 — Fundação.** Esta versão contém apenas a base do sistema: autenticação
> interna, entidades, migrations, e a arquitetura multi-marketplace (contratos e stubs de
> conector). **Nenhuma chamada externa a marketplaces é feita ainda** — não há OAuth do
> Mercado Livre, não há sincronização real de vendas, e nenhuma tela exibe número ou KPI
> fictício como se fosse real. Ver [`docs/architecture.md`](docs/architecture.md).

## Estrutura

```
central-performance-ecommerce/
  backend/     NestJS + TypeScript + PostgreSQL (TypeORM) + Jest
  frontend/    Next.js (App Router) + TypeScript + Tailwind CSS
  docs/        Documentação de arquitetura
```

## Pré-requisitos

- Node.js 20+ e npm.
- PostgreSQL 13+ acessível via uma connection string (`DATABASE_URL`). Pode ser uma
  instância local ou hospedada — **não há dependência de Docker**.

## Backend

```bash
cd backend
npm install
cp .env.example .env   # preencha os valores reais — nunca commite o .env
npm run migration:run  # aplica a migration inicial no banco configurado em DATABASE_URL
npm run seed:admin     # cria o primeiro usuário admin (usa INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD do .env)
npm run start:dev
```

Variáveis de ambiente obrigatórias (ver comentários em [`backend/.env.example`](backend/.env.example)):
`NODE_ENV`, `PORT`, `DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`,
`FRONTEND_URL`, `COOKIE_SECURE`. A aplicação recusa subir se alguma estiver ausente ou
inválida. `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` são usadas apenas por
`npm run seed:admin` (não têm valor padrão).

Scripts úteis: `npm run lint`, `npm test`, `npm run build`, `npm run migration:generate`,
`npm run migration:revert`. Com `NODE_ENV` diferente de `production`, o Swagger fica
disponível em `/docs`.

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # ajuste NEXT_PUBLIC_API_URL para a URL do backend
npm run dev
```

Páginas: `/login`, `/dashboard`, `/integracoes`, `/sincronizacoes` (as três últimas são
protegidas — exigem sessão válida no backend).

Scripts úteis: `npm run lint`, `npm test`, `npm run build`.

## Testes e qualidade

Backend: 67 testes (Jest), lint (ESLint) e `tsc --noEmit` sem erros, `nest build` sem erros.
Frontend: 20 testes (Jest + Testing Library), lint e `tsc --noEmit` sem erros, `next build`
sem erros. Nenhum teste depende de uma conexão real com PostgreSQL (repositórios TypeORM
são mockados).

## Roadmap (fora do escopo desta fase)

OAuth do Mercado Livre, sincronização real de vendas, Product Ads, Amazon, Shopee,
integração com Omie, cálculo definitivo de KPIs (a receita líquida não deve ser chamada de
"lucro" até existir CMC no sistema).
