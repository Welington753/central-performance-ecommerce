# syntax=docker/dockerfile:1
#
# Imagem de produção do backend NestJS (Checkpoint CP2K-6B-2A) — multi-stage,
# nunca copia .env/.git/ZIPs/logs/cobertura/node_modules local (ver
# .dockerignore). Migrations NUNCA rodam automaticamente aqui — ver o
# comentário no final deste arquivo para o comando manual.

ARG NODE_VERSION=24-alpine

# --- Stage "deps": instalação reproduzível com TODAS as dependências -------
# Precisa de devDependencies (typescript, @nestjs/cli, ts-node só para o
# npm ci deste estágio) para o build funcionar no próximo estágio.
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage "build": compila TypeScript -> dist/ -----------------------------
# `npm run build` roda `nest build` + `postbuild` (gera dist/build-info.json).
# `postbuild` chama `git rev-parse HEAD` e cai em "unknown" quando `.git` não
# existe no contexto (nunca falha o build por isso, ver
# scripts/generate-build-info.js).
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage "prod-deps": SÓ dependências de produção -------------------------
FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Stage final: imagem enxuta, sem ferramentas de build -------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
# Sem APP_HOST definido: `main.ts` já resolve "0.0.0.0" sozinho quando
# NODE_ENV=production (comportamento existente, nunca alterado aqui) — nunca
# hardcoded aqui para não mudar o comportamento local (que usa 127.0.0.1).
WORKDIR /app

# `package.json` (não só dist/) é necessário em runtime: `/version`
# (`build-info.util.ts`) lê `<dist>/../package.json` para reportar a versão.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Imagem oficial `node` já cria o usuário não-root "node" (uid 1000) — nunca
# roda como root a partir daqui.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Equivalente exato a `npm run start:prod` (`node dist/main`), sem passar
# pelo `npm` (menos um processo, mesmo comportamento).
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# Migrations (Checkpoint 6, nunca executadas aqui): o binário `typeorm` puro
# (dependência de PRODUÇÃO, `node_modules/.bin/typeorm`) já está presente
# nesta imagem e roda direto contra o DataSource JÁ COMPILADO
# (`dist/database/data-source.js`) — sem precisar de ts-node/devDependencies.
# Nunca faz parte do ENTRYPOINT/CMD acima; é um comando manual, executado
# uma vez por fora, contra o banco de destino:
#
#   docker run --rm -e DATABASE_URL=... <imagem> \
#     node node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js
#
# `data-source.ts` (fonte) faz `import 'dotenv/config'`, mas isso nunca
# sobrescreve uma variável de ambiente já definida no processo (comportamento
# padrão do dotenv) — nenhum ".env" precisa existir na imagem.
