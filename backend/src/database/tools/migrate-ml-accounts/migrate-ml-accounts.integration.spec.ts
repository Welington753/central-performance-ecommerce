import { randomUUID } from 'crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { requireTestDatabaseUrl } from '../../../test-utils/require-test-database-url';
import {
  EXPECTED_SOURCE_ACCOUNTS,
  REQUIRED_TARGET_MIGRATIONS,
} from './migrate-ml-accounts.constants';
import {
  createCredentialCipher,
  migrateMercadoLivreAccounts,
  MigrationAbortedError,
  type SqlClient,
} from './migrate-ml-accounts';

/**
 * Esta suíte exige DOIS PostgreSQL descartáveis já migrados:
 * `TEST_DATABASE_URL` (origem) e `TEST_TARGET_DATABASE_URL` (destino).
 * A ausência de qualquer um FALHA a suíte com erro claro — nunca pula em
 * silêncio (mesma política de `require-test-database-url.ts`).
 */
function requireTargetTestDatabaseUrl(): string {
  const url = process.env.TEST_TARGET_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_TARGET_DATABASE_URL não definida. Esta suíte exige um SEGUNDO PostgreSQL descartável, já migrado, representando o destino da migração.',
    );
  }
  return url;
}

const SOURCE_KEY = 'a'.repeat(64);
const TARGET_KEY = 'b'.repeat(64);
const WRONG_SOURCE_KEY = 'c'.repeat(64);

const ACCESS_PLAINTEXT: Record<string, string> = {
  [EXPECTED_SOURCE_ACCOUNTS[0].id]: 'access-token-conta-1-em-texto-puro',
  [EXPECTED_SOURCE_ACCOUNTS[1].id]: 'access-token-conta-2-em-texto-puro',
};
const REFRESH_PLAINTEXT: Record<string, string> = {
  [EXPECTED_SOURCE_ACCOUNTS[0].id]: 'refresh-token-conta-1-em-texto-puro',
  [EXPECTED_SOURCE_ACCOUNTS[1].id]: 'refresh-token-conta-2-em-texto-puro',
};

