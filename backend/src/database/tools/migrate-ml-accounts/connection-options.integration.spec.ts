import { requireTestDatabaseUrl } from '../../../test-utils/require-test-database-url';
import { openMigrationConnection } from './connection-options';
import { MigrationAbortedError } from './migrate-ml-accounts.errors';

/**
 * Exige, além do Postgres descartável comum (`TEST_DATABASE_URL`, sem TLS),
 * um SEGUNDO Postgres descartável com TLS LIGADO e certificado autoassinado
 * em `TEST_SSL_DATABASE_URL` — a configuração que reproduz um banco
 * gerenciado externo (certificado emitido por CA privada, ausente do
 * truststore do Node). Ausência de qualquer um FALHA a suíte, nunca pula.
 */
function requireSslTestDatabaseUrl(): string {
  const url = process.env.TEST_SSL_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_SSL_DATABASE_URL não definida. Esta suíte exige um Postgres descartável com TLS ligado e certificado autoassinado.',
    );
  }
  return url;
}

/** Porta fechada em loopback: recusa imediata, sem depender de rede externa. */
const UNREACHABLE_URL = 'postgres://user:pass@127.0.0.1:1/base';

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

describe('openMigrationConnection (Postgres real, com e sem TLS)', () => {
  it('conecta na origem local sem TLS', async () => {
    const connection = await openMigrationConnection(
      requireTestDatabaseUrl(),
      'source',
    );
    try {
      const rows = await connection.client.query('SELECT 1 AS um');
      expect(rows).toHaveLength(1);
    } finally {
      await connection.dataSource.destroy();
    }
  });

  it('conecta em servidor com TLS e certificado autoassinado usando sslmode=require', async () => {
    const connection = await openMigrationConnection(
      requireSslTestDatabaseUrl(),
      'target',
    );
    try {
      const rows = await connection.client.query(
        'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
      );
      expect(rows).toHaveLength(1);
      expect((rows[0] as { ssl: boolean }).ssl).toBe(true);
    } finally {
      await connection.dataSource.destroy();
    }
  });

  it('falha ao conectar sem TLS num servidor que exige TLS — código fechado, sem mensagem de driver', async () => {
    const withoutSsl = requireSslTestDatabaseUrl().replace(
      /[?&]sslmode=[^&]*/,
      '',
    );

    const error = await expectAbort(
      openMigrationConnection(withoutSsl, 'target'),
      'TARGET_CONNECTION_FAILED',
    );

    expect(error.message).toBe('TARGET_CONNECTION_FAILED');
    expect(error.message).not.toMatch(/postgres:\/\/|pg_hba|SSL|certificate/i);
  });

  it('falha de conexão da origem vira SOURCE_CONNECTION_FAILED', async () => {
    const error = await expectAbort(
      openMigrationConnection(UNREACHABLE_URL, 'source'),
      'SOURCE_CONNECTION_FAILED',
    );
    expect(error.message).toBe('SOURCE_CONNECTION_FAILED');
  });

  it('falha de conexão do destino vira TARGET_CONNECTION_FAILED', async () => {
    const error = await expectAbort(
      openMigrationConnection(UNREACHABLE_URL, 'target'),
      'TARGET_CONNECTION_FAILED',
    );
    expect(error.message).toBe('TARGET_CONNECTION_FAILED');
    expect(error.stack ?? '').not.toContain('127.0.0.1:1');
  });
});
