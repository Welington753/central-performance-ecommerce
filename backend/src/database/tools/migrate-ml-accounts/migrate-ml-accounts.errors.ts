/**
 * Conexão SQL mínima exigida pela ferramenta: uma ÚNICA conexão dedicada
 * (nunca um pool), porque `BEGIN`/`COMMIT`/`ROLLBACK` só são atômicos na
 * mesma conexão. É satisfeita pelo `QueryRunner` do TypeORM.
 */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<unknown[]>;
}

export type MigrationAbortReason =
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_MISMATCH'
  | 'CONFIRMATION_WITHOUT_APPLY'
  | 'UNKNOWN_ARGUMENT'
  | 'SOURCE_DATABASE_URL_MISSING'
  | 'SOURCE_CREDENTIAL_ENCRYPTION_KEY_MISSING'
  | 'TARGET_DATABASE_URL_MISSING'
  | 'TARGET_CREDENTIAL_ENCRYPTION_KEY_MISSING'
  | 'SOURCE_KEY_INVALID'
  | 'TARGET_KEY_INVALID'
  | 'SOURCE_ROW_MALFORMED'
  | 'SOURCE_ACCOUNT_MISSING'
  | 'SOURCE_ACCOUNT_UNEXPECTED'
  | 'SOURCE_MARKETPLACE_INVALID'
  | 'SOURCE_STATUS_INVALID'
  | 'SOURCE_SELLER_ID_MISMATCH'
  | 'SOURCE_NICKNAME_MISMATCH'
  | 'SOURCE_ACCESS_TOKEN_MISSING'
  | 'SOURCE_REFRESH_TOKEN_MISSING'
  | 'SOURCE_DECRYPTION_FAILED'
  | 'SOURCE_PLAINTEXT_EMPTY'
  | 'TARGET_SCHEMA_INCOMPATIBLE'
  | 'TARGET_MIGRATIONS_INCOMPATIBLE'
  | 'TARGET_NOT_EMPTY'
  | 'TARGET_ID_COLLISION'
  | 'TARGET_SELLER_ID_COLLISION'
  | 'REENCRYPTION_VERIFICATION_FAILED'
  | 'INSERT_COUNT_MISMATCH';

/**
 * Falha controlada da migração. A mensagem É o código (mais, no máximo, o id
 * interno da conta envolvida) — nunca carrega token, plaintext, ciphertext,
 * chave ou URL de banco, seguindo o mesmo padrão fechado de
 * `ShopeeOrderMappingError`.
 */
export class MigrationAbortedError extends Error {
  constructor(
    public readonly reason: MigrationAbortReason,
    accountId?: string,
  ) {
    super(accountId ? `${reason} (conta ${accountId})` : reason);
  }
}