interface AccountRow {
  id: string;
  marketplace: string;
  external_seller_id: string | null;
  nickname: string | null;
  status: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  encrypted_credential_metadata: string | null;
  token_expires_at: Date | null;
  last_successful_sync_at: Date | null;
  connected_by_user_id: string | null;
  token_version: number;
  refresh_failure_count: number;
  refresh_retry_at: Date | null;
  last_refresh_attempt_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

async function sql<TRow>(
  runner: QueryRunner,
  text: string,
  values?: unknown[],
): Promise<TRow[]> {
  const rows: unknown = await runner.query(text, values);
  return rows as TRow[];
}

function toSqlClient(runner: QueryRunner): SqlClient {
  return {
    query: async (text: string, values?: unknown[]): Promise<unknown[]> => {
      const rows: unknown = await runner.query(text, values);
      return Array.isArray(rows) ? (rows as unknown[]) : [];
    },
  };
}

async function openRunner(url: string): Promise<{
  dataSource: DataSource;
  runner: QueryRunner;
}> {
  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [],
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  return { dataSource, runner };
}

describe('migrateMercadoLivreAccounts (dois Postgres reais)', () => {
  let sourceDataSource: DataSource;
  let targetDataSource: DataSource;
  let sourceRunner: QueryRunner;
  let targetRunner: QueryRunner;
  let source: SqlClient;
  let target: SqlClient;
  const sourceCipher = createCredentialCipher(SOURCE_KEY);
  const targetCipher = createCredentialCipher(TARGET_KEY);

  beforeAll(async () => {
    const sourceConnection = await openRunner(requireTestDatabaseUrl());
    const targetConnection = await openRunner(requireTargetTestDatabaseUrl());
    sourceDataSource = sourceConnection.dataSource;
    targetDataSource = targetConnection.dataSource;
    sourceRunner = sourceConnection.runner;
    targetRunner = targetConnection.runner;
    source = toSqlClient(sourceRunner);
    target = toSqlClient(targetRunner);
  });

  afterAll(async () => {
    await sourceDataSource.destroy();
    await targetDataSource.destroy();
  });

  beforeEach(async () => {
    for (const runner of [sourceRunner, targetRunner]) {
      await runner.query('TRUNCATE TABLE marketplace_accounts CASCADE');
      await runner.query('TRUNCATE TABLE users CASCADE');
    }
  });

  async function seedUser(runner: QueryRunner): Promise<string> {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO users (id, name, email, password_hash)
       VALUES ($1, 'Titular', $2, 'hash')`,
      [id, `titular-${id}@example.com`],
    );
    return id;
  }

  async function seedSourceAccounts(
    overrides: Record<string, unknown> = {},
    accountIndexes: number[] = [0, 1],
  ): Promise<string> {
    const userId = await seedUser(sourceRunner);
    for (const index of accountIndexes) {
      const spec = EXPECTED_SOURCE_ACCOUNTS[index];
      const row: Record<string, unknown> = {
        id: spec.id,
        marketplace: 'MERCADO_LIVRE',
        external_seller_id: spec.externalSellerId,
        nickname: spec.nickname,
        status: 'CONNECTED',
        encrypted_access_token: sourceCipher.encrypt(ACCESS_PLAINTEXT[spec.id]),
        encrypted_refresh_token: sourceCipher.encrypt(
          REFRESH_PLAINTEXT[spec.id],
        ),
        token_expires_at: new Date('2026-09-18T02:30:01.135Z'),
        last_successful_sync_at: new Date('2026-09-17T14:40:50.211Z'),
        connected_by_user_id: userId,
        token_version: 24 - index,
        refresh_failure_count: 0,
        refresh_retry_at: null,
        last_refresh_attempt_at: new Date('2026-09-17T20:30:01.135Z'),
        created_at: new Date('2026-08-31T16:10:56.854Z'),
        updated_at: new Date('2026-09-17T20:30:01.135Z'),
        ...overrides,
      };
      await sourceRunner.query(
        `INSERT INTO marketplace_accounts (
           id, marketplace, external_seller_id, nickname, status,
           encrypted_access_token, encrypted_refresh_token,
           token_expires_at, last_successful_sync_at, connected_by_user_id,
           token_version, refresh_failure_count, refresh_retry_at,
           last_refresh_attempt_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          row.id,
          row.marketplace,
          row.external_seller_id,
          row.nickname,
          row.status,
          row.encrypted_access_token,
          row.encrypted_refresh_token,
          row.token_expires_at,
          row.last_successful_sync_at,
          row.connected_by_user_id,
          row.token_version,
          row.refresh_failure_count,
          row.refresh_retry_at,
          row.last_refresh_attempt_at,
          row.created_at,
          row.updated_at,
        ],
      );
    }
    return userId;
  }

