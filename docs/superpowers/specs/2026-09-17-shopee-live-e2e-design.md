# Shopee Live E2E — design

## Contexto

O app "Central Performance Ezie" está Online na Shopee Open Platform (Live Partner ID
`2044705`). Toda a mecânica de integração já existe e está testada contra mocks: OAuth,
`get_shop_info`, renovação de token, `get_order_list`/`get_order_detail` paginados, mapper,
persistência idempotente (mesmo `MarketplaceOrdersPersistenceService` de Mercado Livre/Amazon)
e endpoint manual de sincronização. Falta: (1) provar esse caminho ponta a ponta contra a loja
Live real, e (2) incluir Shopee no `MarketplaceAutoSyncService` — hoje ele ignora
explicitamente contas Shopee (`marketplace-auto-sync.service.ts:143-149`,
`MARKETPLACE_NOT_SUPPORTED`).

Ambiente Sandbox não será usado neste lote. Toda credencial Live fica só em
`backend/.env`, nunca no chat, em log, fixture ou commit.

## Decisões já confirmadas (por código ou pelo usuário)

- `SHOPEE_ENVIRONMENT` para Live = `PRODUCTION` (`shopee-endpoints.ts`).
- Hosts Sandbox/Live já numa allowlist fechada, sem risco de mistura por código.
- Primeira sincronização usa a janela fixa de 60 dias já existente
  (`computeInitialSyncWindow`) — sem mecanismo novo de override de janela.
- Branch: `feat/shopee-live-e2e`, a partir de `feat/mercado-livre-kpis` @ `1ffc864`.
- Conta Shopee Live: linha NOVA em `marketplace_accounts` (nunca reconectar a linha usada no
  Sandbox).

### Redirect URI exata (derivada do código, `.env` real não lido)

`validateShopeeRedirectUri` (`shopee-redirect-uri.validator.ts:14,31-39`) exige: pathname
EXATAMENTE `/integrations/shopee/callback` (mesmo valor do `@Get('integrations/shopee/callback')`
em `shopee-oauth.controller.ts:61` — `main.ts` não define `setGlobalPrefix`, então não há
prefixo extra); sem query/fragmento/userinfo; host `localhost` ou `127.0.0.1` (só aceitos
quando `NODE_ENV==='development'`); `http` ou `https` aceitos em development.

`backend/.env.example:6` documenta `PORT=3000` como exemplo; o comentário da linha 8-11 confirma
que, sem `APP_HOST` definido, o backend liga em `127.0.0.1` fora de produção — esse é o host
que efetivamente aceita conexões nesse cenário.

**URL exata, a partir desses defaults documentados**:
```
http://127.0.0.1:3000/integrations/shopee/callback
```
Se o `PORT`/`APP_HOST` real do seu `backend/.env` for diferente do exemplo, ajuste porta/host
nessa URL antes de cadastrar no Partner Console — não vou ler o `.env` para confirmar isso; é
você quem sabe o valor real.

**Diferença backend × frontend**: essa URL é do BACKEND — é ela que vai no Partner Console da
Shopee, porque é para onde a Shopee redireciona depois do consentimento
(`shopee-oauth.controller.ts:61-72`, rota pública). O backend, depois de processar o callback,
redireciona o navegador DE NOVO, agora para `FRONTEND_URL` + `/integracoes` (`?shopee=success`
ou `?shopee=error&reason=...`) — `shopee-callback-redirect-url.ts:14-26`, usando a variável
`FRONTEND_URL` (`http://localhost:3001` no `.env.example`), nunca a URL de callback do backend.
Nunca cadastrar a URL do frontend (`:3001/integracoes`) no Partner Console — a Shopee precisa
da rota do backend.

**Pausa humana obrigatória (antes de qualquer OAuth)** — valor mantido fixo, nunca substituído
automaticamente:
1. Usuário cadastra/confirma no Partner Console da Shopee, para o app Live, exatamente
   `http://127.0.0.1:3000/integrations/shopee/callback`.
2. Usuário confirma que o Partner Console aceitou e salvou esse valor.
3. Só depois disso o mesmo valor, byte a byte, entra em `SHOPEE_REDIRECT_URI` no
   `backend/.env` (junto da Partner Key, mesma pausa humana).

