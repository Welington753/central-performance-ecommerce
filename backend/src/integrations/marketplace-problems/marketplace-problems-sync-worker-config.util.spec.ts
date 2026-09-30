import type { ConfigService } from '@nestjs/config';
import {
  isProblemsSyncWorkerEnabled,
  ProblemsSyncWorkerConfigError,
  readProblemsSyncWorkerConfig,
} from './marketplace-problems-sync-worker-config.util';

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('isProblemsSyncWorkerEnabled', () => {
  it('default false', () => {
    expect(isProblemsSyncWorkerEnabled(config({}))).toBe(false);
  });

  it('true só com flag exatamente "true" fora de NODE_ENV=test', () => {
    expect(
      isProblemsSyncWorkerEnabled(
        config({
          PROBLEMS_SYNC_WORKER_ENABLED: 'true',
          NODE_ENV: 'production',
        }),
      ),
    ).toBe(true);
  });

  it('valores ambíguos falham fechado (desabilitado)', () => {
    for (const value of ['TRUE', '1', 'yes', 'on', ' true', true]) {
      expect(
        isProblemsSyncWorkerEnabled(
          config({
            PROBLEMS_SYNC_WORKER_ENABLED: value,
            NODE_ENV: 'production',
          }),
        ),
      ).toBe(false);
    }
  });

  it('NODE_ENV=test desliga mesmo com a flag ligada', () => {
    expect(
      isProblemsSyncWorkerEnabled(
        config({ PROBLEMS_SYNC_WORKER_ENABLED: 'true', NODE_ENV: 'test' }),
      ),
    ).toBe(false);
  });
});

describe('readProblemsSyncWorkerConfig', () => {
  it('defaults válidos e worker desabilitado', () => {
    const c = readProblemsSyncWorkerConfig(config({}));
    expect(c.enabled).toBe(false);
    expect(c.maxAttempts).toBeGreaterThan(0);
    expect(c.leaseMs).toBeGreaterThan(c.tickMs);
    expect(c.tickMaxClaims).toBeLessThanOrEqual(2000);
    expect(c.tickMaxHttpCalls).toBeLessThanOrEqual(5000);
  });

  it('aceita números vindos como string de env', () => {
    const c = readProblemsSyncWorkerConfig(
      config({ PROBLEMS_SYNC_WORKER_TICK_MS: '7000' }),
    );
    expect(c.tickMs).toBe(7000);
  });

  it.each([
    ['PROBLEMS_SYNC_WORKER_TICK_MS', 'abc'],
    ['PROBLEMS_SYNC_WORKER_TICK_MS', 0],
    ['PROBLEMS_SYNC_WORKER_TICK_MS', -5],
    ['PROBLEMS_SYNC_WORKER_TICK_MS', 1.5],
    ['PROBLEMS_SYNC_WORKER_MAX_ATTEMPTS', NaN],
    ['PROBLEMS_SYNC_WORKER_MAX_CONCURRENT_JOBS', 0],
    ['PROBLEMS_SYNC_WORKER_TICK_MAX_CLAIMS', 2001],
    ['PROBLEMS_SYNC_WORKER_TICK_MAX_HTTP_CALLS', 5001],
    ['PROBLEMS_SYNC_WORKER_CENSUS_INTERVAL_MS', -1],
  ])('valor inválido %s=%p lança (fail-closed)', (key, value) => {
    expect(() =>
      readProblemsSyncWorkerConfig(config({ [key]: value })),
    ).toThrow(ProblemsSyncWorkerConfigError);
  });

  it('CENSUS_INTERVAL_MS aceita 0 (censo em todo tick)', () => {
    expect(
      readProblemsSyncWorkerConfig(
        config({ PROBLEMS_SYNC_WORKER_CENSUS_INTERVAL_MS: 0 }),
      ).censusIntervalMs,
    ).toBe(0);
  });

  it('lease precisa ser maior que o tick e retryMax >= retryBase', () => {
    expect(() =>
      readProblemsSyncWorkerConfig(
        config({
          PROBLEMS_SYNC_WORKER_TICK_MS: 5000,
          PROBLEMS_SYNC_WORKER_LEASE_MS: 5000,
        }),
      ),
    ).toThrow(ProblemsSyncWorkerConfigError);
    expect(() =>
      readProblemsSyncWorkerConfig(
        config({
          PROBLEMS_SYNC_WORKER_RETRY_BASE_MS: 9000,
          PROBLEMS_SYNC_WORKER_RETRY_MAX_MS: 1000,
        }),
      ),
    ).toThrow(ProblemsSyncWorkerConfigError);
  });

  it('a mensagem de erro cita só a chave, nunca o valor', () => {
    try {
      readProblemsSyncWorkerConfig(
        config({ PROBLEMS_SYNC_WORKER_TICK_MS: 'segredo-abc' }),
      );
      fail('deveria lançar');
    } catch (error) {
      expect((error as Error).message).toContain(
        'PROBLEMS_SYNC_WORKER_TICK_MS',
      );
      expect((error as Error).message).not.toContain('segredo-abc');
    }
  });
});