  async function seedTargetAccount(
    overrides: Partial<AccountRow> = {},
  ): Promise<string> {
    const id = overrides.id ?? randomUUID();
    await targetRunner.query(
      `INSERT INTO marketplace_accounts (
         id, marketplace, external_seller_id, nickname, status,
         encrypted_access_token, encrypted_refresh_token
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        overrides.marketplace ?? 'SHOPEE',
        overrides.external_seller_id ?? '1363756379',
        overrides.nickname ?? 'Shopee Live',
        overrides.status ?? 'CONNECTED',
        overrides.encrypted_access_token ?? 'shopee-ciphertext-intocado',
        overrides.encrypted_refresh_token ?? 'shopee-ciphertext-intocado-2',
      ],
    );
    return id;
  }

  function targetAccounts(): Promise<AccountRow[]> {
    return sql<AccountRow>(
      targetRunner,
      'SELECT * FROM marketplace_accounts ORDER BY external_seller_id',
    );
  }

  function run(
    overrides: Partial<Parameters<typeof migrateMercadoLivreAccounts>[0]> = {},
  ) {
    return migrateMercadoLivreAccounts({
      sourceClient: source,
      targetClient: target,
      sourceEncryptionKey: SOURCE_KEY,
      targetEncryptionKey: TARGET_KEY,
      mode: 'dry-run',
      ...overrides,
    });
  }

  async function expectAbort(
    promise: Promise<unknown>,
    reason: string,
  ): Promise<MigrationAbortedError> {
    try {
      await promise;
      throw new Error(`deveria ter abortado com ${reason}`);
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationAbortedError);
      expect((error as MigrationAbortedError).reason).toBe(reason);
      return error as MigrationAbortedError;
    }
  }

  describe('dry-run', () => {
    it('valida tudo, relata as duas contas e termina em rollback sem persistir', async () => {
      await seedSourceAccounts();

      const report = await run();

      expect(report.mode).toBe('dry-run');
      expect(report.plannedInserts).toBe(2);
      expect(report.insertedCount).toBe(2);
      expect(report.outcome).toBe('rollback');
      expect(report.accounts).toHaveLength(2);
      expect(report.accounts[0]).toEqual({
        id: EXPECTED_SOURCE_ACCOUNTS[0].id,
        externalSellerId: EXPECTED_SOURCE_ACCOUNTS[0].externalSellerId,
        nickname: EXPECTED_SOURCE_ACCOUNTS[0].nickname,
        status: 'CONNECTED',
        hasAccessToken: true,
        hasRefreshToken: true,
        tokenVersion: 24,
        reencrypted: true,
      });
      expect(await targetAccounts()).toHaveLength(0);
    });

    it('não persiste nada mesmo com o destino já contendo outras contas', async () => {
      await seedSourceAccounts();
      const shopeeId = await seedTargetAccount();

      await run();

      const rows = await targetAccounts();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(shopeeId);
    });
  });

  describe('apply', () => {
    it('insere exatamente as duas contas e commita', async () => {
      await seedSourceAccounts();

      const report = await run({ mode: 'apply' });

      expect(report.mode).toBe('apply');
      expect(report.insertedCount).toBe(2);
      expect(report.outcome).toBe('commit');

      const rows = await targetAccounts();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.external_seller_id).sort()).toEqual(
        ['1029648966', '1548451374'].sort(),
      );
      expect(rows.every((row) => row.marketplace === 'MERCADO_LIVRE')).toBe(
        true,
      );
    });

    it('grava connected_by_user_id como NULL, sem copiar o usuário local', async () => {
      const localUserId = await seedSourceAccounts();

      await run({ mode: 'apply' });

      const rows = await targetAccounts();
      expect(rows.every((row) => row.connected_by_user_id === null)).toBe(true);
      const users = await sql<{ count: string }>(
        targetRunner,
        'SELECT count(*)::text AS count FROM users WHERE id = $1',
        [localUserId],
      );
      expect(users[0].count).toBe('0');
    });

    it('preserva UUID, seller id, nickname, status, token_version e datas', async () => {
      await seedSourceAccounts();

      await run({ mode: 'apply' });

      const rows = await targetAccounts();
      const conta1 = rows.find(
        (row) => row.id === EXPECTED_SOURCE_ACCOUNTS[0].id,
      );
      expect(conta1).toBeDefined();
      expect(conta1?.nickname).toBe(EXPECTED_SOURCE_ACCOUNTS[0].nickname);
      expect(conta1?.status).toBe('CONNECTED');
      expect(conta1?.token_version).toBe(24);
      expect(conta1?.token_expires_at?.toISOString()).toBe(
        '2026-09-18T02:30:01.135Z',
      );
      expect(conta1?.created_at.toISOString()).toBe('2026-08-31T16:10:56.854Z');
      expect(conta1?.encrypted_credential_metadata).toBeNull();
    });

    it('recriptografa os dois tokens: legíveis pela chave de destino e diferentes do ciphertext de origem', async () => {
      await seedSourceAccounts();
      const sourceRows = await sql<AccountRow>(
        sourceRunner,
        'SELECT * FROM marketplace_accounts ORDER BY external_seller_id',
      );

      await run({ mode: 'apply' });

      const rows = await targetAccounts();
      for (const row of rows) {
        const original = sourceRows.find(
          (candidate) => candidate.id === row.id,
        );
        expect(row.encrypted_access_token).not.toBe(
          original?.encrypted_access_token,
        );
        expect(row.encrypted_refresh_token).not.toBe(
          original?.encrypted_refresh_token,
        );
        expect(targetCipher.decrypt(row.encrypted_access_token ?? '')).toBe(
          ACCESS_PLAINTEXT[row.id],
        );
        expect(targetCipher.decrypt(row.encrypted_refresh_token ?? '')).toBe(
          REFRESH_PLAINTEXT[row.id],
        );
      }
    });

    it('o payload de destino não é legível pela chave de origem', async () => {
      await seedSourceAccounts();

      await run({ mode: 'apply' });

      const rows = await targetAccounts();
      expect(() =>
        sourceCipher.decrypt(rows[0].encrypted_access_token ?? ''),
      ).toThrow();
    });

    it('usa IVs independentes por token (nunca o mesmo IV em dois payloads)', async () => {
      await seedSourceAccounts();

      await run({ mode: 'apply' });

      const rows = await targetAccounts();
      const ivs = rows.flatMap((row) => [
        (row.encrypted_access_token ?? '').split(':')[0],
        (row.encrypted_refresh_token ?? '').split(':')[0],
      ]);
      expect(new Set(ivs).size).toBe(4);
    });

    it('não toca nas contas Shopee/Amazon já existentes no destino', async () => {
      await seedSourceAccounts();
      const shopeeId = await seedTargetAccount();
      const before = await sql<AccountRow>(
        targetRunner,
        'SELECT * FROM marketplace_accounts WHERE id = $1',
        [shopeeId],
      );

      await run({ mode: 'apply' });

      const after = await sql<AccountRow>(
        targetRunner,
        'SELECT * FROM marketplace_accounts WHERE id = $1',
        [shopeeId],
      );
      expect(after[0]).toEqual(before[0]);
    });
  });

  describe('preflight da origem', () => {
    it('aborta quando falta uma das duas contas', async () => {
      await seedSourceAccounts({}, [0]);
      await expectAbort(run(), 'SOURCE_ACCOUNT_MISSING');
    });

    it('aborta quando o nickname diverge do esperado', async () => {
      await seedSourceAccounts({ nickname: 'Conta Renomeada' }, [0]);
      await seedSourceAccounts({}, [1]);
      await expectAbort(run(), 'SOURCE_NICKNAME_MISMATCH');
    });

    it('aborta quando o external_seller_id diverge do esperado', async () => {
      await seedSourceAccounts({ external_seller_id: '999999999' }, [0]);
      await seedSourceAccounts({}, [1]);
      await expectAbort(run(), 'SOURCE_SELLER_ID_MISMATCH');
    });

    it('aborta quando o marketplace não é MERCADO_LIVRE', async () => {
      await seedSourceAccounts({ marketplace: 'SHOPEE' }, [0]);
      await seedSourceAccounts({}, [1]);
      await expectAbort(run(), 'SOURCE_MARKETPLACE_INVALID');
    });

    it('aborta quando o status não é CONNECTED', async () => {
      await seedSourceAccounts({ status: 'TOKEN_EXPIRED' }, [0]);
      await seedSourceAccounts({}, [1]);
      await expectAbort(run(), 'SOURCE_STATUS_INVALID');
    });

    it('aborta quando o access token está ausente', async () => {
      await seedSourceAccounts({ encrypted_access_token: null }, [0]);
      await seedSourceAccounts({}, [1]);
      await expectAbort(run(), 'SOURCE_ACCESS_TOKEN_MISSING');
    });

    it('aborta quando o refresh token está ausente', async () => {
      await seedSourceAccounts({ encrypted_refresh_token: null }, [0]);
      await seedSourceAccounts({}, [1]);
      await expectAbort(run(), 'SOURCE_REFRESH_TOKEN_MISSING');
    });

    it('aborta quando a chave local não descriptografa o payload', async () => {
      await seedSourceAccounts();
      const error = await expectAbort(
        run({ sourceEncryptionKey: WRONG_SOURCE_KEY }),
        'SOURCE_DECRYPTION_FAILED',
      );
      expect(error.message).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
    });

    it('aborta quando a chave de destino é inválida', async () => {
      await seedSourceAccounts();
      await expectAbort(
        run({ targetEncryptionKey: 'chave-curta-demais' }),
        'TARGET_KEY_INVALID',
      );
    });
  });

  describe('preflight do destino', () => {
    it('aborta quando o destino já tem alguma conta MERCADO_LIVRE', async () => {
      await seedSourceAccounts();
      await seedTargetAccount({
        marketplace: 'MERCADO_LIVRE',
        external_seller_id: '555',
        nickname: 'Outra ML',
      });
      await expectAbort(run(), 'TARGET_NOT_EMPTY');
    });

    it('aborta quando um UUID de origem já existe em outro marketplace', async () => {
      await seedSourceAccounts();
      await seedTargetAccount({
        id: EXPECTED_SOURCE_ACCOUNTS[1].id,
        marketplace: 'SHOPEE',
        external_seller_id: '777',
        nickname: 'Shopee Colisao UUID',
      });
      await expectAbort(run(), 'TARGET_ID_COLLISION');
    });

    it('aborta quando um seller id de origem já existe em outro marketplace', async () => {
      await seedSourceAccounts();
      await seedTargetAccount({
        marketplace: 'SHOPEE',
        external_seller_id: EXPECTED_SOURCE_ACCOUNTS[0].externalSellerId,
        nickname: 'Shopee Colisao Seller',
      });
      await expectAbort(run(), 'TARGET_SELLER_ID_COLLISION');
    });

    it('aborta quando falta uma migration obrigatória no destino', async () => {
      await seedSourceAccounts();
      const missing = REQUIRED_TARGET_MIGRATIONS[3];
      const removed = await sql<{ timestamp: string }>(
        targetRunner,
        'SELECT timestamp FROM migrations WHERE name = $1',
        [missing],
      );
      await targetRunner.query('DELETE FROM migrations WHERE name = $1', [
        missing,
      ]);

      try {
        await expectAbort(run(), 'TARGET_MIGRATIONS_INCOMPATIBLE');
      } finally {
        await targetRunner.query(
          'INSERT INTO migrations (timestamp, name) VALUES ($1, $2)',
          [removed[0].timestamp, missing],
        );
      }
    });
  });

  describe('atomicidade', () => {
    it('faz rollback integral quando a segunda conta falha ao ser inserida', async () => {
      await seedSourceAccounts();
      let insertCount = 0;
      const failingTarget: SqlClient = {
        query: (text: string, values?: unknown[]) => {
          if (text.includes('INSERT INTO marketplace_accounts')) {
            insertCount += 1;
            if (insertCount === 2) {
              return Promise.reject(new Error('falha simulada no destino'));
            }
          }
          return target.query(text, values);
        },
      };

      await expect(
        run({ mode: 'apply', targetClient: failingTarget }),
      ).rejects.toThrow();

      // Prova que a primeira conta chegou a ser inserida e foi desfeita —
      // sem isto o teste passaria mesmo se nada tivesse sido tentado.
      expect(insertCount).toBe(2);
      expect(await targetAccounts()).toHaveLength(0);
    });
  });

  describe('sanitização', () => {
    it('não imprime nada em stdout/stderr durante uma execução bem-sucedida', async () => {
      await seedSourceAccounts();
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        await run({ mode: 'apply' });
        expect(log).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
        error.mockRestore();
        warn.mockRestore();
      }
    });

    it('nenhum erro carrega plaintext, ciphertext, chave ou URL de banco', async () => {
      await seedSourceAccounts({ encrypted_access_token: null }, [0]);
      await seedSourceAccounts({}, [1]);

      const error = await expectAbort(run(), 'SOURCE_ACCESS_TOKEN_MISSING');
      const serialized = `${error.message}\n${error.stack ?? ''}`;

      for (const secret of [
        ...Object.values(ACCESS_PLAINTEXT),
        ...Object.values(REFRESH_PLAINTEXT),
        SOURCE_KEY,
        TARGET_KEY,
      ]) {
        expect(serialized).not.toContain(secret);
      }
      expect(serialized).not.toMatch(/postgres:\/\//);
    });

    it('nunca toca a rede durante a migração', async () => {
      await seedSourceAccounts();
      const fetchSpy = jest.spyOn(global, 'fetch');

      try {
        await run({ mode: 'apply' });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