**Se o Partner Console recusar `127.0.0.1`** (ex.: exige `localhost`, domínio público, ou
qualquer outro formato): **hard stop**. Nunca substituo automaticamente por `localhost` ou
outra URL — reporto a recusa exata informada pelo usuário e aguardo decisão explícita sobre
qual valor usar (isso muda `SHOPEE_REDIRECT_URI` e potencialmente exige reabrir esta spec).

## Conta Sandbox antiga — preservar e tornar inelegível

`SHOPEE_ENVIRONMENT` é uma variável GLOBAL do processo (`shopee-config.ts:48-49`), não por
conta — não existe coluna que marque "esta linha foi autorizada contra Sandbox". Ao trocar o
processo para `PRODUCTION`, qualquer conta Shopee que continue `CONNECTED` (a de Sandbox
inclusive) fica sujeita a: (a) `ensureValidShopCredentials`/renovação de token tentando usar o
refresh_token de Sandbox contra o host de Produção (`partner.shopeemobile.com`) — a Shopee
rejeitaria (`provider_rejected`), mas isso já é uma chamada real de rede com credencial errada,
exatamente o que "impedir mistura de credenciais Sandbox e Live" proíbe; (b)
`MarketplaceAutoSyncService.syncOneAccount` despachando essa conta (filtro atual é só
`status === CONNECTED`, sem distinção de ambiente — `marketplace-auto-sync.service.ts:112-113`).

**Não existe hoje nenhum fluxo para desconectar uma conta já `CONNECTED`** — conferido em
`MarketplaceAccountsController`/`MarketplaceAccountsService`: só há `create` (nasce
`DISCONNECTED`), `rename`, e transições internas (`applySuccessfulConnection`, `markError`,
`markTokenExpired`, `applyRefreshedTokens`, `markRefreshDeferred`), nenhuma delas leva
`CONNECTED → DISCONNECTED` por ação do usuário. Por isso este lote PRECISA incluir essa
capacidade — pequena, no mesmo padrão CAS já usado por `markError`/`applyRefreshedTokens`
(`WHERE id = $1 AND token_version = $2`), nunca um `UPDATE` manual improvisado:

- **`POST /marketplace-accounts/:id/disconnect`** — mesma proteção de TODOS os endpoints deste
  controller (`AccessTokenGuard`, `ParseUUIDPipe`). `MarketplaceAccount` não tem
  `ownerId`/`tenantId` — é um recurso global nesta fase (confirmado no comentário de
  `ShopeeOAuthService.startConnection`, mesma decisão já tomada para `connect`/`rename`); "a
  mesma autorização usada para administrar a conta" = exatamente essa (qualquer usuário
  autenticado ativo), nunca uma política nova só para este endpoint. "Validar que a conta
  pertence ao escopo permitido" = `findByIdOrFail` (404 se não existir) — mesmo padrão de
  `rename`.
- **`MarketplaceAccountsService.disconnect(id)`** — lê a conta atual (`findByIdOrFail`) para
  obter `token_version` corrente, então, numa transação própria (mesmo padrão self-contained já
  usado por `applySuccessfulConnection` quando nenhum `QueryRunner` externo é passado — connect/
  startTransaction/commit/rollback/release dentro do próprio método):
  - CAS: `UPDATE marketplace_accounts SET status='DISCONNECTED', encrypted_access_token=NULL,
    encrypted_refresh_token=NULL, token_expires_at=NULL, error_summary=NULL, failure_code=NULL,
    token_version=token_version+1, updated_at=now() WHERE id=$1 AND token_version=$2`;
  - `UPDATE oauth_authorization_requests SET status='FAILED', failure_code='ACCOUNT_DISCONNECTED',
    completed_at=now(), encrypted_code_verifier=NULL WHERE marketplace_account_id=$1 AND
    status='PENDING'` — invalida qualquer solicitação OAuth pendente associada, na MESMA
    transação. **Decisão de módulo**: em vez de injetar `OAuthAuthorizationRequestsService`
    (que criaria import circular — `mercado-livre-oauth.module.ts` já importa
    `MarketplaceAccountsModule`, e `OAuthAuthorizationRequestsService` nem é exportado de lá),
    `disconnect` escreve nessa tabela via SQL cru direto pelo `DataSource`/`QueryRunner` — o
    MESMO padrão que `ShopeeOAuthService.applyConnectionAndFinalizeAtomically` já usa para
    cruzar essa mesma fronteira, nenhuma dependência nova entre módulos. Tentativas já
    `PROCESSING` não são tocadas (podem estar em voo, protegidas pelo `AdvisoryLockService` por
    conta).
  - `external_seller_id`, `nickname`, `sync_runs`, `marketplace_orders`,
    `marketplace_order_items` daquela conta NUNCA são tocados — histórico Sandbox íntegro.
  - **Idempotente**: se a conta já está `DISCONNECTED`, retorna sucesso sem re-executar o CAS
    (curto-circuito antes da escrita — nunca um erro, nunca incrementa `token_version` de novo).
  - Nunca loga/retorna token ou dado sensível — mesmo padrão de todo o resto do serviço.
