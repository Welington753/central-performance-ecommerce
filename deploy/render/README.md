# Render Free — ambiente de avaliação Shopee (staging temporário)

**Finalidade exclusiva:** disponibilizar o sistema, por tempo limitado, para
a equipe de avaliação Go-Live da Shopee testar via Sandbox. **Não é
produção.** Nunca deve receber loja real, pedidos reais, tokens Live ou
qualquer credencial de produção antes da aprovação formal da Shopee.

Este checkpoint (CP2K-6B-2E) só preparou o repositório (`render.yaml`,
rewrites do Next.js). **Nenhum recurso foi criado no Render ainda.**

## Arquitetura

```
navegador -> https://<frontend>.onrender.com (Web Service, Next.js standalone)
                 |  rewrites same-origin: /auth, /health, /version,
                 |  /marketplace-accounts, /marketplace-analytics,
                 |  /sync-runs, /integrations (inclui callback Shopee/ML)
                 v
             https://<backend>.onrender.com (Web Service, NestJS)
                 |  dockerCommand: migration:run -> seed -> node dist/main.js
                 v
             Render Postgres Free (1 GB, expira em 30 dias, sem backup)
```

O navegador **nunca** acessa a URL do backend diretamente — só a do
frontend. Isso é necessário porque `onrender.com` está na Public Suffix
List: dois serviços `*.onrender.com` são origens cross-site entre si, e
cookies `SameSite=Lax` não seriam enviados em chamadas diretas
frontend→backend. Ver comentários em `frontend/next.config.ts` e
`frontend/src/lib/api.ts`.

## Nomes propostos (a confirmar no painel)

`render.yaml` fixa os nomes `cpe-avaliacao-shopee-backend`,
`cpe-avaliacao-shopee-frontend` e `cpe-avaliacao-shopee-db`, e já deriva
`BACKEND_PROXY_URL`, `FRONTEND_URL`, `SHOPEE_REDIRECT_URI` e
`ML_REDIRECT_URI` diretamente desses nomes (`https://<nome>.onrender.com`)
— nenhum é preenchido só depois do primeiro build. A disponibilidade real
desses nomes só é confirmada no momento da criação no painel Render.

**Se algum nome estiver indisponível:** parar antes de criar o Blueprint,
ajustar o nome em `render.yaml` e as quatro URLs derivadas acima juntas
(nunca só uma isoladamente), e reconfirmar o build do frontend antes de
prosseguir.

## Ordem futura de criação (manual, não executada neste checkpoint)

1. Criar conta Render sem cartão.
2. Criar o banco Postgres Free (`cpe-avaliacao-shopee-db` ou nome
   disponível) — **anotar a data de criação manualmente** (ver seção de
   expiração abaixo).
3. Criar o Web Service backend (Docker, `dockerContext: ./backend`,
   `branch: feat/shopee-oauth`), aplicando as variáveis de `render.yaml`
   (públicas/URLs derivadas direto, segredos preenchidos manualmente no
   painel).
4. Criar o Web Service frontend (Docker, `dockerContext: ./frontend`,
   `branch: feat/shopee-oauth`) — `BACKEND_PROXY_URL` já vem fixo em
   `render.yaml`, apontando para a URL do backend do passo 3.
5. Confirmar que os nomes reais atribuídos pelo Render batem com os
   propostos em `render.yaml`. Se algum nome tiver sido alterado
   (sufixo automático por colisão), ajustar `render.yaml` e refazer o
   build do frontend antes de seguir — nunca deixar `BACKEND_PROXY_URL`/
   `FRONTEND_URL`/`SHOPEE_REDIRECT_URI`/`ML_REDIRECT_URI` divergentes das
   URLs reais.

## Desativar auto-deploy

`autoDeployTrigger: off` já está em `render.yaml` para os dois Web
Services. No painel, confirmar em Settings → Build & Deploy que nenhum
push a uma branch dispara deploy automático — só deploy manual
("Manual Deploy") durante toda a fase de avaliação.

## Validar health/login (manual, depois do deploy)

- `GET https://<backend>.onrender.com/health` → `{"status":"ok",...}`.
- `GET https://<frontend>.onrender.com/login` → 200.
- Login do usuário revisor pela URL do frontend, confirmar `Set-Cookie` com
  `HttpOnly; Secure; SameSite=Lax` e `GET /auth/me` autenticado.
