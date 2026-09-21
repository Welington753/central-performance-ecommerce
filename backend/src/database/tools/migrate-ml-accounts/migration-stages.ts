import type { MigrationAbortReason } from './migrate-ml-accounts.errors';

/**
 * Nomes de etapa seguros para exibição. São rótulos fixos — nunca derivados
 * de mensagem de driver, host, arquivo ou SQL.
 */
export type MigrationStage =
  | 'argumentos'
  | 'segredos-origem'
  | 'segredos-destino'
  | 'conexao-origem'
  | 'conexao-destino'
  | 'preflight-origem'
  | 'preflight-destino'
  | 'recriptografia'
  | 'transacao-destino';

/**
 * `Record` (não `switch`) garante em tempo de compilação que todo código do
 * vocabulário fechado tem uma etapa — um código novo sem etapa quebra o
 * build, nunca cai num rótulo genérico em produção.
 */
const STAGE_BY_REASON: Record<MigrationAbortReason, MigrationStage> = {
  CONFIRMATION_REQUIRED: 'argumentos',
  CONFIRMATION_MISMATCH: 'argumentos',
  CONFIRMATION_WITHOUT_APPLY: 'argumentos',
  UNKNOWN_ARGUMENT: 'argumentos',
  SOURCE_ENV_LOAD_FAILED: 'segredos-origem',
  SOURCE_DATABASE_URL_MISSING: 'segredos-origem',
  SOURCE_CREDENTIAL_ENCRYPTION_KEY_MISSING: 'segredos-origem',
  SOURCE_CONFIG_INVALID: 'segredos-origem',
  SOURCE_KEY_INVALID: 'segredos-origem',
  TARGET_DATABASE_URL_MISSING: 'segredos-destino',
  TARGET_CREDENTIAL_ENCRYPTION_KEY_MISSING: 'segredos-destino',
  TARGET_CONFIG_INVALID: 'segredos-destino',
  TARGET_KEY_INVALID: 'segredos-destino',
  SOURCE_CONNECTION_FAILED: 'conexao-origem',
  TARGET_CONNECTION_FAILED: 'conexao-destino',
  SOURCE_PREFLIGHT_FAILED: 'preflight-origem',
  SOURCE_ROW_MALFORMED: 'preflight-origem',
  SOURCE_ACCOUNT_MISSING: 'preflight-origem',
  SOURCE_ACCOUNT_UNEXPECTED: 'preflight-origem',
  SOURCE_MARKETPLACE_INVALID: 'preflight-origem',
  SOURCE_STATUS_INVALID: 'preflight-origem',
  SOURCE_SELLER_ID_MISMATCH: 'preflight-origem',
  SOURCE_NICKNAME_MISMATCH: 'preflight-origem',
  SOURCE_ACCESS_TOKEN_MISSING: 'preflight-origem',
  SOURCE_REFRESH_TOKEN_MISSING: 'preflight-origem',
  TARGET_PREFLIGHT_FAILED: 'preflight-destino',
  TARGET_SCHEMA_INCOMPATIBLE: 'preflight-destino',
  TARGET_MIGRATIONS_INCOMPATIBLE: 'preflight-destino',
  TARGET_NOT_EMPTY: 'preflight-destino',
  TARGET_ID_COLLISION: 'preflight-destino',
  TARGET_SELLER_ID_COLLISION: 'preflight-destino',
  REENCRYPTION_FAILED: 'recriptografia',
  SOURCE_DECRYPTION_FAILED: 'recriptografia',
  SOURCE_PLAINTEXT_EMPTY: 'recriptografia',
  REENCRYPTION_VERIFICATION_FAILED: 'recriptografia',
  TARGET_TRANSACTION_FAILED: 'transacao-destino',
  TARGET_ROLLBACK_FAILED: 'transacao-destino',
  INSERT_COUNT_MISMATCH: 'transacao-destino',
};

export function stageOfReason(reason: MigrationAbortReason): MigrationStage {
  return STAGE_BY_REASON[reason];
}