- Uma vez `DISCONNECTED`, `assertEligibleForToken` (`shopee-access-token.service.ts:335-347`)
  já rejeita a conta (exige `status === CONNECTED`) e o filtro do autosync já a exclui — nenhuma
  mudança adicional necessária nesses dois pontos.
- **Testes exigidos**: autorização (sem `AccessTokenGuard` → 401), conta inexistente → 404,
  CAS sob concorrência (duas chamadas simultâneas, uma vence), tokens/`token_expires_at`
  realmente nulos após, `oauth_authorization_requests` `PENDING` associado vira `FAILED`,
  idempotência (chamar 2x numa conta já `DISCONNECTED` não é erro nem muda `token_version` na
  2ª), histórico (`sync_runs`/pedidos/itens) inalterado antes/depois.

**Sequência exata de contagem de contas `CONNECTED` (nunca inverter a ordem)**:
1. `SELECT id, status, created_at FROM marketplace_accounts WHERE marketplace='SHOPEE'`
   (read-only, sanitizado — sem `external_seller_id`/tokens) para identificar todas as contas
   Shopee existentes.
2. Implementar e testar `disconnect` (TDD) antes de chamá-lo.
3. Chamar `POST /marketplace-accounts/:id/disconnect` na conta Sandbox `CONNECTED`.
4. Confirmar por SELECT: **zero** contas `SHOPEE` `CONNECTED` neste ponto (a Sandbox virou
   `DISCONNECTED`; a Live ainda não existe). Nunca exigir uma conta `CONNECTED` antes do OAuth
   Live — exigir exatamente o oposto, zero.
5. Criar a nova linha Live (`POST /marketplace-accounts`) — nasce `DISCONNECTED`, ainda sem
   `external_seller_id`/tokens.
6. Rodar o OAuth Live nessa nova linha (`connect` → pausa humana de consentimento → `callback`).
7. Confirmar por SELECT: **exatamente uma** conta `SHOPEE` `CONNECTED` (a Live, recém-conectada)
   — zero em qualquer outro status para o marketplace Shopee além dela e da Sandbox
   `DISCONNECTED`.
8. Antes de habilitar o autosync: repetir a mesma confirmação — **exatamente uma** conta
   `SHOPEE` `CONNECTED` e elegível (`assertEligibleForToken`), que precisa ser a Live.

## Componentes tocados

1. **`ShopeeOrdersSyncService.syncOrders`** (`shopee-orders/shopee-orders-sync.service.ts`) —
   ganha parâmetro opcional `options?: { type?: SyncRunType }`, repassado para
   `beginSyncRun` (hoje sempre grava `MANUAL` por default do banco). Mesma forma de
   `MercadoLivreOrdersSyncService.syncOrders`/`AmazonOrdersSyncService.syncOrders`. Chamador
   manual (controller) continua sem passar `type` (mantém `MANUAL`); autosync passa
   `{ type: SyncRunType.INCREMENTAL }`.

2. **`MarketplaceAutoSyncService`** (`marketplace-sync/marketplace-auto-sync.service.ts`) —
   `syncOneAccount` ganha um branch `Marketplace.SHOPEE` (mesmo formato dos dois existentes,
   chama `shopeeSyncService.syncOrders(account.id, { type: SyncRunType.INCREMENTAL })`); o
   `catch` passa a reconhecer `ShopeeOrdersSyncError` (hoje só `SyncOrdersError`/
   `AmazonOrdersSyncError`) para extrair o `code` sanitizado em vez de cair no fallback
   genérico `SYNC_FAILED`. Injeta `ShopeeOrdersSyncService` no construtor. Nenhuma mudança na
   lógica de lock de ciclo, concorrência ou isolamento entre contas — já genérica.

3. **`MarketplaceSyncModule`** — passa a importar o módulo que exporta
   `ShopeeOrdersSyncService` (mesmo padrão de como já importa os módulos de Mercado
   Livre/Amazon para o auto-sync).

