import { buildCipher, reencryptToken } from './credential-cipher';
import {
  MERCADO_LIVRE_MARKETPLACE,
  TRANSACTION_LOCK_TIMEOUT_MS,
  TRANSACTION_STATEMENT_TIMEOUT_MS,
} from './migrate-ml-accounts.constants';
import {
  MigrationAbortedError,
  type SqlClient,
} from './migrate-ml-accounts.errors';
import {
  loadSourceAccounts,
  type ValidatedSourceAccount,
} from './source-preflight';
import {
  assertTargetHasNoConflicts,
  assertTargetIsReady,
} from './target-preflight';

export { createCredentialCipher } from './credential-cipher';
export {
  MigrationAbortedError,
  type MigrationAbortReason,
  type SqlClient,
} from './migrate-ml-accounts.errors';

export type MigrationMode = 'dry-run' | 'apply';

export interface SanitizedAccountReport {
  id: string;
  externalSellerId: string | null;
  nickname: string | null;
  status: string;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  tokenVersion: number;
  reencrypted: boolean;
}

export interface MigrationReport {
  mode: MigrationMode;
  accounts: SanitizedAccountReport[];
  plannedInserts: number;
  insertedCount: number;
  outcome: 'rollback' | 'commit';
}

export interface MigrateInput {
  sourceClient: SqlClient;
  targetClient: SqlClient;
  sourceEncryptionKey: string;
  targetEncryptionKey: string;
  mode: MigrationMode;
}

/** Linha pronta para o INSERT: tokens já recriptografados com a chave do destino. */
interface PreparedAccount {
  row: ValidatedSourceAccount;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
}

const TARGET_INSERT = `
  INSERT INTO marketplace_accounts (
    id, marketplace, external_seller_id, nickname, status,
    encrypted_access_token, encrypted_refresh_token,
    encrypted_credential_metadata, token_expires_at, last_successful_sync_at,
    error_summary, failure_code, connected_by_user_id, token_version,
    refresh_failure_count, refresh_retry_at, last_refresh_attempt_at,
    created_at, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, NULL, NULL, NULL,
    $10, $11, $12, $13, $14, $15
  )
  RETURNING id`;

/**
 * Migra as DUAS conexões Mercado Livre da allowlist entre dois bancos,
 * recriptografando os tokens com a chave do destino.
 *
 * `dry-run` (padrão) percorre exatamente o mesmo caminho do `apply` —
 * incluindo os INSERTs reais dentro da transação — e SEMPRE termina em
 * `ROLLBACK`. Nenhum caminho faz UPDATE, UPSERT ou DELETE: o destino só
 * recebe linhas novas, e apenas quando está comprovadamente sem contas
 * Mercado Livre.
 */
export async function migrateMercadoLivreAccounts(
  input: MigrateInput,
): Promise<MigrationReport> {
  const targetCipher = buildCipher(input.targetEncryptionKey, 'target');
  const sourceCipher = buildCipher(input.sourceEncryptionKey, 'source');

  const rows = await loadSourceAccounts(input.sourceClient);
  await assertTargetIsReady(input.targetClient);

  const prepared = rows.map((row) => ({
    row,
    encryptedAccessToken: reencryptToken(
      row.encryptedAccessToken,
      row.id,
      sourceCipher,
      targetCipher,
    ),
    encryptedRefreshToken: reencryptToken(
      row.encryptedRefreshToken,
      row.id,
      sourceCipher,
      targetCipher,
    ),
  }));

  return writeInTransaction(input, prepared);
}

async function writeInTransaction(
  input: MigrateInput,
  prepared: PreparedAccount[],
): Promise<MigrationReport> {
  const client = input.targetClient;
  await client.query('BEGIN');

  try {
    await client.query(
      `SET LOCAL lock_timeout = '${TRANSACTION_LOCK_TIMEOUT_MS}ms'`,
    );
    await client.query(
      `SET LOCAL statement_timeout = '${TRANSACTION_STATEMENT_TIMEOUT_MS}ms'`,
    );
    await assertTargetHasNoConflicts(client);

    let insertedCount = 0;
    for (const account of prepared) {
      const inserted = await client.query(
        TARGET_INSERT,
        toInsertValues(account),
      );
      if (inserted.length !== 1) {
        throw new MigrationAbortedError(
          'INSERT_COUNT_MISMATCH',
          account.row.id,
        );
      }
      insertedCount += 1;
    }

    if (insertedCount !== prepared.length) {
      throw new MigrationAbortedError('INSERT_COUNT_MISMATCH');
    }

    const outcome = input.mode === 'apply' ? 'commit' : 'rollback';
    await client.query(input.mode === 'apply' ? 'COMMIT' : 'ROLLBACK');

    return {
      mode: input.mode,
      accounts: prepared.map(toSanitizedReport),
      plannedInserts: prepared.length,
      insertedCount,
      outcome,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function toInsertValues(account: PreparedAccount): unknown[] {
  const { row } = account;
  return [
    row.id,
    MERCADO_LIVRE_MARKETPLACE,
    row.externalSellerId,
    row.nickname,
    row.status,
    account.encryptedAccessToken,
    account.encryptedRefreshToken,
    row.tokenExpiresAt,
    row.lastSuccessfulSyncAt,
    row.tokenVersion,
    row.refreshFailureCount,
    row.refreshRetryAt,
    row.lastRefreshAttemptAt,
    row.createdAt,
    row.updatedAt,
  ];
}

function toSanitizedReport(account: PreparedAccount): SanitizedAccountReport {
  return {
    id: account.row.id,
    externalSellerId: account.row.externalSellerId,
    nickname: account.row.nickname,
    status: account.row.status,
    hasAccessToken: account.encryptedAccessToken.length > 0,
    hasRefreshToken: account.encryptedRefreshToken.length > 0,
    tokenVersion: account.row.tokenVersion,
    reencrypted: true,
  };
}
