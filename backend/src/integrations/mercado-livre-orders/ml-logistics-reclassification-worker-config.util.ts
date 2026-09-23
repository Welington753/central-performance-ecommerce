import { ConfigService } from '@nestjs/config';

export interface MlLogisticsReclassificationWorkerConfig {
  enabled: boolean;
  tickMs: number;
  batchSize: number;
  maxCallsPerTick: number;
  maxConcurrentJobs: number;
  leaseMs: number;
  rateLimitBackoffMs: number;
  providerUnavailableBackoffMs: number;
  tokenUnavailableBackoffMs: number;
}

/**
 * Flag PRÓPRIA (correção da auditoria Full, Render free sem Shell) —
 * deliberadamente independente de `MARKETPLACE_AUTO_SYNC_ENABLED` e de
 * `BACKFILL_WORKER_ENABLED`: ligar/desligar sincronização automática ou o
 * backfill nunca deve, como efeito colateral, ligar ou desligar este worker.
 * MESMA regra dos outros dois: sempre desligado quando `NODE_ENV=test`,
 * independente do valor da env var.
 */
export function isMlLogisticsReclassificationWorkerEnabled(
  configService: ConfigService,
): boolean {
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const enabledFlag =
    configService.get<string>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_ENABLED',
      'false',
    ) === 'true';
  return nodeEnv !== 'test' && enabledFlag;
}

export function readMlLogisticsReclassificationWorkerConfig(
  configService: ConfigService,
): MlLogisticsReclassificationWorkerConfig {
  return {
    enabled: isMlLogisticsReclassificationWorkerEnabled(configService),
    tickMs: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_TICK_MS',
      8000,
    ),
    // Lido do banco por tick (nunca chamadas HTTP) — tamanho de lote da
    // fila de `LogisticsReclassificationRepository`, mesmo parâmetro que a
    // CLI já aceita.
    batchSize: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_BATCH_SIZE',
      20,
    ),
    // Orçamento BAIXO de chamadas HTTP reais por tick — o motivo de existir
    // um worker em vez de rodar `--apply` inteiro de uma vez (até 20.608
    // chamadas estimadas pela auditoria).
    maxCallsPerTick: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_MAX_CALLS_PER_TICK',
      20,
    ),
    // Ambas as contas Mercado Livre (Meli 1 e Meli 2) podem processar ao
    // mesmo tempo por padrão — cada uma com seu próprio orçamento baixo por
    // tick, nunca uma monopolizando a outra.
    maxConcurrentJobs: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_MAX_CONCURRENT_JOBS',
      2,
    ),
    leaseMs: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_LEASE_MS',
      120000,
    ),
    rateLimitBackoffMs: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_RATE_LIMIT_BACKOFF_MS',
      60000,
    ),
    providerUnavailableBackoffMs: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_PROVIDER_UNAVAILABLE_BACKOFF_MS',
      30000,
    ),
    // Falha ao obter/renovar o access token (vocabulário fechado interno de
    // `ensureValidAccessToken`, nunca distinguido aqui — decisão
    // deliberadamente conservadora: nunca declara `FAILED_AUTH` sem um
    // 401/403 EXPLÍCITO do provedor, ver doc do worker).
    tokenUnavailableBackoffMs: configService.get<number>(
      'ML_LOGISTICS_RECLASSIFICATION_WORKER_TOKEN_UNAVAILABLE_BACKOFF_MS',
      30000,
    ),
  };
}