4. **`MarketplaceAccountsService.disconnect`** + **`POST /marketplace-accounts/:id/disconnect`**
   (novos — ver seção "Conta Sandbox antiga" acima). Arquivos:
   `marketplace-accounts.service.ts`, `marketplace-accounts.controller.ts`, e os specs
   correspondentes (`marketplace-accounts.service.spec.ts`,
   `marketplace-accounts-http.integration.spec.ts`). Nenhum arquivo do módulo
   `mercado-livre-oauth` é tocado — a invalidação de `oauth_authorization_requests` acontece via
   SQL direto dentro de `disconnect`, não por injeção de serviço (ver decisão de módulo acima).

5. **Testes**: estender `marketplace-auto-sync.service.spec.ts` com os casos que já existem
   para ML/Amazon, espelhados para Shopee (dispatch de sucesso, falha sanitizada, ausência de
   regressão para os outros dois marketplaces, teste que hoje afirma "Shopee é ignorada" precisa
   ser atualizado/removido porque deixa de ser verdade). Novo caso: conta Shopee
   `DISCONNECTED`/não elegível (`status !== CONNECTED`, qualquer marketplace) nunca é despachada
   — reforça que o filtro `eligible = accounts.filter(status === CONNECTED)` já cobre isso, agora
   com Shopee explicitamente no vocabulário do teste. Novo teste unitário para o parâmetro `type`
   opcional em `shopee-orders-sync.service.spec.ts`. Novo teste para `disconnect` (CAS por
   `token_version`, idempotência, nunca apaga histórico de pedidos/itens).

Nenhuma mudança de schema. Um endpoint novo (`disconnect`, necessário para resolver a seção
"Conta Sandbox antiga" com segurança, nunca via SQL manual). Nenhuma alteração no client HTTP
Shopee.

## Fluxo operacional (execução real, após plano aprovado)

`MARKETPLACE_AUTO_SYNC_ENABLED` fica **`false`** do início até o passo 12 — nunca ligado antes
disso, mesmo que já estivesse `true` em uso anterior.

1. Backend antigo encerrado (confirmação visual + porta livre).
2. Implementar e testar TODAS as mudanças de código (seção "Componentes tocados" +
   `disconnect`) — TDD, testes direcionados. Nenhuma credencial real envolvida ainda.
3. `SELECT` read-only de todas as contas Shopee existentes (sanitizado, sem seller
   id/token) — identificar a conta Sandbox `CONNECTED`.
4. Chamar `POST /marketplace-accounts/:id/disconnect` na conta Sandbox. Confirmar por SELECT
   que ela ficou `DISCONNECTED`, com tokens nulos, histórico de pedidos intacto, **e que existem
   zero contas `SHOPEE` `CONNECTED`** neste ponto (checkpoint obrigatório antes de seguir).
5. **Pausa humana**: cadastrar/confirmar a redirect URI exata no Partner Console (ver seção
   acima), depois inserir `SHOPEE_PARTNER_ID=2044705`, `SHOPEE_PARTNER_KEY` (a chave em si),
   `SHOPEE_ENVIRONMENT=PRODUCTION`, `SHOPEE_REDIRECT_URI` (mesmo valor cadastrado) em
   `backend/.env`. Verificação sanitizada de presença das variáveis (nunca valor).
6. Subir o backend local.
7. Criar a conta Shopee Live nova (`POST /marketplace-accounts`) e chamar
   `POST /marketplace-accounts/:id/shopee/connect` para obter `authorizationUrl`.
8. **Pausa humana**: usuário abre `authorizationUrl`, faz login da conta PRINCIPAL da loja Ezie
   (nunca subconta) e consome o consentimento manualmente — nunca via agent-browser, nunca
   com credencial digitada por mim.
9. Confirmar status `CONNECTED` e validar `get_shop_info`.
10. Confirmar por SELECT read-only: **exatamente uma** conta `SHOPEE` `CONNECTED` (a Live nova,
    e nenhuma outra) — pré-condição obrigatória antes de qualquer sincronização, e reconfirmada
    de novo antes do passo 12 (autosync).
11. Baseline sanitizado (contagens) → `POST /marketplace-accounts/:id/shopee/sync-orders`
    (1ª execução real, janela de 60 dias, só leitura na Shopee) → conferir
    `sync_runs`/contadores → 2ª chamada manual ao mesmo endpoint → provar idempotência
    (`ordersCreated == 0` na 2ª, `ordersUpdated` reflete o pedido existente, zero duplicata).
    Ver "Divergência de payload" abaixo se o formato real não bater com os mocks.
