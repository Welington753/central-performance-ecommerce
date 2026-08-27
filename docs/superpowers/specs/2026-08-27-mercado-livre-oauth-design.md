# Fase 2 — OAuth seguro do Mercado Livre

Status: aprovado em 27/08/2026 para planejamento e implementação.
Base: commit aprovado `c4f55d393b595d275d1570f89f76244c404fbe09` (Homologação Fase 1).

## 1. Escopo

**Dentro do escopo:** conectar/reconectar múltiplas contas do Mercado Livre via
OAuth 2.0 (Authorization Code + PKCE S256), renovação automática e segura de
tokens, tratamento de identidade/duplicidade, estados de conexão, logs seguros,
testes TDD contra PostgreSQL 16 real.

**Fora do escopo (não implementar nesta fase):** sincronização de vendas,
Product Ads, Omie, Amazon, Shopee. Nenhum endpoint de negócio do Mercado Livre
além de `/oauth/token` e `/users/me` é chamado pelo backend (`/authorization`
nunca é chamado pelo backend — ver §2).

**Restrição de arquitetura herdada da Fase 1:** nenhum módulo do núcleo
(`auth`, `users`, `sync`, `common`, `health`, `integrations/marketplace-accounts`)
pode referenciar classes concretas de connector. O novo módulo OAuth do ML é
específico do marketplace e vive fora do núcleo, validado pelo teste de
arquitetura já existente (`integrations/architecture.spec.ts`).

## 2. Referência oficial

