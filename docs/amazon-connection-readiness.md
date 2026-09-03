# Amazon — prontidão de conexão (Checkpoint 4-C)

Este documento é o guia operacional para conectar a **primeira conta Amazon
real** à Central de Performance. Nenhum valor real, captura de tela ou link
contendo token é incluído aqui — este arquivo é seguro para versionar. Para
o passo a passo de ONDE obter cada valor dentro do Seller Central, veja
`docs/amazon-sp-api-private-app-setup.md` — este documento assume que você
já tem (ou está prestes a ter) esses valores em mãos.

## 1. O que já está pronto (nenhuma ação necessária)

- **Autenticação LWA** (`AmazonAuthService`/`AmazonLwaClient`) — troca do
  refresh token por access token, com lock por conta e proteção contra
  corrida (Fase 4, Checkpoint 4-B-R1).
- **Criptografia de credenciais** (`EncryptionService`, AES-256-GCM) — o
  refresh token nunca é armazenado em texto plano.
- **Renovação automática de token** — access tokens são renovados sozinhos
  quando expiram (leeway configurável) e há renovação forçada quando a
  Amazon rejeita um token com 401/403 mesmo que ele pareça válido
  localmente (Checkpoint 4-B-R1).
- **Sincronização de pedidos (Orders API `v2026-01-01`)** —
  `AmazonOrdersSyncService`: paginação, retentativa com backoff, quarentena
  de pedidos financeiramente inconsistentes que nunca vira sucesso falso,
  limites de segurança que nunca produzem cobertura incompleta como se
  fosse completa (Checkpoint 4-B-R1).
- **Analytics/dashboard multi-marketplace** — a Amazon já participa dos
  KPIs, filtros e ranking de anúncios pela mesma arquitetura genérica do
  Mercado Livre, sem nenhuma duplicação (Checkpoint 4-B).
- **Tela de configuração** (`/integracoes`, seção "Amazon") — mostra o
  estado real da conta (nunca mais "Disponível futuramente") e guia o
  cadastro pelo assistente "Configurar Amazon".
- **Teste de conexão** (`POST /marketplace-accounts/:id/amazon/verify`) —
  uma chamada única, não persistente, que comprova acesso real à Orders API
  sem gravar nenhum pedido.

Tudo isso já está implementado, testado (unitário, integração com Postgres
real e, neste checkpoint, testado manualmente ponta a ponta com um Postgres
descartável — nunca com dados ou credenciais reais) e não precisa de
nenhuma alteração de código para a conexão real acontecer.

## 2. O que será necessário solicitar ao usuário principal (Primary User)

Só o **usuário principal (owner) do Seller Central** da conta Amazon
consegue realizar os passos abaixo — nenhuma outra conta tem essa
permissão. Peça a ele, nesta ordem:

1. **Confirmação de que ele é o Primary User** da conta Seller Central que
   será conectada.
2. **Application ID** da aplicação privada (gerada por ele no Seller
   Central — ver `docs/amazon-sp-api-private-app-setup.md`).
3. **LWA Client ID** da mesma aplicação.
4. **LWA Client Secret** da mesma aplicação.
5. **Selling Partner ID** da conta a conectar.
6. **Refresh Token** gerado na autoautorização (self-authorization) da
   aplicação privada.
7. **Confirmação dos marketplaces/países autorizados** — quais
   marketplaceIds da Amazon (ex.: o do Brasil) a aplicação foi autorizada a
   acessar, para preencher `AMAZON_MARKETPLACE_IDS` corretamente.

### Como NÃO transportar o Client Secret e o Refresh Token

Client Secret e Refresh Token **nunca** devem ser enviados por:

- WhatsApp, e-mail comum ou qualquer mensageiro;
- chamado/ticket de suporte;
- conversa com uma IA/assistente (incluindo esta);
- Git (commit, PR, issue ou qualquer arquivo versionado).

Formas seguras recomendadas: o próprio usuário principal insere os valores
**pessoalmente**, direto no computador onde o backend roda (para o `.env`)
e na tela `/integracoes` (para Selling Partner ID e Refresh Token); ou os
valores são compartilhados por um **gerenciador de senhas** da empresa.

## 3. Quais valores vão para onde

| Valor | Onde | Quando |
|---|---|---|
| Application ID | `.env` do backend — `AMAZON_SP_API_APP_ID` | uma vez, por ambiente |
| LWA Client ID | `.env` do backend — `AMAZON_LWA_CLIENT_ID` | uma vez, por ambiente |
| LWA Client Secret | `.env` do backend — `AMAZON_LWA_CLIENT_SECRET` | uma vez, por ambiente |
| Endpoint regional SP-API | `.env` do backend — `AMAZON_SP_API_ENDPOINT` | uma vez, por ambiente |
| User-Agent da aplicação | `.env` do backend — `AMAZON_SP_API_USER_AGENT` | uma vez, por ambiente |
| Marketplace IDs autorizados | `.env` do backend — `AMAZON_MARKETPLACE_IDS` (lista separada por vírgulas) | uma vez, por ambiente |
| Selling Partner ID | tela `/integracoes` → assistente "Configurar Amazon" | uma vez por conta (ou ao reconfigurar) |
| Refresh Token | tela `/integracoes` → assistente "Configurar Amazon" | uma vez por conta (ou ao reconfigurar, se a Amazon revogar o anterior) |

