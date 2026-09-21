import { MIGRATION_CONFIRMATION_TOKEN } from './migrate-ml-accounts.constants';
import {
  formatMigrationReport,
  parseMigrationArgs,
  resolveSourceSecrets,
  resolveTargetSecrets,
} from './migrate-ml-accounts.cli';
import { MigrationAbortedError } from './migrate-ml-accounts';

const A_KEY = 'a'.repeat(64);
const A_URL = 'postgres://user:p4ssw0rd@localhost:5432/db';

describe('parseMigrationArgs', () => {
  it('usa dry-run como padrão quando nenhum argumento é passado', () => {
    expect(parseMigrationArgs([])).toEqual({ mode: 'dry-run' });
  });

  it('aceita --dry-run explícito', () => {
    expect(parseMigrationArgs(['--dry-run'])).toEqual({ mode: 'dry-run' });
  });

  it('aborta em --apply sem confirmação', () => {
    expect(() => parseMigrationArgs(['--apply'])).toThrow(
      MigrationAbortedError,
    );
    try {
      parseMigrationArgs(['--apply']);
    } catch (error) {
      expect((error as MigrationAbortedError).reason).toBe(
        'CONFIRMATION_REQUIRED',
      );
    }
  });

  it('aborta quando a confirmação é diferente da exigida', () => {
    try {
      parseMigrationArgs(['--apply', '--confirm', 'MIGRATE_ML_OUTRA_COISA']);
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationAbortedError);
      expect((error as MigrationAbortedError).reason).toBe(
        'CONFIRMATION_MISMATCH',
      );
    }
  });

  it('aceita --apply com a confirmação exata', () => {
    expect(
      parseMigrationArgs([
        '--apply',
        '--confirm',
        MIGRATION_CONFIRMATION_TOKEN,
      ]),
    ).toEqual({ mode: 'apply' });
  });

  it('aborta quando --confirm é usado sem --apply', () => {
    try {
      parseMigrationArgs(['--confirm', MIGRATION_CONFIRMATION_TOKEN]);
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as MigrationAbortedError).reason).toBe(
        'CONFIRMATION_WITHOUT_APPLY',
      );
    }
  });

  it('aborta em qualquer argumento desconhecido — segredo nunca entra por linha de comando', () => {
    for (const argv of [
      ['--target-database-url', A_URL],
      ['--key', A_KEY],
      ['--force'],
      [`--confirm=${MIGRATION_CONFIRMATION_TOKEN}`],
    ]) {
      try {
        parseMigrationArgs(argv);
        throw new Error(`deveria ter abortado: ${argv[0]}`);
      } catch (error) {
        expect(error).toBeInstanceOf(MigrationAbortedError);
        expect((error as MigrationAbortedError).reason).toBe(
          'UNKNOWN_ARGUMENT',
        );
      }
    }
  });

  it('nunca inclui o valor do argumento desconhecido na mensagem de erro', () => {
    try {
      parseMigrationArgs(['--key', A_KEY]);
    } catch (error) {
      const message = (error as MigrationAbortedError).message;
      expect(message).not.toContain(A_KEY);
      expect(message).not.toContain(A_URL);
    }
  });
});

describe('resolveTargetSecrets', () => {
  it('lê exclusivamente as variáveis de processo do destino', () => {
    expect(
      resolveTargetSecrets({
        TARGET_DATABASE_URL: A_URL,
        TARGET_CREDENTIAL_ENCRYPTION_KEY: A_KEY,
      }),
    ).toEqual({ databaseUrl: A_URL, encryptionKey: A_KEY });
  });

  it('aborta quando TARGET_DATABASE_URL está ausente', () => {
    try {
      resolveTargetSecrets({ TARGET_CREDENTIAL_ENCRYPTION_KEY: A_KEY });
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as MigrationAbortedError).reason).toBe(
        'TARGET_DATABASE_URL_MISSING',
      );
    }
  });

  it('aborta quando TARGET_CREDENTIAL_ENCRYPTION_KEY está ausente', () => {
    try {
      resolveTargetSecrets({ TARGET_DATABASE_URL: A_URL });
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as MigrationAbortedError).reason).toBe(
        'TARGET_CREDENTIAL_ENCRYPTION_KEY_MISSING',
      );
    }
  });

  it('nunca ecoa o valor das variáveis na mensagem de erro', () => {
    try {
      resolveTargetSecrets({ TARGET_DATABASE_URL: A_URL });
    } catch (error) {
      expect((error as MigrationAbortedError).message).not.toContain(A_URL);
    }
  });
});

describe('resolveSourceSecrets', () => {
  it('lê a origem do conteúdo do .env já parseado', () => {
    expect(
      resolveSourceSecrets({
        DATABASE_URL: A_URL,
        CREDENTIAL_ENCRYPTION_KEY: A_KEY,
      }),
    ).toEqual({ databaseUrl: A_URL, encryptionKey: A_KEY });
  });

  it('aborta quando a origem está incompleta', () => {
    try {
      resolveSourceSecrets({ DATABASE_URL: A_URL });
      throw new Error('deveria ter abortado');
    } catch (error) {
      expect((error as MigrationAbortedError).reason).toBe(
        'SOURCE_CREDENTIAL_ENCRYPTION_KEY_MISSING',
      );
    }
  });

  it('ignora as variáveis do destino mesmo se estiverem no .env', () => {
    expect(
      resolveSourceSecrets({
        DATABASE_URL: A_URL,
        CREDENTIAL_ENCRYPTION_KEY: A_KEY,
        TARGET_DATABASE_URL: 'postgres://nao-deve-ser-usado/db',
        TARGET_CREDENTIAL_ENCRYPTION_KEY: 'b'.repeat(64),
      }),
    ).toEqual({ databaseUrl: A_URL, encryptionKey: A_KEY });
  });
});

describe('formatMigrationReport', () => {
  const report = {
    mode: 'dry-run' as const,
    accounts: [
      {
        id: '7ca26d89-e3af-4b62-95c0-1d4ebf1eeaf7',
        externalSellerId: '1548451374',
        nickname: 'Mercado Livre 1',
        status: 'CONNECTED',
        hasAccessToken: true,
        hasRefreshToken: true,
        tokenVersion: 24,
        reencrypted: true,
      },
    ],
    plannedInserts: 2,
    insertedCount: 2,
    outcome: 'rollback' as const,
  };

  it('mostra somente campos sanitizados', () => {
    const output = formatMigrationReport(report).join('\n');

    expect(output).toContain('dry-run');
    expect(output).toContain('7ca26d89-e3af-4b62-95c0-1d4ebf1eeaf7');
    expect(output).toContain('1548451374');
    expect(output).toContain('Mercado Livre 1');
    expect(output).toContain('CONNECTED');
    expect(output).toContain('rollback');
    expect(output).toMatch(/2/);
  });

  it('nunca imprime token, ciphertext, chave, URL ou comprimento de segredo', () => {
    const output = formatMigrationReport(report).join('\n');

    expect(output).not.toMatch(/postgres:\/\//);
    expect(output).not.toMatch(/token=|access_token|refresh_token/i);
    expect(output).not.toMatch(/ciphertext|\biv\b|authTag|encryption_key/i);
    expect(output).not.toMatch(/length|comprimento|prefixo|sufixo/i);
  });
});
