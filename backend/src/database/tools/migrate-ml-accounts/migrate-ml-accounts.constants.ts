/**
 * Ferramenta one-off de migração das DUAS conexões Mercado Livre entre dois
 * PostgreSQL distintos (origem local, destino remoto), recriptografando os
 * tokens com a chave do destino.
 *
 * Este arquivo concentra tudo que é fixo/auditável da operação: as contas
 * autorizadas, o token de confirmação e os limites da transação. Nenhum
 * segredo mora aqui — só identificadores públicos internos.
 */

/**
 * Confirmação literal exigida junto de `--apply`. Não é segredo: existe para
 * impedir execução acidental, nunca para autenticar quem executa.
 */
export const MIGRATION_CONFIRMATION_TOKEN = 'MIGRATE_ML_1548451374_1029648966';

export const MERCADO_LIVRE_MARKETPLACE = 'MERCADO_LIVRE';

export const EXPECTED_ACCOUNT_STATUS = 'CONNECTED';

export interface ExpectedAccountSpec {
  readonly id: string;
  readonly externalSellerId: string;
  readonly nickname: string;
}

/**
 * Allowlist fechada: a ferramenta migra EXATAMENTE estas duas contas. Ela
 * nunca descobre contas por conta própria, nunca migra uma terceira e aborta
 * se qualquer atributo divergir do esperado.
 */
export const EXPECTED_SOURCE_ACCOUNTS: readonly ExpectedAccountSpec[] = [
  {
    id: '7ca26d89-e3af-4b62-95c0-1d4ebf1eeaf7',
    externalSellerId: '1548451374',
    nickname: 'Mercado Livre 1',
  },
  {
    id: 'cda67ecc-0946-412e-8b6b-0dc0ecb2ba78',
    externalSellerId: '1029648966',
    nickname: 'Mercado Livre 2',
  },
];

/**
 * Migrations obrigatórias no destino. São as que criam/alteram as colunas de
 * `marketplace_accounts` usadas pelo INSERT — um destino sem elas não é um
 * schema compatível, e a ferramenta aborta antes de qualquer escrita.
 */
export const REQUIRED_TARGET_MIGRATIONS: readonly string[] = [
  'InitSchema1787837395713',
  'MercadoLivreOAuth1787900000000',
  'MarketplaceAccountsNicknameUniqueness1788200000000',
  'MarketplaceAccountsRefreshResilience1788300000000',
];

/**
 * Colunas efetivamente escritas pelo INSERT, conferidas contra
 * `information_schema.columns` do destino antes da transação.
 */
export const REQUIRED_TARGET_COLUMNS: readonly string[] = [
  'id',
  'marketplace',
  'external_seller_id',
  'nickname',
  'status',
  'encrypted_access_token',
  'encrypted_refresh_token',
  'encrypted_credential_metadata',
  'token_expires_at',
  'last_successful_sync_at',
  'connected_by_user_id',
  'token_version',
  'refresh_failure_count',
  'refresh_retry_at',
  'last_refresh_attempt_at',
  'created_at',
  'updated_at',
];

/** Nunca espera por um lock: um destino ocupado aborta em vez de travar. */
export const TRANSACTION_LOCK_TIMEOUT_MS = 5_000;

/** Teto por statement dentro da transação. */
export const TRANSACTION_STATEMENT_TIMEOUT_MS = 30_000;