As seis primeiras variáveis são de **aplicação** (uma aplicação privada
Amazon é compartilhada por todas as contas que a empresa conectar) — vivem
exclusivamente no `.env` do backend, nunca em requisição HTTP nem no
frontend. As duas últimas são de **conta** — cada conta Amazon conectada
tem seu próprio Selling Partner ID e Refresh Token, inseridos pela tela.

**O backend precisa ser reiniciado depois de alterar o `.env`** — as seis
variáveis de aplicação só são lidas na inicialização do processo (via
`ConfigModule`); uma alteração no arquivo não é aplicada em um processo já
rodando.

## 4. Passo a passo para conectar a primeira conta real

1. Confirme com o usuário principal os sete itens da seção 2.
2. No servidor onde o backend roda, edite o `.env` real (nunca versionado)
   preenchendo as seis variáveis de aplicação da seção 3.
3. **Reinicie o backend.**
4. Abra `/integracoes` no navegador (autenticado como usuário do sistema).
5. Na seção "Amazon", confirme que o cartão não mostra mais "Configuração
   do servidor pendente" — se mostrar, confira os nomes de variável
   listados no próprio cartão (nunca valores, só nomes) e volte ao passo 2.
6. Clique em **"Configurar Amazon"** (conta nova) ou **"Continuar
   configuração"**/**"Reconfigurar credenciais"** (conta já criada).
7. No assistente: opcionalmente dê um apelido à conta (ex.: "Amazon
   principal"), cole o Selling Partner ID e o Refresh Token nos campos
   correspondentes.
8. Clique em **"Salvar e testar conexão"** — o backend criptografa e
   armazena as credenciais e, na sequência, faz uma única chamada de teste
   (não persistente) à Orders API para confirmar o acesso.
9. Se o teste for bem-sucedido, o cartão passa a mostrar **"Conectado"**
   com o Selling Partner ID/apelido.
10. Clique em **"Sincronizar agora"** para executar a primeira
    sincronização real de pedidos.

## 5. Como reconhecer cada erro sem expor credenciais

A tela sempre mostra uma mensagem fixa e sanitizada — nunca o texto bruto
do backend, nunca um payload, nunca um token. Guia de leitura:

| O que você vê | O que fazer |
|---|---|
| "Configuração do servidor pendente" + lista de nomes de variável | Preencha essas variáveis específicas no `.env` e reinicie o backend (passo 2–3 acima). |
| "A Amazon rejeitou o refresh token informado..." | O Refresh Token está errado, expirou, ou foi revogado. Peça ao usuário principal para gerar um novo na autoautorização e reconfigure. |
| "A Amazon rejeitou o acesso com essas credenciais..." | Confira o Selling Partner ID e o Refresh Token — provavelmente não pertencem à mesma conta, ou os papéis (roles) autorizados na autoautorização não cobrem Orders API. |
| "A aplicação Amazon está configurada incorretamente no servidor..." | O LWA Client ID/Secret no `.env` está errado — confirme com o usuário principal e corrija o `.env`. |
| "A Amazon está temporariamente indisponível..." / "...limitou a taxa..." | Problema transitório do lado da Amazon. Aguarde alguns minutos e tente novamente — nenhuma credencial foi apagada. |
| "Esta conta não é uma conta Amazon." | Você está chamando a rota Amazon com o id de uma conta de outro marketplace — confira o id usado. |
| "Não foi possível salvar as credenciais..." (mensagem genérica) | Falha de rede entre o navegador e o backend, ou o backend está indisponível. Tente novamente; se persistir, verifique se o backend está de pé. |

Em nenhum desses casos o Refresh Token digitado permanece no campo (ele é
sempre limpo após qualquer tentativa) nem aparece em nenhuma mensagem,
console do navegador ou log do backend — apenas o código fechado acima.

## 6. Nada disto usa dados reais

Este checkpoint (4-C) foi implementado e testado inteiramente com:

- credenciais fictícias/mockadas em todos os testes automatizados;
- a fronteira de rede (`fetch`) sempre injetada e mockada — zero chamada
  real à Amazon em qualquer teste;
- um Postgres 16 **descartável** (`--rm --tmpfs`), nunca o banco de
  desenvolvimento/produção;
- uma verificação manual ponta a ponta (criar conta → provisionar →
  consultar status → testar conexão) também contra esse mesmo Postgres
  descartável, com a aplicação Amazon deliberadamente **não configurada**
  no `.env` — provando que o fluxo funciona e nunca tenta uma chamada real
  quando a configuração está ausente.

Nenhuma conexão real com a Amazon foi estabelecida durante o
desenvolvimento deste checkpoint.
