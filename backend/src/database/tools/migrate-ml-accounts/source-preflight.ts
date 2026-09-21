import {
  EXPECTED_ACCOUNT_STATUS,
  EXPECTED_SOURCE_ACCOUNTS,
  MERCADO_LIVRE_MARKETPLACE,
  type ExpectedAccountSpec,
} from './migrate-ml-accounts.constants';
import {
  MigrationAbortedError,
  type SqlClient,
} from './migrate-ml-accounts.errors';
import {
  asRecord,
  readDate,
  readString,
  requireDate,
  requireInteger,
  requireString,
} from './row-readers';

export interface SourceAccountRow {
  id: string;
  marketplace: string;
  externalSellerId: string | null;
  nickname: string | null;
  status: string;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  tokenExpiresAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  tokenVersion: number;
  refreshFailureCount: number;
  refreshRetryAt: Date | null;
  lastRefreshAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Linha de origem já validada: os dois tokens existem, comprovadamente. */
export type ValidatedSourceAccount = Omit<
  SourceAccountRow,
  'encryptedAccessToken' | 'encryptedRefreshToken'
> & {
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
};

const SOURCE_SELECT = `
  SELECT id, marketplace, external_seller_id, nickname, status,
         encrypted_access_token, encrypted_refresh_token,
         token_expires_at, last_successful_sync_at, token_version,
         refresh_failure_count, refresh_retry_at, last_refresh_attempt_at,
         created_at, updated_at
    FROM marketplace_accounts
   WHERE id = ANY($1::uuid[])`;

/**
 * Carrega EXATAMENTE as duas contas da allowlist. Nunca descobre contas por
 * conta própria: qualquer ausência, divergência de atributo ou token nulo
 * aborta antes de a ferramenta tocar no destino.
 */
export async function loadSourceAccounts(
  client: SqlClient,
): Promise<ValidatedSourceAccount[]> {
  const expectedIds = EXPECTED_SOURCE_ACCOUNTS.map((account) => account.id);
  const rows = (await client.query(SOURCE_SELECT, [expectedIds])).map(
    toSourceAccountRow,
  );

  for (const row of rows) {
    if (!expectedIds.includes(row.id)) {
      throw new MigrationAbortedError('SOURCE_ACCOUNT_UNEXPECTED', row.id);
    }
  }

  return EXPECTED_SOURCE_ACCOUNTS.map((spec) => {
    const row = rows.find((candidate) => candidate.id === spec.id);
    if (!row) {
      throw new MigrationAbortedError('SOURCE_ACCOUNT_MISSING', spec.id);
    }
    return validateSourceRow(row, spec);
  });
}

function validateSourceRow(
  row: SourceAccountRow,
  spec: ExpectedAccountSpec,
): ValidatedSourceAccount {
  if (row.marketplace !== MERCADO_LIVRE_MARKETPLACE) {
    throw new MigrationAbortedError('SOURCE_MARKETPLACE_INVALID', row.id);
  }
  if (row.externalSellerId !== spec.externalSellerId) {
    throw new MigrationAbortedError('SOURCE_SELLER_ID_MISMATCH', row.id);
  }
  if (row.nickname !== spec.nickname) {
    throw new MigrationAbortedError('SOURCE_NICKNAME_MISMATCH', row.id);
  }
  if (row.status !== EXPECTED_ACCOUNT_STATUS) {
    throw new MigrationAbortedError('SOURCE_STATUS_INVALID', row.id);
  }

  const encryptedAccessToken = row.encryptedAccessToken;
  if (encryptedAccessToken === null) {
    throw new MigrationAbortedError('SOURCE_ACCESS_TOKEN_MISSING', row.id);
  }
  const encryptedRefreshToken = row.encryptedRefreshToken;
  if (encryptedRefreshToken === null) {
    throw new MigrationAbortedError('SOURCE_REFRESH_TOKEN_MISSING', row.id);
  }

  return { ...row, encryptedAccessToken, encryptedRefreshToken };
}

function toSourceAccountRow(raw: unknown): SourceAccountRow {
  const row = asRecord(raw);
  return {
    id: requireString(row, 'id'),
    marketplace: requireString(row, 'marketplace'),
    externalSellerId: readString(row, 'external_seller_id'),
    nickname: readString(row, 'nickname'),
    status: requireString(row, 'status'),
    encryptedAccessToken: readString(row, 'encrypted_access_token'),
    encryptedRefreshToken: readString(row, 'encrypted_refresh_token'),
    tokenExpiresAt: readDate(row, 'token_expires_at'),
    lastSuccessfulSyncAt: readDate(row, 'last_successful_sync_at'),
    tokenVersion: requireInteger(row, 'token_version'),
    refreshFailureCount: requireInteger(row, 'refresh_failure_count'),
    refreshRetryAt: readDate(row, 'refresh_retry_at'),
    lastRefreshAttemptAt: readDate(row, 'last_refresh_attempt_at'),
    createdAt: requireDate(row, 'created_at'),
    updatedAt: requireDate(row, 'updated_at'),
  };
}
