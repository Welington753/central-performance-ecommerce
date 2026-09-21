import {
  EXPECTED_SOURCE_ACCOUNTS,
  MERCADO_LIVRE_MARKETPLACE,
  REQUIRED_TARGET_COLUMNS,
  REQUIRED_TARGET_MIGRATIONS,
} from './migrate-ml-accounts.constants';
import {
  MigrationAbortedError,
  type SqlClient,
} from './migrate-ml-accounts.errors';
import { asRecord, readCount, readString } from './row-readers';

/**
 * Destino só é aceito se: o schema tiver todas as colunas escritas pelo
 * INSERT, as migrations que as criaram estiverem aplicadas e não houver
 * NENHUMA conta Mercado Livre nem colisão de UUID/seller id (em qualquer
 * marketplace). Contas Shopee/Amazon existentes nunca são lidas em detalhe,
 * alteradas ou apagadas.
 */
export async function assertTargetIsReady(client: SqlClient): Promise<void> {
  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'marketplace_accounts'`,
  );
  const present = new Set(
    columns.map((row) => readString(asRecord(row), 'column_name')),
  );
  for (const column of REQUIRED_TARGET_COLUMNS) {
    if (!present.has(column)) {
      throw new MigrationAbortedError('TARGET_SCHEMA_INCOMPATIBLE');
    }
  }

  const migrations = await client.query(
    `SELECT name FROM migrations WHERE name = ANY($1::text[])`,
    [[...REQUIRED_TARGET_MIGRATIONS]],
  );
  if (migrations.length !== REQUIRED_TARGET_MIGRATIONS.length) {
    throw new MigrationAbortedError('TARGET_MIGRATIONS_INCOMPATIBLE');
  }

  await assertTargetHasNoConflicts(client);
}

/**
 * Revalidado também DENTRO da transação: entre o preflight e o INSERT, outro
 * processo poderia ter conectado uma conta Mercado Livre no destino.
 */
export async function assertTargetHasNoConflicts(
  client: SqlClient,
): Promise<void> {
  const ids = EXPECTED_SOURCE_ACCOUNTS.map((account) => account.id);
  const sellerIds = EXPECTED_SOURCE_ACCOUNTS.map(
    (account) => account.externalSellerId,
  );

  const rows = await client.query(
    `SELECT
       (SELECT count(*) FROM marketplace_accounts
         WHERE marketplace = $1) AS marketplace_count,
       (SELECT count(*) FROM marketplace_accounts
         WHERE id = ANY($2::uuid[])) AS id_collisions,
       (SELECT count(*) FROM marketplace_accounts
         WHERE external_seller_id = ANY($3::text[])) AS seller_collisions`,
    [MERCADO_LIVRE_MARKETPLACE, ids, sellerIds],
  );

  const row = rows[0];
  if (readCount(row, 'marketplace_count') !== 0) {
    throw new MigrationAbortedError('TARGET_NOT_EMPTY');
  }
  if (readCount(row, 'id_collisions') !== 0) {
    throw new MigrationAbortedError('TARGET_ID_COLLISION');
  }
  if (readCount(row, 'seller_collisions') !== 0) {
    throw new MigrationAbortedError('TARGET_SELLER_ID_COLLISION');
  }
}
