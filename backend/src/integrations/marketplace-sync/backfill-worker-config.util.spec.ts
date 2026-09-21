import { ConfigService } from '@nestjs/config';
import { isBackfillWorkerEnabled } from './backfill-worker-config.util';

function fakeConfigService(env: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key in env ? env[key] : fallback,
  } as unknown as ConfigService;
}

/**
 * Regressão do bug de produção (render.yaml conflava as duas flags): prova,
 * isoladamente, que `isBackfillWorkerEnabled` NUNCA lê
 * `MARKETPLACE_AUTO_SYNC_ENABLED` — só `BACKFILL_WORKER_ENABLED`/`NODE_ENV`.
 * Um backfill pedido manualmente pelo usuário precisa continuar sendo
 * processado mesmo com a sincronização automática desligada.
 */
describe('isBackfillWorkerEnabled', () => {
  it('fica habilitado por padrão em produção mesmo com MARKETPLACE_AUTO_SYNC_ENABLED=false', () => {
    const configService = fakeConfigService({
      NODE_ENV: 'production',
      MARKETPLACE_AUTO_SYNC_ENABLED: 'false',
    });
    expect(isBackfillWorkerEnabled(configService)).toBe(true);
  });

  it('continua habilitado mesmo se MARKETPLACE_AUTO_SYNC_ENABLED nunca for definida', () => {
    const configService = fakeConfigService({ NODE_ENV: 'production' });
    expect(isBackfillWorkerEnabled(configService)).toBe(true);
  });

  it('só desliga com BACKFILL_WORKER_ENABLED=false explícito — nunca como efeito colateral do auto-sync', () => {
    const configService = fakeConfigService({
      NODE_ENV: 'production',
      MARKETPLACE_AUTO_SYNC_ENABLED: 'true',
      BACKFILL_WORKER_ENABLED: 'false',
    });
    expect(isBackfillWorkerEnabled(configService)).toBe(false);
  });

  it('continua desligado sob NODE_ENV=test mesmo com as duas flags "true"', () => {
    const configService = fakeConfigService({
      NODE_ENV: 'test',
      MARKETPLACE_AUTO_SYNC_ENABLED: 'true',
      BACKFILL_WORKER_ENABLED: 'true',
    });
    expect(isBackfillWorkerEnabled(configService)).toBe(false);
  });
});
