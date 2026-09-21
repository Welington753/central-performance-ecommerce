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
  | 'SOURCE_ENV_LOAD_FAILED'
  | 'SOURCE_CONFIG_INVALID'
  | 'SOURCE_CONNECTION_FAILED'
  | 'TARGET_CONFIG_INVALID'
  | 'TARGET_CONNECTION_FAILED'
  | 'SOURCE_PREFLIGHT_FAILED'
  | 'TARGET_PREFLIGHT_FAILED'
  | 'REENCRYPTION_FAILED'
  | 'TARGET_TRANSACTION_FAILED'
  | 'TARGET_ROLLBACK_FAILED'
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

/**
 * Converte um erro inesperado (driver, TLS, rede, sistema de arquivos) no
 * código fechado do ESTÁGIO em que ele ocorreu, no ponto mais próximo da
 * origem. É o que impede um `Error` cru — cuja mensagem pode conter host,
 * usuário, SQL com parâmetros ou trecho de payload — de chegar à saída.
 * Erros já classificados passam intactos, preservando seu código original.
 */
export async function runStage<T>(
  reason: MigrationAbortReason,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAbortedError(error, reason);
  }
}

export function runStageSync<T>(reason: MigrationAbortReason, run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw toAbortedError(error, reason);
  }
}

export function toAbortedError(
  error: unknown,
  reason: MigrationAbortReason,
): MigrationAbortedError {
  if (error instanceof MigrationAbortedError) {
    return error;
  }
  return new MigrationAbortedError(reason);
}
