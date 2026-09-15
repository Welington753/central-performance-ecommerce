# Stack de avaliação Shopee (staging)

Ambiente provisório para a equipe de avaliação Go-Live da Shopee. Não é o
ambiente de produção final. Usa somente Sandbox até a aprovação. Banco
sempre começa vazio — nunca copiar dado/token/sessão local.

## Arquitetura

- `caddy`: único serviço com porta publicada no host (HTTP redireciona para
  HTTPS; HTTPS faz proxy reverso para `frontend` e `backend`).
- `frontend` (Next.js) e `backend` (NestJS): sem porta publicada, só
  alcançáveis pela rede interna do compose.
- `postgres` (16-alpine): sem porta publicada, volume nomeado persistente.
- `migrate` e `seed-reviewer`: nunca sobem com `docker compose up` (usam
  `profiles: ["tools"]`); só rodam via `docker compose run --rm <serviço>`.
- `edge` (rede com saída normal — Caddy e backend) e `data` (`internal: true`
  — sem saída; backend, postgres, migrate, seed-reviewer). Frontend e Caddy
  nunca participam de `data`; frontend e postgres participam de uma única
  rede cada.

**Nunca** use `docker compose up --profile tools` (ou qualquer variação que
suba `migrate`/`seed-reviewer` automaticamente) como procedimento normal —
essas ações são sempre manuais, uma de cada vez, via `docker compose run
--rm <serviço>` (passos 5 e 7 abaixo).

## Ordem operacional

### 1. Preparar variáveis

```
cp deploy/staging/.env.example deploy/staging/.env.local
```

Edite `deploy/staging/.env.local` preenchendo os valores (nunca versionar
este arquivo, nunca exibi-lo no terminal com `cat`/`type`).

Em todos os comandos abaixo, aponte o compose para esse arquivo:

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local <comando>
```

### 2. Validar a configuração

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local config
```

### 3. Construir as imagens

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local build
```

### 4. Subir só o PostgreSQL

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local up -d postgres
```

### 5. Rodar migrations manualmente

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local run --rm migrate
```

### 6. Confirmar migrations aplicadas

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local run --rm backend \
  node node_modules/typeorm/cli.js migration:show -d dist/database/data-source.js
```

### 7. Criar o usuário revisor manualmente

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local run --rm seed-reviewer
```

### 8. Subir backend, frontend e Caddy

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local up -d backend frontend caddy
```

### 9. Validar health

```
curl -sk https://<BACKEND_HOST>/health
```

### 10. Acessar o frontend

```
https://<FRONTEND_HOST>/login
```

### 11. Consultar logs sem expor segredos

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local logs -f backend
```

Nunca use `env` dentro de `docker compose exec` para inspecionar segredos;
os healthchecks e a própria aplicação nunca imprimem valores de variáveis
sensíveis nos logs.

### 12. Parar a stack preservando o volume

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local stop
```

### 13. Remover totalmente a stack — SEÇÃO DESTRUTIVA

Isto apaga o volume do Postgres (todos os dados do ambiente de avaliação,
incluindo o usuário revisor). Exige confirmação explícita antes de rodar:

```
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.local down -v
```

## Observações de segurança

- `FRONTEND_HOST` e `BACKEND_HOST` devem ser subdomínios do mesmo domínio
  registrável (ex.: `avaliacao.exemplo.com` e `api-avaliacao.exemplo.com`)
  — necessário para o cookie `SameSite=Lax` funcionar entre os dois.
- `COOKIE_SECURE=true`, `ENABLE_SWAGGER=false`,
  `MARKETPLACE_AUTO_SYNC_ENABLED=false`, `BACKFILL_WORKER_ENABLED=false` e
  `SHOPEE_ENVIRONMENT=SANDBOX` estão fixos no `compose.yml` — não precisam
  (e não devem) ser sobrescritos pelo `.env.local`.
- `SHOPEE_REDIRECT_URI` é derivada automaticamente de `BACKEND_HOST` no
  `compose.yml` (`https://<BACKEND_HOST>/integrations/shopee/callback`) —
  não é uma variável separada no `.env.example`.