- Nunca colar senha, cookie ou token em nenhum canal ao validar.

## Variáveis (nomes, sem valores — ver `render.yaml` para a classificação completa)

Públicas fixas: `NODE_ENV`, `PORT`, `ENABLE_SWAGGER`, `COOKIE_SECURE`,
`MARKETPLACE_AUTO_SYNC_ENABLED`, `BACKFILL_WORKER_ENABLED`,
`SHOPEE_ENVIRONMENT`, TTLs/limites de throttle.

Públicas derivadas dos nomes propostos (fixas em `render.yaml`, não
segredo, já disponíveis no primeiro build): `FRONTEND_URL`,
`SHOPEE_REDIRECT_URI`, `ML_REDIRECT_URI`, `BACKEND_PROXY_URL`. No Render
todas são declaradas como `envVars` — `dockerBuildArgs` não é campo
suportado pela especificação Blueprint do Render, então
`BACKEND_PROXY_URL` do frontend também é `envVar`; o Render a
disponibiliza automaticamente como Docker build argument (`--build-arg`)
durante o `docker build`. A variável também existe em runtime, mas não é
segredo. O Next.js efetivamente a usa em build time para gravar os
rewrites no `routes-manifest.json` (não reavaliado em runtime) — ver
`frontend/next.config.ts`. Nunca é incluída no bundle público do
navegador.

Segredos (painel, `sync: false`): `ACCESS_TOKEN_SECRET`,
`CREDENTIAL_ENCRYPTION_KEY`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`,
`SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `INITIAL_ADMIN_EMAIL`,
`INITIAL_ADMIN_PASSWORD`.

Gerada pelo Render: `DATABASE_URL` (automática via `fromDatabase`).

## Expiração do Postgres Free — 30 dias

- **Anotar manualmente a data de criação do banco** assim que ele for
  criado (não há automação disso neste checkpoint).
- **Alerta operacional no dia 25**: revisar se a avaliação Shopee ainda
  está em andamento; se sim, planejar recriação do ambiente antes do dia
  30 (banco novo, seed novo do revisor — nunca copiar dados do banco
  antigo).
- **O banco expira no dia 30**, sem backup automático. Se a avaliação
  ainda estiver em análise nesse momento, recriar o ambiente do zero
  (nova instância do backend/frontend/banco) é preferível a tentar migrar
  dados de um banco prestes a expirar.
- Depois da aprovação **ou** reprovação da Shopee, **excluir todos os
  recursos** (os dois Web Services e o Postgres) no painel Render — este
  ambiente nunca deve continuar existindo indefinidamente.
- **Este banco nunca deve ser promovido a produção.** Se a Shopee aprovar
  o app, o ambiente de produção definitivo é criado do zero, com
  credenciais Live próprias — nunca reaproveitando este banco/ambiente de
  avaliação.

## Restrições até a aprovação da Shopee

- Usar **somente** Partner ID/Key de Sandbox — nunca credenciais Live.
- Nunca autorizar uma loja Shopee real neste ambiente.
- Nunca preencher/enviar o formulário Go-Live a partir deste ambiente sem
  decisão explícita separada.

## Riscos conhecidos

- **Cold start:** o serviço dorme após 15 min sem tráfego; a primeira
  requisição depois disso pode levar ~1 minuto para responder. Isso é
  esperado no Render Free — não indica defeito.
- **512 MB de RAM** por Web Service: limite de memória em runtime (não
  confundir com tamanho de imagem Docker). Sem garantia formal de que
  backend/frontend cabem sob carga real — só validado estruturalmente
  neste checkpoint (build e smoke test local), nunca medido em produção
  Render.
- **Postgres expira em 30 dias, sem backup:** qualquer dado gerado durante
  a avaliação pode ser perdido sem aviso após o prazo.
- **Possível rejeição do domínio `onrender.com` pela Shopee:** a Shopee
  pode não aceitar um domínio de PaaS gratuito genérico como "Live
  Redirect URL Domain" — isso não é um problema técnico deste sistema, é
  uma decisão da Shopee fora do nosso controle.
