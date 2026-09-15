# syntax=docker/dockerfile:1
#
# Imagem de produção do frontend Next.js (Checkpoint CP2K-6B-2A) — multi-stage,
# usa `output: "standalone"` (next.config.ts) para copiar só o necessário em
# runtime. Nunca copia .env/.git/ZIPs/node_modules local (ver .dockerignore).
# NEXT_PUBLIC_API_URL é embutida em BUILD TIME (padrão Next.js para
# variáveis NEXT_PUBLIC_*) — recebida como ARG explícito, nunca com fallback
# localhost.
#
# Checkpoint CP2K-6B-2E: ausência/vazio de NEXT_PUBLIC_API_URL é uma
# configuração same-origin válida (ver next.config.ts/src/lib/api.ts) — não
# é mais obrigatória. BACKEND_PROXY_URL é um segundo ARG, só usado por
# `next build` para gravar os rewrites no manifesto de rotas (nunca embutido
# no bundle do navegador, nunca copiado para o estágio de runtime — cada
# stage só herda ARG/ENV que declara de novo).

ARG NODE_VERSION=24-alpine

# --- Stage "deps": instalação reproduzível -----------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage "build": next build -----------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Sem valor padrão fixo aqui (nunca localhost). Ausência/vazio é
# same-origin intencional (ver next.config.ts) — só preenchida quando o
# frontend deve falar com uma URL absoluta do backend (uso local/dev).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Só usada por `next build` para montar os rewrites (proxy same-origin,
# Checkpoint CP2K-6B-2E) — nunca um segredo, nunca embutida no bundle do
# navegador. Ausente = nenhum rewrite (comportamento local preservado).
ARG BACKEND_PROXY_URL
ENV BACKEND_PROXY_URL=${BACKEND_PROXY_URL}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Stage final: só o runtime "standalone" ----------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PORT=3000
# `server.js` do modo standalone já usa 0.0.0.0 por padrão quando HOSTNAME
# não é definido — explícito aqui por clareza, mesmo comportamento.
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# `.next/standalone` já traz um `node_modules` mínimo (só o que é realmente
# usado em runtime, via trace automático do Next) + `server.js` +
# `package.json` — nunca copiamos o `node_modules` completo do estágio
# "deps"/"build" para a imagem final.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Imagem oficial `node` já cria o usuário não-root "node" (uid 1000).
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "server.js"]
