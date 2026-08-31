import { ConfigService } from '@nestjs/config';
import { MercadoLivreTokenRenewalJob } from './mercado-livre-token-renewal.job';

function makeConfigService(): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'ML_TOKEN_REFRESH_LEEWAY_MS' ? 900000 : fallback,
  } as unknown as ConfigService;
}

describe('MercadoLivreTokenRenewalJob', () => {
  it('sweeps expired PENDING, recovers stale PROCESSING, then renews every due account', async () => {
    const service = {
      ensureValidAccessToken: jest.fn().mockResolvedValue('token'),
    };
    const marketplaceAccountsService = {
      findConnectedDueForRenewal: jest
        .fn()
        .mockResolvedValue([{ id: 'acc-1' }, { id: 'acc-2' }]),
    };
    const cleanupService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(0),
      recoverStaleProcessing: jest.fn().mockResolvedValue(0),
    };
    const job = new MercadoLivreTokenRenewalJob(
      service as never,
      marketplaceAccountsService as never,
      cleanupService as never,
      makeConfigService(),
    );

    await job.handleCron();

    expect(cleanupService.sweepExpiredPending).toHaveBeenCalled();
    expect(cleanupService.recoverStaleProcessing).toHaveBeenCalled();
    expect(service.ensureValidAccessToken).toHaveBeenCalledWith('acc-1');
    expect(service.ensureValidAccessToken).toHaveBeenCalledWith('acc-2');
  });

  it('one account failing renewal does not stop the others from being attempted', async () => {
    const service = {
      ensureValidAccessToken: jest
        .fn()
        .mockRejectedValueOnce(new Error('REFRESH_TOKEN_REJECTED'))
        .mockResolvedValueOnce('token'),
    };
    const marketplaceAccountsService = {
      findConnectedDueForRenewal: jest
        .fn()
        .mockResolvedValue([{ id: 'acc-1' }, { id: 'acc-2' }]),
    };
    const cleanupService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(0),
      recoverStaleProcessing: jest.fn().mockResolvedValue(0),
    };
    const job = new MercadoLivreTokenRenewalJob(
      service as never,
      marketplaceAccountsService as never,
      cleanupService as never,
      makeConfigService(),
    );

    await expect(job.handleCron()).resolves.toBeUndefined();
    expect(service.ensureValidAccessToken).toHaveBeenCalledTimes(2);
  });

  it('skips a second overlapping run while one is still in progress within the same instance', async () => {
    let resolveFirst!: () => void;
    const service = {
      ensureValidAccessToken: jest.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = () => resolve('token');
          }),
      ),
    };
    const marketplaceAccountsService = {
      findConnectedDueForRenewal: jest
        .fn()
        .mockResolvedValue([{ id: 'acc-1' }]),
    };
    const cleanupService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(0),
      recoverStaleProcessing: jest.fn().mockResolvedValue(0),
    };
    const job = new MercadoLivreTokenRenewalJob(
      service as never,
      marketplaceAccountsService as never,
      cleanupService as never,
      makeConfigService(),
    );

    const firstRun = job.handleCron();
    const secondRun = job.handleCron();

    expect(cleanupService.sweepExpiredPending).toHaveBeenCalledTimes(1);

    // Divergência mínima do plano: chamar `resolveFirst()` imediatamente
    // aqui corre na frente da cadeia interna de `await`s
    // (sweepExpiredPending → recoverStaleProcessing → renewDueAccounts →
    // findConnectedDueForRenewal → ensureValidAccessToken) — sem nenhum
    // `await` entre as chamadas síncronas acima, a fila de microtasks nunca
    // é processada, então `ensureValidAccessToken` ainda não foi chamado e
    // `resolveFirst` continua indefinido. Uma barreira de macrotask
    // (`setImmediate`) drena toda a fila de microtasks pendentes antes de
    // continuar — determinístico, sem depender de contar ticks nem de um
    // `setTimeout` arbitrário "longo o suficiente".
    await new Promise<void>((resolve) => setImmediate(resolve));

    resolveFirst();
    await Promise.all([firstRun, secondRun]);
  });
});
