import { readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseDotenv } from 'dotenv';
import { DataSource, type QueryRunner } from 'typeorm';
import {
  migrateMercadoLivreAccounts,
  type MigrationMode,
  type MigrationReport,
} from './migrate-ml-accounts';
import { MIGRATION_CONFIRMATION_TOKEN } from './migrate-ml-accounts.constants';
import {
  MigrationAbortedError,
  type SqlClient,
} from './migrate-ml-accounts.errors';

export interface ParsedMigrationArgs {
  mode: MigrationMode;
}

export interface ConnectionSecrets {
  databaseUrl: string;
  encryptionKey: string;
}

/**
 * Só três argumentos existem, nenhum deles com valor sensível: `--dry-run`
 * (padrão), `--apply` e `--confirm <token literal>`. Qualquer outro
 * argumento aborta — é a garantia de que nenhum segredo entra por linha de
 * comando, onde ficaria no histórico do shell e na lista de processos.
 */
export function parseMigrationArgs(argv: string[]): ParsedMigrationArgs {
  let apply = false;
  let confirmation: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      continue;
    }
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--confirm') {
      confirmation = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new MigrationAbortedError('UNKNOWN_ARGUMENT');
  }

  if (!apply && confirmation !== null) {
    throw new MigrationAbortedError('CONFIRMATION_WITHOUT_APPLY');
  }
  if (!apply) {
    return { mode: 'dry-run' };
  }
  if (confirmation === null) {
    throw new MigrationAbortedError('CONFIRMATION_REQUIRED');
  }
  if (confirmation !== MIGRATION_CONFIRMATION_TOKEN) {
    throw new MigrationAbortedError('CONFIRMATION_MISMATCH');
  }
  return { mode: 'apply' };
}

/** Destino: EXCLUSIVAMENTE variáveis de processo, nunca o `.env` local. */
export function resolveTargetSecrets(
  env: Record<string, string | undefined>,
): ConnectionSecrets {
  const databaseUrl = env.TARGET_DATABASE_URL;
  if (!databaseUrl) {
    throw new MigrationAbortedError('TARGET_DATABASE_URL_MISSING');
  }
  const encryptionKey = env.TARGET_CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new MigrationAbortedError('TARGET_CREDENTIAL_ENCRYPTION_KEY_MISSING');
  }
  return { databaseUrl, encryptionKey };
}

/**
 * Origem: o `.env` local já parseado em memória. Nunca é injetado em
 * `process.env` — assim o `.env` não consegue, nem por acidente, fornecer as
 * variáveis do DESTINO.
 */
export function resolveSourceSecrets(
  envFile: Record<string, string | undefined>,
): ConnectionSecrets {
  const databaseUrl = envFile.DATABASE_URL;
  if (!databaseUrl) {
    throw new MigrationAbortedError('SOURCE_DATABASE_URL_MISSING');
  }
  const encryptionKey = envFile.CREDENTIAL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new MigrationAbortedError('SOURCE_CREDENTIAL_ENCRYPTION_KEY_MISSING');
  }
  return { databaseUrl, encryptionKey };
}

/** Saída sanitizada: ids, seller ids, apelidos, presença booleana e desfecho. */
export function formatMigrationReport(report: MigrationReport): string[] {
  const lines = [`modo: ${report.mode}`];
  for (const account of report.accounts) {
    lines.push(
      [
        `conta ${account.id}`,
        `seller=${account.externalSellerId ?? '-'}`,
        `apelido=${account.nickname ?? '-'}`,
        `situacao=${account.status}`,
        `acesso=${account.hasAccessToken ? 'presente' : 'ausente'}`,
        `renovacao=${account.hasRefreshToken ? 'presente' : 'ausente'}`,
        `versao=${account.tokenVersion}`,
        `recriptografada=${account.reencrypted ? 'sim' : 'nao'}`,
      ].join(' | '),
    );
  }
  lines.push(`previstas: ${report.plannedInserts}`);
  lines.push(`inseridas: ${report.insertedCount}`);
  lines.push(`desfecho: ${report.outcome}`);
  return lines;
}

function toSqlClient(runner: QueryRunner): SqlClient {
  return {
    query: async (text: string, values?: unknown[]): Promise<unknown[]> => {
      const rows: unknown = await runner.query(text, values);
      return Array.isArray(rows) ? (rows as unknown[]) : [];
    },
  };
}

/**
 * Conexão dedicada (um único `QueryRunner`, nunca o pool) — exigida para que
 * `BEGIN`/`COMMIT`/`ROLLBACK` sejam atômicos. `entities: []` impede qualquer
 * carga de metadata da aplicação: esta ferramenta nunca sobe o Nest, nunca
 * roda scheduler e, portanto, nunca dispara renovação de token.
 */
async function openConnection(
  url: string,
): Promise<{ dataSource: DataSource; client: SqlClient }> {
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
  return { dataSource, client: toSqlClient(runner) };
}

async function main(): Promise<void> {
  const { mode } = parseMigrationArgs(process.argv.slice(2));
  const target = resolveTargetSecrets(process.env);
  const source = resolveSourceSecrets(
    parseDotenv(readFileSync(join(process.cwd(), '.env'))),
  );

  const sourceConnection = await openConnection(source.databaseUrl);
  const targetConnection = await openConnection(target.databaseUrl);

  try {
    const report = await migrateMercadoLivreAccounts({
      sourceClient: sourceConnection.client,
      targetClient: targetConnection.client,
      sourceEncryptionKey: source.encryptionKey,
      targetEncryptionKey: target.encryptionKey,
      mode,
    });
    for (const line of formatMigrationReport(report)) {
      process.stdout.write(`${line}\n`);
    }
  } finally {
    await sourceConnection.dataSource.destroy();
    await targetConnection.dataSource.destroy();
  }
}

/**
 * `require.main === module` mantém o arquivo importável pelos testes sem
 * abrir conexão alguma — a migração só roda por execução direta.
 */
if (require.main === module) {
  main().catch((error: unknown) => {
    // Erro fora do vocabulário fechado nunca tem a mensagem impressa (pode
    // carregar trecho de conexão ou de payload) — só o nome da classe.
    const reason =
      error instanceof MigrationAbortedError
        ? error.message
        : `FALHA_INESPERADA (${error instanceof Error ? error.name : 'desconhecida'})`;
    process.stderr.write(`migracao abortada: ${reason}\n`);
    process.exitCode = 1;
  });
}