12. Só agora: habilitar `MARKETPLACE_AUTO_SYNC_ENABLED=true`, rodar **um único ciclo controlado**
    (`runCycle()` uma vez, não o timer solto), confirmar: exatamente um dispatch (a conta Live),
    a conta Sandbox (`DISCONNECTED`) não aparece nos logs de dispatch, nenhuma sobreposição com
    sincronização manual (não disparar `sync-orders` manualmente durante esse ciclo — o próprio
    `beginSyncRun` já rejeitaria uma segunda execução concorrente com
    `SYNC_ALREADY_RUNNING`/`ShopeeOrdersSyncError`, mas o teste fica mais limpo sem sobrepor de
    propósito). Depois desse ciclo único, desligar de novo (`MARKETPLACE_AUTO_SYNC_ENABLED=false`)
    ou deixar como o usuário decidir no relatório final — mas nunca com o timer rodando
    indefinidamente enquanto eu ainda estou validando outra coisa.
13. Validar "Sincronizar todas as lojas" no frontend via agent-browser da Vercel — só a nossa
    própria UI, nunca a tela de login/consentimento da Shopee, nunca digita senha/2FA/Partner
    Key.
14. Testes, lint, build (backend + frontend). Commits locais pequenos e coerentes, sem push.
15. Encerrar o backend (nenhum processo local em segundo plano ao final). Relatório final
    sanitizado, incluindo o estado final exato de `MARKETPLACE_AUTO_SYNC_ENABLED`.

## Divergência de payload real × mocks

Sequência fixa, sem exceção:
1. A chamada real que detectou o formato incompatível **para imediatamente** — nenhum retry
   automático.
2. Nunca logar/imprimir o payload bruto, PII, ou credencial — só nome de campo + tipo
   divergente.
3. Criar fixture sanitizada reproduzindo só a forma do campo divergente (nunca dado real).
4. Escrever um teste que reproduza a divergência usando essa fixture (deve falhar antes da
   correção).
5. Corrigir **somente** parser/mapper (mesmo arquivo/estilo de `ShopeeOrderMappingError` já
   existente) até o teste passar.
6. Rodar a suíte de testes Shopee.
7. Uma nova chamada manual controlada (não automática) repete o passo que falhou.
8. **Qualquer mudança que não seja estritamente parser/mapper** (novo endpoint, mudança de
   schema, alteração de arquitetura, mudança de comportamento de retry/lock/autosync) é hard
   stop — reporto e aguardo nova aprovação antes de tocar nisso.

## Stop conditions (sem retry automático)

401/403, 429, timeout, 5xx, token inválido/expirado, conta ambígua, ambiente ≠ `PRODUCTION`,
resposta sem `total_amount`, formato incompatível com o parser, indício de mistura
Sandbox/Live, qualquer risco de exposição de credencial/PII.

## Git

Autorização explícita já concedida, a exercer só depois do plano final aprovado: criar
`feat/shopee-live-e2e` a partir do commit atual; commits locais pequenos e coerentes, sempre
após os testes daquele passo passarem; incluir a spec e o plano aprovados nos commits; nunca
incluir `.env`, Partner Key, tokens, `.zip`, nem a alteração preexistente do `.gitignore` (que
fica exatamente como está, preservada); sem push, merge ou deploy.

## Testing

- Unitário/integração real-Postgres: `shopee-orders-sync.service.spec.ts` (parâmetro `type`),
  `marketplace-accounts.service.spec.ts` (`disconnect`: CAS por `token_version`, idempotência,
  histórico preservado, `oauth_authorization_requests` PENDING invalidado), 
  `marketplace-accounts-http.integration.spec.ts` (endpoint HTTP: guard, 404, tokens nulos após),
  `marketplace-auto-sync.service.spec.ts` (dispatch Shopee, conta `DISCONNECTED`/não elegível
  nunca despachada, sem regressão ML/Amazon).
- Integração: specs `*.integration.spec.ts` já existentes continuam cobrindo o resto do
  caminho (client, parser, persistência) — nenhuma mudança de contrato nelas.
- Real (não automatizável): OAuth Live, `get_shop_info`, 1ª e 2ª sincronização, autosync,
  frontend via agent-browser — prova operacional, registrada no relatório final.
