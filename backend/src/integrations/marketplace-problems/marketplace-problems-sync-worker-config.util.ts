import type { ConfigService } from '@nestjs/config';
import {
  HARD_MAX_CLAIMS,
  HARD_MAX_HTTP_CALLS,
} from './mercado-livre-problems-sync-limits';

export interface ProblemsSyncWorkerConfig {
  enabled: boolean;
  tickMs: number;
  maxConcurrentJobs: number;
  leaseMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  requeueDelayMs: number;
  /** Fallback quando o provedor não informa `retryAfterMs`. */
  rateLimitBackoffMs: number;
  /** Intervalo entre ticks bem-sucedidos de um mesmo job. */
  syncIntervalMs: number;
  /** Cadência mínima do censo de abertos (0 = todo tick). */
  censusIntervalMs: number;
  /** Orçamento GLOBAL por tick, compartilhado entre criação, censo e refresh. */
  tickMaxClaims: number;
  tickMaxHttpCalls: number;
  refreshBatchSize: number;
}

/** Configuração inválida — a mensagem cita só a CHAVE, nunca o valor. */
export class ProblemsSyncWorkerConfigError extends Error {
  constructor(key: string) {
    super(`Configuração inválida: ${key}`);
    this.name = 'ProblemsSyncWorkerConfigError';
  }
}

/**
 * Flag PRÓPRIA — independente de `MARKETPLACE_AUTO_SYNC_ENABLED`,
 * `BACKFILL_WORKER_ENABLED` e `ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED`.
 * Default `false`; só o texto exato `'true'` liga (qualquer outro valor
 * falha fechado). Sempre desligado quando `NODE_ENV=test`.
 */
export function isProblemsSyncWorkerEnabled(
  configService: ConfigService,
): boolean {
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const flag = configService.get<unknown>(
    'PROBLEMS_SYNC_WORKER_ENABLED',
    'false',
  );
  return nodeEnv !== 'test' && flag === 'true';
}

interface IntOptions {
  min?: number;
  max?: number;
}

function readInt(
  configService: ConfigService,
  key: string,
  fallback: number,
  { min = 1, max }: IntOptions = {},
): number {
  const raw = configService.get<unknown>(key, fallback);
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  if (
    !Number.isInteger(value) ||
    value < min ||
    (max !== undefined && value > max)
  ) {
    throw new ProblemsSyncWorkerConfigError(key);
  }
  return value;
}

/** Lê e valida TODA a configuração do worker; qualquer valor inválido lança (fail-closed). */
export function readProblemsSyncWorkerConfig(
  configService: ConfigService,
): ProblemsSyncWorkerConfig {
  const p = 'PROBLEMS_SYNC_WORKER_';
  const config: ProblemsSyncWorkerConfig = {
    enabled: isProblemsSyncWorkerEnabled(configService),
    tickMs: readInt(configService, `${p}TICK_MS`, 10000),
    maxConcurrentJobs: readInt(configService, `${p}MAX_CONCURRENT_JOBS`, 2),
    leaseMs: readInt(configService, `${p}LEASE_MS`, 300000),
    maxAttempts: readInt(configService, `${p}MAX_ATTEMPTS`, 5),
    retryBaseMs: readInt(configService, `${p}RETRY_BASE_MS`, 30000),
    retryMaxMs: readInt(configService, `${p}RETRY_MAX_MS`, 900000),
    requeueDelayMs: readInt(configService, `${p}REQUEUE_MS`, 10000),
    rateLimitBackoffMs: readInt(
      configService,
      `${p}RATE_LIMIT_BACKOFF_MS`,
      60000,
    ),
    syncIntervalMs: readInt(configService, `${p}SYNC_INTERVAL_MS`, 60000),
    censusIntervalMs: readInt(
      configService,
      `${p}CENSUS_INTERVAL_MS`,
      6 * 60 * 60 * 1000,
      { min: 0 },
    ),
    tickMaxClaims: readInt(configService, `${p}TICK_MAX_CLAIMS`, 50, {
      max: HARD_MAX_CLAIMS,
    }),
    tickMaxHttpCalls: readInt(configService, `${p}TICK_MAX_HTTP_CALLS`, 300, {
      max: HARD_MAX_HTTP_CALLS,
    }),
    refreshBatchSize: readInt(configService, `${p}REFRESH_BATCH_SIZE`, 20),
  };
  if (config.leaseMs <= config.tickMs) {
    throw new ProblemsSyncWorkerConfigError(`${p}LEASE_MS`);
  }
  if (config.retryMaxMs < config.retryBaseMs) {
    throw new ProblemsSyncWorkerConfigError(`${p}RETRY_MAX_MS`);
  }
  return config;
}
