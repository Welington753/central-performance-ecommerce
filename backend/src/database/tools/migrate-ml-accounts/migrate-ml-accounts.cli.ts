import { readFileSync } from 'fs';
import { parse as parseDotenv } from 'dotenv';
import {
  openMigrationConnection,
  resolveSourceEnvPath,
} from './connection-options';
import {
  migrateMercadoLivreAccounts,
  type MigrationMode,
  type MigrationReport,
} from './migrate-ml-accounts';
import { MIGRATION_CONFIRMATION_TOKEN } from './migrate-ml-accounts.constants';
import {
  MigrationAbortedError,
  runStageSync,
} from './migrate-ml-accounts.errors';
import { stageOfReason } from './migration-stages';

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

/**
 * Saída de falha: SOMENTE o código fechado e o nome fixo da etapa. Nunca
 * `error.message`, `stack`, `detail`, `query`, parâmetros ou o objeto bruto
 * — qualquer um deles poderia carregar host, usuário, senha ou payload.
 */
export function formatAbortLine(error: unknown): string {
  if (error instanceof MigrationAbortedError) {
    return `migracao abortada: ${error.message} | etapa: ${stageOfReason(
      error.reason,
    )}`;
  }
  return 'migracao abortada: FALHA_NAO_CLASSIFICADA | etapa: desconhecida';
}

function loadSourceEnvFile(): Record<string, string | undefined> {
  const path = resolveSourceEnvPath(process.cwd());
  return runStageSync('SOURCE_ENV_LOAD_FAILED', () =>
    parseDotenv(readFileSync(path)),
  );
}

async function main(): Promise<void> {
  const { mode } = parseMigrationArgs(process.argv.slice(2));
  const target = resolveTargetSecrets(process.env);
  const source = resolveSourceSecrets(loadSourceEnvFile());

  const sourceConnection = await openMigrationConnection(
    source.databaseUrl,
    'source',
  );
  const targetConnection = await openMigrationConnection(
    target.databaseUrl,
    'target',
  );

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
    process.stderr.write(`${formatAbortLine(error)}\n`);
    process.exitCode = 1;
  });
}
