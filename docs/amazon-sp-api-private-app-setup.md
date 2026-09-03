# Amazon SP-API — configuração da aplicação privada (Fase 4)

Este documento descreve os passos que **o usuário principal da conta Amazon**
(o dono/administrador do Seller Central da empresa) precisa executar fora
deste repositório para que a fundação de autenticação implementada no
Checkpoint 4-A possa ser configurada e homologada. Nenhum valor real,
captura de tela ou link contendo token é incluído aqui — este arquivo é
seguro para versionar.

## 1. O que é uma "aplicação privada"

A Amazon SP-API distingue aplicações **públicas** (publicadas para uso por
terceiros, exigem processo de certificação) de aplicações **privadas**
(uso exclusivo da própria empresa dona da conta Seller Central, sem
certificação pública). A Central de Performance usa uma aplicação
**privada**: ela é criada e autoautorizada pelo próprio usuário principal da
conta, sem nunca sair do controle da empresa.

## 2. Quem precisa agir

Só o **usuário principal (owner) do Seller Central** consegue:

- criar a aplicação privada;
- autoautorizá-la (o fluxo de "self-authorization" da Amazon, que gera o
  refresh token sem precisar de um redirect OAuth público);
- conceder os papéis (roles) de acesso necessários.

Nenhuma outra conta/usuário do Seller Central tem permissão para essas
ações.

## 3. Onde encontrar (localização geral, sem link com token)

Dentro do **Seller Central**, na área de desenvolvimento de aplicativos
("Develop Apps" / "Desenvolver aplicativos"), existe a opção de criar uma
nova aplicação privada. É lá que o Application ID, o LWA Client ID e o LWA
Client Secret são gerados, e é lá também que a autoautorização (que produz o
refresh token) é executada.

## 4. Valores que precisaremos obter (placeholders — sem valores reais aqui)

Depois que o usuário principal criar e autoautorizar a aplicação, ele
precisará repassar (por um canal seguro, nunca pelos meios listados na
seção 6) os seguintes valores, que preenchem as variáveis de ambiente já
preparadas em `backend/.env.example`:

| Valor | Variável de ambiente correspondente |
|---|---|
| Application ID | `AMAZON_SP_API_APP_ID` |
| LWA Client ID | `AMAZON_LWA_CLIENT_ID` |
| LWA Client Secret | `AMAZON_LWA_CLIENT_SECRET` |
| Selling Partner ID | inserido pela tela `/integracoes` (nunca por variável de ambiente) |
| Refresh Token (da autoautorização) | inserido pela tela `/integracoes` (nunca por variável de ambiente) |

`AMAZON_SP_API_ENDPOINT` e `AMAZON_SP_API_USER_AGENT` **não** vêm do Seller
Central — já estão documentados com o valor correto (o endpoint regional
oficial da conta, ex. América do Norte) em `backend/.env.example`.

O **Selling Partner ID** e o **Refresh Token** são credenciais de **conta**,
não de aplicação — nunca são colocados em variável de ambiente. Desde o
Checkpoint 4-C, eles são inseridos pela tela `/integracoes` (assistente
"Configurar Amazon"), que chama
`POST /marketplace-accounts/:id/amazon/provision` — o mesmo
`AmazonAuthService.provisionAccount` desta fundação, agora exposto por um
controller autenticado, que continua criptografando o refresh token
imediatamente antes de qualquer persistência. Ver
`docs/amazon-connection-readiness.md` para o passo a passo completo (o que
já está pronto, o que pedir ao usuário principal, e como testar/sincronizar
sem usar credenciais reais).

## 5. Papéis (roles) a verificar durante a autoautorização

Ao autoautorizar a aplicação privada, a Amazon pede para selecionar quais
papéis de acesso ela terá. Para este checkpoint e a próxima etapa de
sincronização de pedidos, os papéis necessários são:

- **Inventory and Order Tracking** — leitura de pedidos e estoque.
- **Finance and Accounting** — necessário para a futura etapa financeira
  (comissão, frete, margem), ainda não implementada.

**Não solicite, nesta fase, nenhum papel restrito de PII de comprador**
(ex.: dados pessoais de destinatário) — o sistema não persiste e não
solicita esse tipo de dado.

## 6. Como NUNCA transportar as credenciais

As credenciais (Client Secret, Refresh Token, ou qualquer segredo) nunca
devem ser enviadas por:

- WhatsApp ou qualquer mensageiro;
- Git (commit, PR, issue, ou qualquer arquivo versionado);
- este relatório ou qualquer relatório gerado por IA;
- qualquer conversa com uma IA/assistente (incluindo esta).

Elas só devem ser inseridas diretamente no arquivo `.env` real do backend
(nunca versionado — já protegido pelo `.gitignore`) ou transmitidas por um
canal interno seguro definido pela própria empresa.

## 7. Próxima etapa

Depois que o usuário principal tiver a aplicação privada criada e
autoautorizada (com Application ID, LWA Client ID, LWA Client Secret,
Selling Partner ID e Refresh Token em mãos), a próxima etapa é o
passo a passo operacional completo em
`docs/amazon-connection-readiness.md`: preencher as variáveis de ambiente,
abrir `/integracoes`, cadastrar o Selling Partner ID e o Refresh Token pela
tela, testar a conexão e só então executar a primeira sincronização real —
nunca antes disso.
