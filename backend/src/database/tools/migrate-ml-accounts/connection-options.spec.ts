import {
  resolveSourceEnvPath,
  resolveSslPolicy,
  stripSslParams,
} from './connection-options';
import { MigrationAbortedError } from './migrate-ml-accounts.errors';
import { stageOfReason } from './migration-stages';

const REMOTE = 'postgres://user:pass@db.exemplo-remoto.com:5432/base';
const LOCAL = 'postgres://user:pass@localhost:5433/base';

function expectAbort(run: () => unknown, reason: string): void {
  try {
    run();
    throw new Error(`deveria ter abortado com ${reason}`);
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationAbortedError);
    expect((error as MigrationAbortedError).reason).toBe(reason);
  }
}

describe('resolveSslPolicy', () => {
  it('liga TLS sem verificação de cadeia para sslmode=require (URL externa gerenciada)', () => {
    expect(resolveSslPolicy(`${REMOTE}?sslmode=require`, 'target')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it.each(['allow', 'prefer', 'no-verify'])(
    'trata sslmode=%s como TLS sem verificação de cadeia',
    (mode) => {
      expect(resolveSslPolicy(`${REMOTE}?sslmode=${mode}`, 'target')).toEqual({
        rejectUnauthorized: false,
      });
    },
  );

  it.each(['verify-ca', 'verify-full'])(
    'exige verificação de cadeia em sslmode=%s',
    (mode) => {
      expect(resolveSslPolicy(`${REMOTE}?sslmode=${mode}`, 'target')).toEqual({
        rejectUnauthorized: true,
      });
    },
  );

  it('respeita sslmode=disable explícito', () => {
    expect(resolveSslPolicy(`${REMOTE}?sslmode=disable`, 'target')).toBe(false);
  });

  it('aceita ssl=true como TLS sem verificação de cadeia', () => {
    expect(resolveSslPolicy(`${REMOTE}?ssl=true`, 'target')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('mantém a conexão local (loopback) sem TLS quando não há sslmode', () => {
    expect(resolveSslPolicy(LOCAL, 'source')).toBe(false);
    expect(
      resolveSslPolicy('postgres://user:pass@127.0.0.1:5433/base', 'source'),
    ).toBe(false);
  });

  it('nunca envia credencial em claro para host remoto sem sslmode explícito', () => {
    expectAbort(
      () => resolveSslPolicy(REMOTE, 'target'),
      'TARGET_CONFIG_INVALID',
    );
    expectAbort(
      () => resolveSslPolicy(REMOTE, 'source'),
      'SOURCE_CONFIG_INVALID',
    );
  });

  it('aborta em sslmode fora do vocabulário do libpq', () => {
    expectAbort(
      () => resolveSslPolicy(`${REMOTE}?sslmode=talvez`, 'target'),
      'TARGET_CONFIG_INVALID',
    );
  });

  it('aborta em URL malformada, sem ecoar o valor recebido', () => {
    try {
      resolveSslPolicy('isto-nao-e-uma-url', 'target');
    } catch (error) {
      expect((error as MigrationAbortedError).message).toBe(
        'TARGET_CONFIG_INVALID',
      );
      expect((error as MigrationAbortedError).message).not.toContain(
        'isto-nao-e-uma-url',
      );
    }
  });

  it('nunca inclui host, usuário ou senha na mensagem de erro', () => {
    try {
      resolveSslPolicy(REMOTE, 'target');
    } catch (error) {
      const message = (error as MigrationAbortedError).message;
      expect(message).not.toContain('db.exemplo-remoto.com');
      expect(message).not.toContain('pass');
      expect(message).not.toContain('user');
    }
  });
});

describe('stripSslParams', () => {
  it('remove os parâmetros de TLS para o driver não reinterpretá-los', () => {
    const stripped = stripSslParams(
      `${REMOTE}?sslmode=require&sslrootcert=/tmp/ca.pem&application_name=cpe`,
      'target',
    );

    expect(stripped).not.toContain('sslmode');
    expect(stripped).not.toContain('sslrootcert');
    expect(stripped).toContain('application_name=cpe');
  });

  it('preserva host, porta, base e credenciais intactos', () => {
    const stripped = stripSslParams(`${REMOTE}?sslmode=require`, 'target');

    expect(stripped).toBe(REMOTE);
  });

  it('não altera uma URL local sem parâmetros de TLS', () => {
    expect(stripSslParams(LOCAL, 'source')).toBe(LOCAL);
  });
});

describe('resolveSourceEnvPath', () => {
  it('usa <cwd>/.env quando o comando roda a partir de backend', () => {
    const probed: string[] = [];
    const path = resolveSourceEnvPath('/repo/backend', (candidate) => {
      probed.push(candidate);
      return candidate.replace(/\\/g, '/') === '/repo/backend/.env';
    });

    expect(path.replace(/\\/g, '/')).toBe('/repo/backend/.env');
    expect(probed).toHaveLength(1);
  });

  it('usa <cwd>/backend/.env quando o comando roda a partir da raiz', () => {
    const probed: string[] = [];
    const path = resolveSourceEnvPath('/repo', (candidate) => {
      probed.push(candidate);
      return candidate.replace(/\\/g, '/') === '/repo/backend/.env';
    });

    expect(path.replace(/\\/g, '/')).toBe('/repo/backend/.env');
  });

  it('consulta somente os dois caminhos esperados, nunca sobe a árvore', () => {
    const probed: string[] = [];
    expectAbort(
      () =>
        resolveSourceEnvPath('/repo/backend', (candidate) => {
          probed.push(candidate.replace(/\\/g, '/'));
          return false;
        }),
      'SOURCE_ENV_LOAD_FAILED',
    );

    expect(probed).toEqual([
      '/repo/backend/.env',
      '/repo/backend/backend/.env',
    ]);
  });
});

describe('stageOfReason', () => {
  it('mapeia cada código para uma etapa segura e fixa', () => {
    expect(stageOfReason('SOURCE_CONNECTION_FAILED')).toBe('conexao-origem');
    expect(stageOfReason('TARGET_CONNECTION_FAILED')).toBe('conexao-destino');
    expect(stageOfReason('TARGET_CONFIG_INVALID')).toBe('segredos-destino');
    expect(stageOfReason('SOURCE_ENV_LOAD_FAILED')).toBe('segredos-origem');
    expect(stageOfReason('TARGET_NOT_EMPTY')).toBe('preflight-destino');
    expect(stageOfReason('TARGET_ROLLBACK_FAILED')).toBe('transacao-destino');
  });
});
