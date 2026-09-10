import { ConfigService } from '@nestjs/config';

/**
 * Interpretação EFETIVA de "o worker do backfill está habilitado" — única
 * fonte de verdade, compartilhada entre `MarketplaceBackfillWorkerService`
 * (decide se cria o timer) e `MarketplaceBackfillService.getStatus`
 * (`workerEnabled` exposto ao frontend) para nunca divergir: `NODE_ENV=test`
 * desliga sempre, mesmo com a env var dizendo o contrário.
 */
export function isBackfillWorkerEnabled(configService: ConfigService): boolean {
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const enabledFlag =
    configService.get<string>('BACKFILL_WORKER_ENABLED', 'true') === 'true';
  return nodeEnv !== 'test' && enabledFlag;
}