Fontes consultadas (acesso em 27/08/2026):
- [Authentication and Authorization](https://developers.mercadolivre.com.br/en_us/authentication-and-authorization) — última atualização 19/01/2026.
- [Create an application on Mercado Libre](https://developers.mercadolivre.com.br/en_us/register-your-application) — última atualização 15/07/2025.

**Fluxo (Server Side / Authorization Code):**
- Autorização: `GET https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=...&redirect_uri=...&state=...&code_challenge=...&code_challenge_method=S256`. **Isso é apenas uma URL montada pelo backend e devolvida ao frontend para o navegador acessar — o backend nunca faz uma chamada HTTP a `/authorization`.**
- Token: `POST https://api.mercadolibre.com/oauth/token` — `grant_type=authorization_code|refresh_token`, `client_id`, `client_secret`, `code`/`refresh_token`, `redirect_uri`, `code_verifier`. Esta é uma chamada HTTP real feita pelo backend.
- `redirect_uri` deve ser idêntico ao cadastrado no app ML, sem partes variáveis — URL de callback única e fixa.
- PKCE: opcional por padrão no protocolo, mas o app ML pode exigi-lo no DevCenter; quando exigido, `code_challenge` passa a ser obrigatório. Métodos suportados: `S256` (recomendado) e `plain`. **Decisão de design: sempre usar `S256`, nunca implementar `plain`.**
- Resposta do token: `access_token`, `token_type`, `expires_in`, `scope`, `user_id`, `refresh_token`. **Inconsistência observada na doc oficial**: o texto descreve "6 horas" de validade, mas o exemplo de resposta mostra `expires_in: 10800` (3h). Por isso o design nunca usa uma constante fixa — sempre calcula `tokenExpiresAt` a partir do `expires_in` retornado na própria resposta (com validação defensiva — ver §10).
- `refresh_token` é de uso único (rotativo a cada renovação) e expira após 6 meses sem uso.
- O Mercado Livre **não valida** o parâmetro `state` — validação é responsabilidade exclusiva desta aplicação.
- Identidade: `user_id` vem direto na resposta do token; `/users/me` (com `Authorization: Bearer`) confirma a identidade antes de persistir.

**Escopo (`scope`) — evidência oficial:** a documentação de criação de aplicação
descreve "Scopes: Reading (permite GET) / Writing (permite PUT, POST, DELETE)"
como **checkboxes configurados no formulário do DevCenter ao criar/editar a
aplicação**, não como parâmetro de query em `/authorization` nem como campo
enviado em `/oauth/token`. A seção "Considerations on scopes" da mesma página
descreve três categorias de aplicação (somente leitura / leitura-escrita
online / leitura-escrita offline), e a última corresponde ao caso onde a
aplicação recebe `refresh_token` (offline access) — mas o formulário do
DevCenter descrito na doc só lista dois checkboxes explícitos (Reading,
Writing); não há uma terceira opção documentada de forma explícita chamada
"offline access" no formulário. O `scope` que aparece na resposta do token
(`"offline_access read write"`, no exemplo da doc de autenticação) é
**retornado pelo servidor**, nunca **enviado** pelo cliente em nenhuma
requisição documentada do fluxo Server Side.

**Decisão de design:** nenhum parâmetro `scope` é adicionado a `/authorization`
ou `/oauth/token` — nada disso está documentado, e não inventamos parâmetro.
Privilégio mínimo é obtido operacionalmente: configurar a aplicação no
DevCenter com **Reading habilitado e Writing desabilitado**. Qualquer
necessidade futura de escrita é decisão separada, tomada explicitamente no
DevCenter.

**Bloqueio operacional a confirmar (não resolvido pela doc consultada):** não
há confirmação textual explícita de que "offline access"/emissão de
`refresh_token` é automática para toda aplicação Server Side com Reading
habilitado, versus exigir alguma configuração adicional no DevCenter. Os
exemplos de resposta da doc de autenticação sempre mostram `refresh_token`
sendo retornado no fluxo Server Side padrão, o que sugere que é automático —
mas isso deve ser confirmado diretamente na tela de configuração do app antes
de conectar a primeira conta real (ver §12).

## 3. Componentes

Novo módulo `backend/src/integrations/mercado-livre-oauth/`:

- **`MercadoLivreOAuthController`**
  - `POST /marketplace-accounts/:id/mercado-livre/connect` — `AccessTokenGuard` + `@Throttle` (mesmo padrão do login).
  - `GET /integrations/mercado-livre/callback` — sem `AccessTokenGuard`; autorização vem exclusivamente da validação do `state`.
- **`MercadoLivreOAuthService`** — `buildAuthorizationUrl` (só monta URL, nenhuma chamada HTTP), `handleCallback`, `exchangeCodeForToken`, `fetchAuthorizedIdentity`, `refreshAccessToken`, `ensureValidAccessToken(accountId)` (método central, reservado para uso futuro por sincronizações).
- **`MercadoLivreTokenRenewalJob`** — job agendado (inicialmente a cada 5 minutos) que varre contas `CONNECTED` cujo `tokenExpiresAt` está dentro da janela `ML_TOKEN_REFRESH_LEEWAY_MS` e aciona a renovação coordenada por lock; processa em lotes limitados (constante de implementação, ajustável); relê cada conta somente depois de adquirir o lock; um guarda em memória evita que a mesma instância dispare uma execução sobreposta à anterior (múltiplas instâncias continuam protegidas pelo advisory lock, não por esse guarda local).
- **Rotina de expiração/recuperação de `OAuthAuthorizationRequest`** — duas sub-rotinas independentes, detalhadas em §6.3.
- **Advisory lock por conta** — chave `bigint` determinística, derivada assim: `chave = asSignedBigInt64BE( primeiros 8 bytes de SHA-256("central-performance:mercado-livre:account:" + accountId) )`, ou seja, os 8 primeiros bytes do hash são lidos como um inteiro de 64 bits **big-endian**, e o padrão de bits resultante é reinterpretado como `bigint` assinado (mesma semântica de `pg_advisory_lock(bigint)`). Byte order fixo garante o mesmo resultado em qualquer instância/plataforma. Adquirido via `QueryRunner`/conexão dedicada, liberado na mesma conexão física, sempre em `finally`, e liberado automaticamente pelo Postgres se a sessão cair. Tentativas de aquisição usam `pg_try_advisory_lock` (não bloqueante) repetidas dentro da janela `ML_ACCOUNT_LOCK_WAIT_MS`; esperar pelo lock nunca significa repetir uma chamada OAuth já feita — só adiar o próximo passo. Esgotada a janela sem sucesso → `ACCOUNT_BUSY`.

## 4. Modelo de dados

### `MarketplaceAccount` (alterações)
- `errorSummary varchar(500) | null` — mensagem operacional sanitizada; nunca `response.body`, stack externa, URL completa ou mensagem bruta do ML.
- `failureCode varchar | null` — vocabulário fechado (§7).
- `connectedByUserId uuid | null` — FK `users.id`, `ON DELETE SET NULL` (preserva a conta mesmo se o usuário interno for removido).
- `tokenVersion integer NOT NULL DEFAULT 0` — usado em compare-and-swap (CAS) em toda escrita de credencial.

### Nova entidade `OAuthAuthorizationRequest` (`oauth_authorization_requests`)
| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | |
| `marketplaceAccountId` | uuid | FK `marketplace_accounts.id`, `ON DELETE CASCADE` (tentativas órfãs não têm valor sem a conta) |
| `initiatedByUserId` | uuid, nullable | FK `users.id`, `ON DELETE SET NULL` (preserva auditoria) |
| `marketplace` | varchar | preparado para outros marketplaces futuros (varchar, nunca enum nativo do Postgres — mesmo princípio da Fase 1) |
| `stateHash` | **varchar(64)** | SHA-256 do `state` em hex (tamanho fixo, compatível com o digest); **índice único** |
| `encryptedCodeVerifier` | text, **nullable** | via `EncryptionService`; nunca em DTO, log ou `errorSummary`; **limpo (`NULL`) assim que a tentativa atinge um status terminal** (`SUCCESS`, `FAILED` ou `EXPIRED`) — o histórico da tentativa permanece, o segredo temporário não |
| `status` | varchar | `PENDING\|PROCESSING\|SUCCESS\|FAILED\|EXPIRED` |
| `failureCode` | varchar, nullable | vocabulário fechado (§7), auditoria interna |
| `expiresAt` | timestamptz | `now() + 10min` |
| `processingStartedAt` | timestamptz, nullable | marcado no claim atômico `PENDING→PROCESSING` |
| `consumedAt` | timestamptz, nullable | mesmo instante do claim |
| `completedAt` | timestamptz, nullable | preenchido em qualquer status terminal (`SUCCESS`, `FAILED`, `EXPIRED`) |
| `createdAt` | timestamptz | |

**Índices** (todos definidos na migration nova):
- Único em `stateHash`.
- Único parcial `(marketplace_account_id) WHERE status IN ('PENDING','PROCESSING')` — uma tentativa ativa por conta; proteção final contra corrida no `connect`.
- Parcial `(status, expires_at) WHERE status = 'PENDING'` — suporta a varredura de `PENDING` vencidas (§6.3.a). **Correção de rodada anterior:** este índice serve só a `PENDING`; ele não é usado para localizar `PROCESSING` abandonadas.
- Parcial `(status, processing_started_at) WHERE status = 'PROCESSING'` — suporta a varredura de `PROCESSING` abandonadas (§6.3.b), índice separado do anterior.
- `marketplaceAccountId`.
- `initiatedByUserId`.

**Migration** (nova, isolada — a migration inicial homologada `1787837395713-init-schema.ts` não é alterada):
- Cria `oauth_authorization_requests` com todas as colunas/índices/FKs acima.
- Adiciona `error_summary`, `failure_code`, `connected_by_user_id` (FK) e `token_version` (default `0`) em `marketplace_accounts`.
- Nenhuma coluna usa `enum` nativo do Postgres — todas as colunas de status/código são `varchar`.
- `down()` reverte integralmente: dropa a tabela nova e as colunas/FK/índices adicionados em `marketplace_accounts`, na ordem inversa — a migration deve ser reversível (`migration:revert` funcional), testado na homologação (§11).

## 5. Variáveis de ambiente

Segredos (sem valor padrão, obrigatórios):
- `ML_CLIENT_ID`
- `ML_CLIENT_SECRET` (nunca enviado ao frontend)
- `ML_REDIRECT_URI` — validado no boot: HTTPS obrigatório em produção; HTTP permitido só quando `NODE_ENV=development`; sem query string nem fragmento; deve corresponder exatamente ao caminho fixo do callback do backend (`.../integrations/mercado-livre/callback`).

Não secretos, com default inicial (validados no boot, numéricos positivos):
- `ML_HTTP_TIMEOUT_MS` — padrão **10000**.
- `ML_OAUTH_PROCESSING_STALE_AFTER_MS` — padrão **120000**. Validação adicional no boot: deve ser maior que o tempo máximo combinado plausível das operações do callback (troca de code + `/users/me`, cada uma limitada por `ML_HTTP_TIMEOUT_MS`), com margem de segurança — falha o boot se inconsistente.
- `ML_ACCOUNT_LOCK_WAIT_MS` — padrão **3000**. Janela máxima de tentativas de `pg_try_advisory_lock` antes de responder `ACCOUNT_BUSY`.
- `ML_TOKEN_REFRESH_LEEWAY_MS` — padrão **900000** (15 min). `ensureValidAccessToken` só considera o token utilizável sem renovar quando `tokenExpiresAt > now() + ML_TOKEN_REFRESH_LEEWAY_MS`.

`FRONTEND_URL` (já existente, reaproveitada) é a base do redirect final do callback: em produção exige HTTPS; nunca aceita query ou fragmento pré-configurado; o caminho usado é sempre o fixo `/integracoes`; a URL final é sempre montada com a API `URL` (nunca concatenação de strings). HTTP é aceito apenas quando `NODE_ENV=development`.

## 6. Fluxos

### 6.1 Iniciar conexão — `POST /marketplace-accounts/:id/mercado-livre/connect`
1. Carrega a conta por `id`; valida: existe, `marketplace = MERCADO_LIVRE`, usuário autenticado ativo, status atual permite conectar/reconectar (`DISCONNECTED`, `TOKEN_EXPIRED`, `ERROR`, ou `CONNECTED` no caso de reconexão explícita). Contas inexistentes ou não acessíveis retornam a mesma resposta genérica de "não encontrada" (não revelar existência). **Autorização interna nesta fase:** a Fase 1 ainda não tem papéis (RBAC) nem propriedade de conta (não existe conceito de "dono" de uma `MarketplaceAccount`); portanto, nesta fase, qualquer usuário interno autenticado e ativo pode iniciar conexão/reconexão de qualquer conta — não é inventado nenhum controle de RBAC ou ownership além do que a Fase 1 já tem (`AccessTokenGuard`).
2. Dentro de uma transação: tentativa `PENDING` anterior para a conta → `EXPIRED` (com `completedAt` e `encryptedCodeVerifier=NULL`, mesma regra do §6.3.a). Tentativa `PROCESSING` anterior → **não é tocada**; responde `409 OAUTH_CONNECTION_IN_PROGRESS` e encerra.
3. Gera `state` (CSPRNG, tamanho fixo) e par PKCE S256; insere `OAuthAuthorizationRequest` `PENDING` com `stateHash`, `encryptedCodeVerifier`, `expiresAt = now()+10min`, `initiatedByUserId`. O índice único parcial de tentativa ativa é a proteção final contra duas chamadas `connect` concorrentes (violação → tratada como `409`).
4. Retorna `{ authorizationUrl }` — a URL é apenas construída (§2/§3), nenhuma chamada HTTP é feita pelo backend nesse passo.

### 6.2 Callback — `GET /integrations/mercado-livre/callback`
Ordem estrita (nenhum caminho marca uma tentativa como falha antes de reivindicar validamente o `state`):

1. **Validar sintaxe/tamanho dos parâmetros brutos**, antes de qualquer hash: `state` obrigatório com tamanho máximo; aceita exatamente um entre `code` e `error` (nunca os dois, nunca nenhum); quando há `error`, os únicos complementos opcionais aceitos são `error_description` e `error_uri` (com limite de tamanho); qualquer outro parâmetro, ou duplicação de qualquer parâmetro (incluindo `state`/`code`/`error`), é rejeitado. A query string bruta nunca é logada, e `error_description`/`error_uri` — quando presentes — nunca são registrados, persistidos, devolvidos na resposta, usados no redirect, nem colocados em `errorSummary` ou em mensagens de exceção; são lidos só para validar tamanho/formato e descartados em seguida. Falha de validação aqui → resposta imediata (nem chega a calcular hash), redirect com `reason=OAUTH_CALLBACK_INVALID` — não há tentativa para atualizar.
2. Calcula `stateHash` (SHA-256 do `state`).
3. **Claim atômico**: `UPDATE oauth_authorization_requests SET status='PROCESSING', processing_started_at=now(), consumed_at=now() WHERE state_hash=$1 AND status='PENDING' AND expires_at>now() RETURNING *`.
   - Zero linhas → **não** há segunda consulta para diferenciar inexistente/expirado/reutilizado (o design proíbe essa segunda consulta, então essas três causas nunca são distinguíveis com segurança neste ponto). Externamente, sempre `reason=OAUTH_CALLBACK_INVALID`. Internamente, o evento pode ser registrado como auditoria estruturada segura (sem `state`, `stateHash`, query ou qualquer identificador sensível) sob um único código `STATE_INVALID` — mas **esse registro nunca é persistido como alteração de uma linha de `OAuthAuthorizationRequest`**, já que não se sabe com segurança a qual tentativa (se alguma) o evento se refere, e uma tentativa já terminal nunca é reaberta/sobrescrita.
4. **Só agora** o `code`/`error` recebido é interpretado, usando a tentativa reivindicada (agora `PROCESSING`):
   - `error=access_denied` → `UPDATE ... SET status='FAILED', failure_code='AUTHORIZATION_DENIED', completed_at=now(), encrypted_code_verifier=NULL WHERE id=:id AND status='PROCESSING'`.
   - Qualquer outro valor de `error` → mesmo `UPDATE`, com `failure_code='AUTHORIZATION_PROVIDER_ERROR'`. `error_description`/`error_uri` brutos do ML nunca são armazenados, logados ou usados no redirect (mesma regra do passo 1 do §6.2).
   - `code` presente → segue para o passo 5.
   - Toda finalização de tentativa (`SUCCESS` ou `FAILED`), em qualquer ponto deste fluxo, usa `WHERE ... AND status='PROCESSING'` — impede reprocessar/sobrescrever uma tentativa já terminal (replay do callback após `SUCCESS`/`FAILED` não tem efeito).
5. Obtém `marketplaceAccountId` da tentativa. Adquire o advisory lock da conta (§3), tentando dentro da janela `ML_ACCOUNT_LOCK_WAIT_MS`. Não conseguir → `FAILED/ACCOUNT_BUSY` (mesma regra de finalização condicional do passo 4); **não troca o code sem coordenação**.
6. Com o lock em mãos: relê a `MarketplaceAccount` e captura `tokenVersion` atual. Falha ao descriptografar `encryptedCodeVerifier` (adulterado/incompatível com a chave) → `FAILED/CREDENTIAL_DECRYPTION_FAILED`.
7. Troca `code` + `code_verifier` por tokens (`POST /oauth/token`, chamada HTTP real, mockada nos testes), fora de qualquer transação, timeout `ML_HTTP_TIMEOUT_MS`.
   - Resposta HTTP definitiva de erro (ex.: `4xx` com `invalid_grant`/`invalid_client`) → `FAILED/TOKEN_EXCHANGE_FAILED`.
   - Timeout ou resultado desconhecido → `FAILED/CALLBACK_RESULT_UNKNOWN`. **Nunca reenviar o mesmo `code`.** Não presumir internamente que a troca não ocorreu no lado do ML — apenas que o resultado é desconhecido para nós.
   - Resposta `200` mas estruturalmente inválida → `FAILED/INVALID_TOKEN_RESPONSE`. Isso inclui: faltar `access_token`, `refresh_token`, `user_id` ou `expires_in`; tipos incorretos; `expires_in` fora dos limites do §10; `token_type` que não seja `bearer` (comparação sem diferenciar maiúsculas/minúsculas); `scope` retornado (normalizado, dividido por espaço) que não contenha `read`, ou que contenha `write` (o projeto é somente leitura — uma resposta indicando permissão de escrita é rejeitada, nunca persistida). Nenhum token é persistido quando a resposta é incompatível com essas exigências.
8. Chama `/users/me` (chamada HTTP real, mockada nos testes) com o `access_token`, timeout `ML_HTTP_TIMEOUT_MS`. Falha ou resultado ambíguo → `FAILED/IDENTITY_LOOKUP_FAILED`; tokens não são persistidos; troca de code não é repetida automaticamente. Revogação do token só seria chamada se existisse endpoint oficial documentado — não existe base documentada nesta fase, então **não é implementada**.
9. Divergência entre `id` de `/users/me` e `user_id` da resposta do token → `FAILED/IDENTITY_MISMATCH`; nada persistido.
10. Resolução de identidade contra `MarketplaceAccount`:
    - Reconexão (conta alvo já tem `externalSellerId`): aceita só se igual à identidade retornada; senão `FAILED/IDENTITY_MISMATCH`, conta original preservada.
    - `externalSellerId` pertence a **outra** conta: tentativa atual `FAILED/ACCOUNT_ALREADY_CONNECTED`; conta alvo → `ERROR/ACCOUNT_ALREADY_CONNECTED` (atualização condicional por `tokenVersion`, para não sobrescrever um estado mais recente); a outra conta não é tocada. Essa checagem prévia é só uma otimização de mensagem — a autoridade final é o índice único parcial `(marketplace, external_seller_id) WHERE external_seller_id IS NOT NULL` já existente da Fase 1.
11. Persistência: transação curta, aberta **só** para gravar o resultado (nenhuma chamada HTTP dentro dela):
    - `UPDATE marketplace_accounts SET encrypted_access_token=.., encrypted_refresh_token=.., token_expires_at=.., external_seller_id=.., status='CONNECTED', error_summary=NULL, failure_code=NULL, connected_by_user_id=.., token_version=token_version+1 WHERE id=:id AND token_version=:expectedVersion`.
      - Zero linhas (perdeu a corrida de versão) → tokens já emitidos pelo ML não são commitados no nosso lado → `FAILED/TOKEN_RESULT_NOT_COMMITTED`; não repete code/refresh; não sobrescreve a versão mais recente da conta; exige reconexão; gera alerta operacional sanitizado.
      - Violação do índice único de `external_seller_id` (corrida entre dois callbacks) → rollback da transação → mapeia para `ACCOUNT_ALREADY_CONNECTED`; a conta vencedora é preservada; a tentativa atual é marcada `FAILED` em transação separada (`WHERE status='PROCESSING'`); a conta atual só é atualizada para `ERROR` com atualização condicional por `tokenVersion`.
    - Mesma transação: `OAuthAuthorizationRequest → SUCCESS` (`WHERE status='PROCESSING'`), `completedAt=now()`, `failureCode=NULL`, `encryptedCodeVerifier=NULL`.
    - Qualquer falha nessa transação → rollback completo; a conta nunca fica `CONNECTED` com a tentativa ainda `PROCESSING`, e a tentativa nunca vira `SUCCESS` sem os tokens persistidos.
12. Libera o advisory lock no `finally`.
13. Redireciona sempre para `FRONTEND_URL/integracoes?ml=success|error&reason=<código público>`, montado com a API `URL`.

### 6.3 Rotinas de limpeza de `OAuthAuthorizationRequest`

**6.3.a Expiração de `PENDING` vencidas** — sem necessidade de lock (nenhuma execução ativa possível sobre uma linha `PENDING`): `UPDATE oauth_authorization_requests SET status='EXPIRED', completed_at=now(), encrypted_code_verifier=NULL WHERE status='PENDING' AND expires_at<=now()`, usando o índice parcial `(status, expires_at) WHERE status='PENDING'`.

**6.3.b Recuperação de `PROCESSING` abandonada** — protegida contra marcar como abandonado um callback ainda em execução:
1. Busca candidatas via `(status, processing_started_at) WHERE status='PROCESSING'` com `processingStartedAt` mais antigo que `ML_OAUTH_PROCESSING_STALE_AFTER_MS`.
2. Para cada candidata: tenta adquirir o advisory lock da conta associada (mesma chave/mecânica do §3), **sem manter nenhuma transação aberta durante a espera pelo lock**.
   - Lock ocupado → o callback ou um refresh legítimo ainda pode estar em execução; **pula essa tentativa nesta rodada**, sem alterá-la.
   - Lock adquirido → relê a tentativa do banco (o estado pode ter mudado enquanto esperava o lock) e só então executa `UPDATE ... SET status='FAILED', failure_code='CALLBACK_RESULT_UNKNOWN', completed_at=now(), encrypted_code_verifier=NULL WHERE id=:id AND status='PROCESSING' AND processing_started_at<=:cutoff`.
3. Libera o lock no `finally`, mesma conexão física.

**O provedor pode ter emitido tokens antes da queda do processo que estava processando** — em nenhum momento a rotina afirma internamente que a troca não ocorreu, apenas que o resultado é desconhecido; nenhuma reconciliação de tokens é tentada aqui, e nenhum retry automático é disparado. Um alerta/auditoria seguro é gerado.

### 6.4 Renovação — `ensureValidAccessToken(accountId)` / job agendado
1. **Validação de elegibilidade (fast path), antes de qualquer lock**: carrega a conta; falha se não existir, se `marketplace ≠ MERCADO_LIVRE`, se faltar `encryptedAccessToken`/`encryptedRefreshToken`/`tokenExpiresAt`, ou se `status ≠ CONNECTED`. **`DISCONNECTED`, `TOKEN_EXPIRED` ou `ERROR` nunca retornam um access token, mesmo que `tokenExpiresAt` ainda esteja no futuro** — esses status significam que a credencial não é confiável, independentemente da data de expiração armazenada. Só depois dessa checagem o fast path compara `tokenExpiresAt > now() + ML_TOKEN_REFRESH_LEEWAY_MS`; se verdadeiro, retorna o token atual sem chamar o ML.
2. Caso a conta seja elegível mas precise renovar, adquire o advisory lock (§3) **antes** de ler/descriptografar o refresh token atual. Falha ao descriptografar → `ERROR/CREDENTIAL_DECRYPTION_FAILED` (atualização condicional por `tokenVersion`).
3. Relê a conta após adquirir o lock (status/expiração podem ter mudado por outra operação) e **repete a mesma validação de elegibilidade do passo 1** (existe, `MERCADO_LIVRE`, credenciais presentes, `status=CONNECTED`) — se deixou de ser elegível enquanto o lock era aguardado, libera o lock e falha sem chamar o ML. Se elegível e já dentro da janela de validade, retorna sem chamar o ML.
4. Chama refresh no ML fora de transação, timeout `ML_HTTP_TIMEOUT_MS`; `tokenExpiresAt` sempre calculado a partir do `expires_in` retornado (validado conforme §10, incluindo `token_type`/`scope` do §6.2 passo 7).
   - `invalid_grant`/rejeição definitiva → `REFRESH_TOKEN_REJECTED`; conta → `TOKEN_EXPIRED` (atualização condicional por `tokenVersion`, fail-closed).
   - Timeout/resultado incerto → `REFRESH_RESULT_UNKNOWN`; conta → `ERROR` (mesma técnica condicional); diagnóstico interno distinto do anterior, mesmo comportamento fail-closed.
   - Sucesso na chamada, mas o CAS de `tokenVersion` retorna zero linhas (ver passo 5) → `REFRESH_RESULT_NOT_COMMITTED`. **Neste caso a conta NÃO é forçada para `ERROR`**: zero linhas afetadas significa que outra operação já mudou a versão da conta entre a leitura do passo 3 e a escrita — pode ser uma reconexão mais recente e legítima. A rotina relê a conta, preserva integralmente o estado mais recente encontrado (não tenta nenhuma atualização condicional usando a `tokenVersion` antiga, que necessariamente falharia de novo), não sobrescreve nem desativa essa possível reconexão, e apenas registra um alerta estruturado sanitizado sobre a chamada de renovação atual, que falha de modo controlado. O refresh token anterior nunca é reutilizado em nenhum dos três casos deste passo.
5. Sucesso com CAS aplicado (linha afetada): `UPDATE` atômico único de `encryptedAccessToken` + `encryptedRefreshToken` + `tokenExpiresAt` + `status='CONNECTED'` + `failureCode=NULL` + `errorSummary=NULL` + `tokenVersion+1`, condicionado a `WHERE id=:id AND token_version=:expectedVersion` para nunca sobrescrever uma versão mais recente.
6. Libera o lock no `finally`, na mesma conexão física que o adquiriu; liberação automática pelo Postgres se a sessão cair.

## 7. Vocabulário fechado de `failureCode`

Union TypeScript + coluna `varchar` (Postgres), interno/auditoria:

`STATE_INVALID`, `AUTHORIZATION_DENIED`,
`AUTHORIZATION_PROVIDER_ERROR`, `ACCOUNT_BUSY`, `CALLBACK_RESULT_UNKNOWN`,
`TOKEN_EXCHANGE_FAILED`, `INVALID_TOKEN_RESPONSE`, `IDENTITY_LOOKUP_FAILED`,
`IDENTITY_MISMATCH`, `ACCOUNT_ALREADY_CONNECTED`, `ACCOUNT_STATE_CONFLICT`,
`TOKEN_RESULT_NOT_COMMITTED`, `REFRESH_RESULT_UNKNOWN`, `REFRESH_TOKEN_REJECTED`,
`REFRESH_RESULT_NOT_COMMITTED`, `CREDENTIAL_DECRYPTION_FAILED`.

Definições dos itens não descritos em §6:
- `STATE_INVALID`: substitui os antigos `STATE_NOT_FOUND`/`STATE_EXPIRED`/`STATE_ALREADY_USED` de rodadas anteriores deste design — como o claim atômico do §6.2 (passo 3) proíbe uma segunda consulta quando retorna zero linhas, essas três causas nunca são distinguíveis com segurança nesse ponto; um único código cobre todas.
- `ACCOUNT_STATE_CONFLICT`: conflito de concorrência detectado **antes** de qualquer emissão/rotação de token pelo ML (ex.: status da conta mudou de forma incompatível entre a validação e a persistência, fora dos casos já cobertos por `TOKEN_RESULT_NOT_COMMITTED`/`REFRESH_RESULT_NOT_COMMITTED`, que ocorrem **depois** do ML já ter emitido tokens).
- `CREDENTIAL_DECRYPTION_FAILED`: credencial ausente, adulterada (falha de `authTag` do GCM) ou incompatível com a chave atual de `CREDENTIAL_ENCRYPTION_KEY` — pode ocorrer tanto ao descriptografar `encryptedCodeVerifier` (callback) quanto `encryptedRefreshToken` (renovação).

**Mapeamento de status da `MarketplaceAccount` para falhas de renovação:**

| `failureCode` do refresh | Status da conta |
|---|---|
| `REFRESH_TOKEN_REJECTED` | `TOKEN_EXPIRED` |
| `REFRESH_RESULT_UNKNOWN` | `ERROR` |
| `REFRESH_RESULT_NOT_COMMITTED` | **preserva o status mais recente da conta — sem transição fixa.** Zero linhas no CAS significa que outra operação (possivelmente uma reconexão legítima) já mudou a conta; a rotina relê e preserva o que encontrar, sem forçar `ERROR` nem qualquer outro status, e sem reutilizar a `tokenVersion` antiga em nova tentativa de escrita |
| `CREDENTIAL_DECRYPTION_FAILED` | `ERROR` |

As transições de `REFRESH_TOKEN_REJECTED`, `REFRESH_RESULT_UNKNOWN` e `CREDENTIAL_DECRYPTION_FAILED` usam atualização condicional por `tokenVersion`, para nunca sobrescrever uma versão mais recente da conta. `REFRESH_RESULT_NOT_COMMITTED` não escreve nada na conta — apenas gera um alerta estruturado sanitizado sobre a chamada de renovação atual.

**Mapeamento para o `reason` público do redirect** (nunca detalhes técnicos do provedor):

| `failureCode` interno | `reason` público |
|---|---|
| `STATE_INVALID`, `AUTHORIZATION_PROVIDER_ERROR` | `OAUTH_CALLBACK_INVALID` |
| `AUTHORIZATION_DENIED` | `AUTHORIZATION_DENIED` |
| `IDENTITY_MISMATCH` | `IDENTITY_MISMATCH` |
| `ACCOUNT_ALREADY_CONNECTED` | `ACCOUNT_ALREADY_CONNECTED` |
| `ACCOUNT_BUSY`, `CALLBACK_RESULT_UNKNOWN`, `TOKEN_EXCHANGE_FAILED`, `IDENTITY_LOOKUP_FAILED`, `INVALID_TOKEN_RESPONSE`, `CREDENTIAL_DECRYPTION_FAILED`, `ACCOUNT_STATE_CONFLICT`, `TOKEN_RESULT_NOT_COMMITTED` | `TRY_AGAIN_LATER` (são falhas operacionais, não um callback sintaticamente inválido) |
| `REFRESH_RESULT_UNKNOWN`, `REFRESH_TOKEN_REJECTED`, `REFRESH_RESULT_NOT_COMMITTED` | não aparece no callback — a tela de integrações mostra a conta com o status resultante (`TOKEN_EXPIRED`/`ERROR`/estado preservado, conforme a tabela de renovação acima) |

## 8. Logs e proteção de segredos

**Igualdade exata** (mascarado quando o nome normalizado — minúsculo, só letras — for **exatamente igual**, evitando falsos positivos como `failureCode`/`statusCode`): `code`, `state`, `token`.

**Sufixo normalizado** (mascarado quando o nome normalizado **terminar com** um destes): `codeverifier`, `clientsecret`, `authorizationcode`, `accesstoken`, `refreshtoken`, `encryptionkey`. Isso cobre variações como `ML_CLIENT_SECRET`→`mlclientsecret`, `someAccessToken`→`someaccesstoken`, `encryptedRefreshToken`→`encryptedrefreshtoken`, sem depender de um fragmento genérico (`code`/`refresh`) que destruiria campos operacionais.

**Fragmentos genéricos mantidos** (substring, normalizado) apenas quando não colidem com campos operacionais: `password`, `authorization`, `cookie`.

**Preservado explicitamente nos logs** (não corresponde a nenhuma regra acima): `failureCode`, `statusCode`, `tokenVersion`.

**Nunca logado, independente de qualquer regra de chave:** qualquer coluna `encrypted*` (nunca o payload cifrado, mesmo que o redator também o mascarasse por nome — a proibição é por conteúdo, não só por chave; só o `id` da entidade é logado), `stateHash`, URL completa do callback, query string, corpo bruto de resposta de erro do ML, serialização direta de objetos HTTP externos (`response`, `error.response`, headers), `error.message` externo sem sanitização.

**Regra de construção de erro interno:** todo erro lançado por este módulo carrega um `failureCode` do vocabulário fechado e uma mensagem estática (nunca interpolando texto vindo do ML). `Authorization` header nunca é logado.

**Sanitização recursiva de valores textuais (além da redação por nome de chave):** antes de qualquer log, todo valor string — não só o valor de chaves sensíveis, mas o **conteúdo** de qualquer string, recursivamente, em objetos, arrays, query strings, corpos de formulário e mensagens — passa por um sanitizador que mascara: credenciais `Bearer <valor>`; e qualquer trecho identificável como valor de `code`, `state`, `code_verifier`, `client_secret`, `access_token` ou `refresh_token` dentro de uma string (ex.: um parâmetro embutido em uma URL completa, ou um segredo concatenado dentro de uma mensagem de erro). Isso é adicional à redação por nome de chave (que já cobre o caso de o segredo estar isolado no valor de uma chave sensível) — cobre o caso em que o segredo está **dentro** de uma string maior. Mensagens internas continuam estáticas (nunca interpolando `error.message`/`response` externos brutos, já proibido acima).

**Testes obrigatórios de redação:** `ML_CLIENT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `encryptedAccessToken`, `nested.refresh_token` (aninhado), `token`, e a **preservação** de `failureCode`, `statusCode` e `tokenVersion` (prova negativa de sobre-redação). Segredos embutidos em strings, URLs completas e objetos aninhados também são cobertos — incluindo casos específicos do sanitizador recursivo: um segredo dentro de `message`, dentro de uma URL completa, e dentro de um objeto aninhado, provando em cada caso que o valor original não aparece na saída.

## 9. Testes obrigatórios (TDD, PostgreSQL 16 real)

`/oauth/token` e `/users/me` são chamadas HTTP reais mockadas na fronteira HTTP. `/authorization` **não é uma chamada HTTP do backend** — é testada de forma determinística (parâmetros da URL gerada e seu encoding), sem nenhum mock HTTP associado.

- Geração/hash de `state` e PKCE; CAS de `tokenVersion`; mapeamento `failureCode → reason` público; redação de logs por nome de chave e sanitização recursiva de valores textuais (§8), incluindo segredo dentro de `message`, dentro de URL completa e dentro de objeto aninhado.
- Construção determinística da URL de `/authorization` (parâmetros, `code_challenge_method=S256`, encoding).
- Dois `POST /connect` concorrentes na mesma conta (índice único parcial decide).
- Callback concorrendo com refresh na mesma conta (advisory lock decide).
- Callback concorrendo com outro callback (mesma conta e contas diferentes; contas diferentes não bloqueiam uma à outra).
- Callback com `error` reivindicando o `state` **antes** da finalização (prova da ordem do §6.2: claim primeiro, interpretação de `error`/`code` depois).
- Replay do callback depois de `SUCCESS` e depois de `FAILED` (o `UPDATE` condicionado a `status='PROCESSING'` não tem efeito).
- Recovery (§6.3.b) tentando atuar enquanto o callback legítimo ainda detém o advisory lock — a tentativa não é marcada `FAILED`.
- Expiração de `PENDING` (§6.3.a) e limpeza de `encryptedCodeVerifier` em sucesso, falha, cancelamento (`AUTHORIZATION_DENIED`) e expiração — quatro cenários distintos.
- Rollback atômico: conta nunca fica `CONNECTED` se a tentativa não virar `SUCCESS`; tentativa nunca vira `SUCCESS` se o CAS da conta falhar.
- Violação de unicidade de `external_seller_id` ocorrendo depois da checagem prévia (corrida real, não só a checagem otimista).
- `code`/`state` ausentes, duplicados, tamanho excessivo, ou enviados junto com `error`; `error=access_denied` acompanhado de `error_description` (prova de que o valor nunca é logado/persistido/redirecionado); parâmetro inesperado na query string do callback (rejeitado antes do claim).
- `error` do provedor diferente de `access_denied` (→ `AUTHORIZATION_PROVIDER_ERROR`).
- Resposta HTTP definitiva de erro na troca inicial (→ `TOKEN_EXCHANGE_FAILED`) vs. resposta `200` estruturalmente inválida (→ `INVALID_TOKEN_RESPONSE`) vs. timeout/resultado desconhecido (→ `CALLBACK_RESULT_UNKNOWN`) — três testes distintos.
- Resposta de token sem `access_token`/`refresh_token`/`user_id`/`expires_in`; `expires_in` zero, negativo, texto, ou acima do teto interno (§10); `token_type` diferente de `bearer` (variação de maiúsculas/minúsculas aceita, valores realmente inválidos rejeitados); `scope` sem `read`; `scope` contendo `write` (rejeitado por privilégio mínimo).
- Refresh rejeitado definitivamente (`invalid_grant` → `REFRESH_TOKEN_REJECTED` → conta `TOKEN_EXPIRED`) vs. timeout ambíguo (`REFRESH_RESULT_UNKNOWN` → conta `ERROR`) — status exatos, comportamentos e códigos distintos.
- Falha de descriptografia / conteúdo GCM adulterado (`CREDENTIAL_DECRYPTION_FAILED`), tanto para `encryptedCodeVerifier` quanto `encryptedRefreshToken`.
- CAS falhando depois do token já emitido pelo ML: `TOKEN_RESULT_NOT_COMMITTED` no callback; e `REFRESH_RESULT_NOT_COMMITTED` no refresh — provando que a conta preserva integralmente o estado mais recente (ex.: uma reconexão concorrente que já mudou a `tokenVersion`), sem ser forçada para `ERROR` nem qualquer outro status fixo.
- Chave de advisory lock determinística e idêntica entre instâncias (mesmo `accountId` → mesmo `bigint`, verificado por teste de unidade da função de derivação).
- Job de renovação executando "simultaneamente" em duas instâncias simuladas (advisory lock em conexões físicas diferentes) e não sobreposto dentro da mesma instância.
- `UPDATE` de finalização da tentativa sempre condicionado a `status='PROCESSING'`.
- `ensureValidAccessToken`: token dentro da janela `ML_TOKEN_REFRESH_LEEWAY_MS` (não chama o ML) e token precisando renovar; conta `ERROR` e conta `TOKEN_EXPIRED` **nunca** retornam token mesmo com `tokenExpiresAt` no futuro; a validação de elegibilidade é reaplicada depois da releitura pós-lock (conta que deixou de ser `CONNECTED` enquanto esperava o lock falha sem chamar o ML).
- Reconexão com identidade igual (aceita) e identidade diferente (rejeita, preserva conta original).
- Preservação de `SyncRun` associados durante reconexão (mesma linha `MarketplaceAccount`).
- Transições de status válidas para todas as combinações (`DISCONNECTED/TOKEN_EXPIRED/ERROR/CONNECTED`); isolamento entre contas (uma não afeta outra).
- Validação completa de `ML_REDIRECT_URI` (HTTPS em produção, HTTP só em desenvolvimento, sem query/fragmento, caminho exato do callback).
- Redirect final construído só com `FRONTEND_URL` fixa (sem `returnUrl` arbitrário); ausência de query string nos logs.
- Bloqueio de rede (ex.: interceptor que derruba qualquer chamada HTTP real não mockada) garantindo que nenhum teste chegue a tocar a rede de verdade.

## 10. Validação de resposta e expiração

- `expires_in` deve ser um inteiro seguro (`Number.isSafeInteger`), maior que zero, e produzir uma data válida ao somar a `now()`.
- **Teto interno declarado explicitamente**: a doc oficial não define um limite máximo formal (só a inconsistência "6 horas" vs. exemplo `10800`, já registrada em §2). Este design define um teto conservador de **86400 segundos (24h)** como proteção contra resposta malformada/corrompida — **não é a validade oficial do token do ML**, é só uma guarda defensiva. Valores acima disso → `INVALID_TOKEN_RESPONSE`.
- **`token_type` e `scope`**: `token_type` deve ser `bearer` (comparação case-insensitive); `scope` retornado é normalizado (dividido por espaço, minúsculo) e deve conter `read`; se contiver `write`, a resposta é rejeitada (o projeto é somente leitura — ver §2). `refresh_token` continua obrigatório em toda resposta bem-sucedida (é a evidência de que `offline_access` foi de fato concedido; a confirmação de que o app está corretamente configurado no DevCenter para isso é a pendência operacional já registrada em §12). Qualquer uma dessas violações → `INVALID_TOKEN_RESPONSE`, sem persistir tokens.
- Diferenciação obrigatória de causas na troca de token (§6.2, passo 7): resposta HTTP definitiva de erro → `TOKEN_EXCHANGE_FAILED`; resposta estruturalmente inválida → `INVALID_TOKEN_RESPONSE`; timeout/resultado desconhecido → `CALLBACK_RESULT_UNKNOWN`.

## 11. Homologação obrigatória (PostgreSQL 16 descartável, antes de considerar a fase concluída)

- Migration aplicada (`migration:run`), depois `migration:revert`, depois reaplicada — sem erros.
- Inspeção manual dos índices (incluindo os dois índices parciais separados de `PENDING`/`PROCESSING` e o índice único de tentativa ativa), FKs e defaults criados (incluindo `token_version DEFAULT 0`).
- Teste de advisory lock usando conexões físicas diferentes de verdade (não só simuladas em processo único).
- Nenhuma chamada real ao Mercado Livre em nenhum teste.
- Nenhum teste `.skip`/`.only`/equivalente.
- Zero handles abertos após a suíte Jest.
- Lint, TypeScript, testes e build passando em backend e frontend.
- **Varredura de segredos no diff, incluindo arquivos novos/untracked** (não só `git diff` contra HEAD, que ignora arquivos ainda não rastreados): `git status --short` + inspeção do conjunto relevante de arquivos do repositório + diff de arquivos staged e untracked. Nenhum `.env` ou segredo real versionado.
- Working tree limpo e SHA do commit base documentados no PR/commit final.

**Pendência operacional explícita (fora da suíte automatizada):** a implementação automatizada desta fase usa exclusivamente mocks na fronteira HTTP. Antes de produção será necessário, fora do Git e sem depender desta suíte: cadastrar/configurar a aplicação no DevCenter (Reading habilitado, Writing desabilitado — ver §2); configurar `ML_REDIRECT_URI` real; executar uma conexão OAuth manual controlada com uma conta autorizada de teste; verificar uma renovação real sem registrar tokens em nenhum log. Essa validação manual depende de credenciais fornecidas fora do Git e não substitui nem é substituída pelos testes automatizados.

## 12. Decisões pendentes (não inventadas — registradas para confirmação futura)

- Confirmar diretamente na tela de configuração do app no DevCenter se a emissão de `refresh_token` (offline access) é automática para aplicações Server Side com Reading habilitado, ou se exige alguma configuração adicional além de Reading/Writing (§2) — a doc consultada não resolve isso de forma explícita.
- Confirmar operacionalmente se o app Mercado Livre do projeto tem PKCE marcado como obrigatório no painel — irrelevante para o comportamento (sempre enviamos `S256`), mas deve ser verificado antes de produção.
- `ML_HTTP_TIMEOUT_MS=10000`, `ML_OAUTH_PROCESSING_STALE_AFTER_MS=120000`, `ML_ACCOUNT_LOCK_WAIT_MS=3000` e `ML_TOKEN_REFRESH_LEEWAY_MS=900000` são valores iniciais razoáveis, ajustáveis por configuração, e não amarrados a nenhuma validade de token documentada pelo ML.
- Confirmar durante a implementação se `LoggingInterceptor` atual já exclui querystring de requisições logadas; caso não exclua, a rota de callback precisa de tratamento explícito adicional.
