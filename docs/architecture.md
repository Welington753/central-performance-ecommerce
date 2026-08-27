# Arquitetura multi-marketplace

## Princípio
Nenhum módulo do núcleo (`auth`, `users`, `sync`, `common`, `health`,
`integrations/marketplace-accounts`) pode importar ou referenciar diretamente uma classe
concreta de conector (`MercadoLivreConnector`, `AmazonConnector`, `ShopeeConnector`). Essa
regra é validada automaticamente por um teste (`backend/src/integrations/architecture.spec.ts`)
que varre o código-fonte dessas pastas e falha caso alguma delas mencione esses nomes.

## Identificador de marketplace
`Marketplace` é um enum TypeScript (`MERCADO_LIVRE`, `AMAZON`, `SHOPEE`) usado em código.
No PostgreSQL, toda coluna que armazena esse valor é `varchar` — nunca um `enum` nativo do
banco — para que adicionar um novo marketplace não exija uma migration de schema.

## Contrato do conector
`backend/src/integrations/contracts/marketplace-connector.interface.ts` define a interface
`MarketplaceConnector`, implementada por cada conector concreto
(`backend/src/integrations/connectors/*.connector.ts`). Nesta fase, cada conector é um
stub: `getCapabilities()` retorna `implemented: false` e `testConnection()` retorna um
resultado negativo, sem nenhuma chamada de rede.

## Registro de conectores
`ConnectorRegistryService` (`backend/src/integrations/connectors/connector-registry.service.ts`)
resolve o conector correto a partir do enum `Marketplace`. É a única peça do sistema que
conhece as classes concretas; o restante do sistema depende apenas da interface e do
registry, injetados via o token `MARKETPLACE_CONNECTORS`.

## Entidades e sincronizações
`MarketplaceAccount` suporta múltiplas contas por marketplace e múltiplos marketplaces
simultâneos, com credenciais (`encryptedAccessToken`/`encryptedRefreshToken`/
`encryptedCredentialMetadata`) protegidas por um `EncryptionService` genérico (AES-256-GCM,
chave `CREDENTIAL_ENCRYPTION_KEY`), reutilizável por qualquer marketplace futuro.
`SyncRun` registra o histórico de sincronizações, associável a uma conta específica
(`marketplaceAccountId`, opcional) e filtrável por conta/marketplace/status.

## Adicionar um novo marketplace (futuro)
1. Adicionar o valor ao enum `Marketplace`.
2. Criar `NovoConnector implements MarketplaceConnector` em `integrations/connectors/`.
3. Registrar no `ConnectorRegistryService`.
4. Nenhuma migration de schema é necessária apenas por causa do novo marketplace (as
   colunas já são `varchar`); migrations só serão necessárias se o novo marketplace exigir
   novos campos.
