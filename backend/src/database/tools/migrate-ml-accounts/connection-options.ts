import { existsSync } from 'fs';
import { join } from 'path';
import { DataSource, type QueryRunner } from 'typeorm';
import {
  MigrationAbortedError,
  runStage,
  type SqlClient,
} from './migrate-ml-accounts.errors';

export type ConnectionSide = 'source' | 'target';

/** `false` = sem TLS; objeto = TLS ligado, com ou sem verificação de cadeia. */
export type SslPolicy = false | { rejectUnauthorized: boolean };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Parâmetros de TLS removidos da URL antes de ela chegar ao driver. O `pg`
 * reinterpreta a connection string por cima das opções explícitas
 * (`ConnectionParameters`: `Object.assign({}, config, parse(connectionString))`),
 * e a versão instalada do `pg-connection-string` trata `prefer`/`require`/
 * `verify-ca` como APELIDOS DE `verify-full` — o oposto da semântica do
 * libpq. Contra um banco gerenciado com certificado de CA privada isso
 * falha na verificação de cadeia, e o erro resultante é um `Error` cru de
 * TLS. Removendo estes parâmetros, quem decide a política é exclusivamente
 * `resolveSslPolicy`, que já leu a intenção declarada na URL.
 */
const SSL_URL_PARAMS = [
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslnegotiation',
  'uselibpqcompat',
];

/**
 * TypeORM descarta os query params ao interpretar `url`
 * (`DriverUtils.parseConnectionUrl` corta tudo a partir do `?`), e só o
 * `pg` os reinterpreta depois. Em vez de depender desse comportamento
 * interno, a política de TLS é derivada aqui, explicitamente, e passada
 * como opção — o que também permite testá-la.
 *
 * Semântica seguida (a mesma do libpq):
 * - `disable` → sem TLS;
 * - `allow`/`prefer`/`require`/`no-verify` → TLS SEM verificação de cadeia.
 *   `require` significa, por definição, "criptografe, não verifique quem é"
 *   — é o modo usado por bancos gerenciados cujo certificado é emitido por
 *   uma CA privada, ausente do truststore do Node;
 * - `verify-ca`/`verify-full` → TLS COM verificação de cadeia.
 *
 * Sem `sslmode` explícito, só host de loopback é aceito sem TLS. Um host
 * remoto sem `sslmode` ABORTA, em vez de enviar credencial em claro pela
 * rede por omissão.
 */
export function resolveSslPolicy(
  databaseUrl: string,
  side: ConnectionSide,
): SslPolicy {
  const invalid =
    side === 'source' ? 'SOURCE_CONFIG_INVALID' : 'TARGET_CONFIG_INVALID';

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new MigrationAbortedError(invalid);
  }

  const sslMode = url.searchParams.get('sslmode');
  if (sslMode === null) {
    const ssl = url.searchParams.get('ssl');
    if (ssl === 'true' || ssl === '1') {
      return { rejectUnauthorized: false };
    }
    if (LOOPBACK_HOSTS.has(url.hostname)) {
      return false;
    }
    throw new MigrationAbortedError(invalid);
  }

  switch (sslMode) {
    case 'disable':
      return false;
    case 'allow':
    case 'prefer':
    case 'require':
    case 'no-verify':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    default:
      throw new MigrationAbortedError(invalid);
  }
}

/**
 * Devolve a MESMA URL sem os parâmetros de TLS (host, usuário, senha, porta
 * e base permanecem intactos). Ver `SSL_URL_PARAMS`.
 */
export function stripSslParams(
  databaseUrl: string,
  side: ConnectionSide,
): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new MigrationAbortedError(
      side === 'source' ? 'SOURCE_CONFIG_INVALID' : 'TARGET_CONFIG_INVALID',
    );
  }
  for (const param of SSL_URL_PARAMS) {
    url.searchParams.delete(param);
  }
  return url.toString();
}

/**
 * Caminho determinístico do `.env` da ORIGEM: exatamente dois candidatos,
 * nesta ordem — `<cwd>/.env` (execução a partir de `backend/`) e
 * `<cwd>/backend/.env` (execução a partir da raiz do repositório). Nenhum
 * outro diretório é consultado, nunca há busca subindo a árvore.
 */
export function resolveSourceEnvPath(
  cwd: string,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const candidates = [join(cwd, '.env'), join(cwd, 'backend', '.env')];
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  throw new MigrationAbortedError('SOURCE_ENV_LOAD_FAILED');
}

export function toSqlClient(runner: QueryRunner): SqlClient {
  return {
    query: async (text: string, values?: unknown[]): Promise<unknown[]> => {
      const rows: unknown = await runner.query(text, values);
      return Array.isArray(rows) ? (rows as unknown[]) : [];
    },
  };
}

export interface MigrationConnection {
  dataSource: DataSource;
  client: SqlClient;
}

/**
 * Conexão dedicada (um único `QueryRunner`, nunca o pool) — exigida para que
 * `BEGIN`/`COMMIT`/`ROLLBACK` sejam atômicos. `entities: []` impede qualquer
 * carga de metadata da aplicação: a ferramenta nunca sobe o Nest, nunca roda
 * scheduler e, portanto, nunca dispara renovação de token.
 *
 * Falha de DNS, TLS, firewall, autenticação ou timeout vira o código fechado
 * do lado correspondente — a mensagem crua do driver (que carrega host,
 * usuário e às vezes SQL) nunca escapa daqui.
 */
export async function openMigrationConnection(
  databaseUrl: string,
  side: ConnectionSide,
): Promise<MigrationConnection> {
  const ssl = resolveSslPolicy(databaseUrl, side);
  const driverUrl = stripSslParams(databaseUrl, side);
  const failure =
    side === 'source' ? 'SOURCE_CONNECTION_FAILED' : 'TARGET_CONNECTION_FAILED';

  return runStage(failure, async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      url: driverUrl,
      entities: [],
      synchronize: false,
      logging: false,
      ssl,
      connectTimeoutMS: CONNECT_TIMEOUT_MS,
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    return { dataSource, client: toSqlClient(runner) };
  });
}

/** Rede inacessível falha rápido, em vez de pendurar a execução. */
const CONNECT_TIMEOUT_MS = 15_000;
