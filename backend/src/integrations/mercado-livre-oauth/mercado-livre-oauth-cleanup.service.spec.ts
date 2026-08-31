import { ConfigService } from '@nestjs/config';
import { MercadoLivreOAuthCleanupService } from './mercado-livre-oauth-cleanup.service';

function makeConfigService(staleAfterMs: number): ConfigService {
  return {
    get: (key: string, fallback?: unknown) =>
      key === 'ML_OAUTH_PROCESSING_STALE_AFTER_MS' ? staleAfterMs : fallback,
  } as unknown as ConfigService;
}

describe('MercadoLivreOAuthCleanupService', () => {
  it('sweepExpiredPending delegates directly to the authorization requests service', async () => {
    const authorizationRequestsService = {
      sweepExpiredPending: jest.fn().mockResolvedValue(3),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      {} as never,
      makeConfigService(120000),
    );

    expect(await service.sweepExpiredPending()).toBe(3);
  });

  it('recoverStaleProcessing skips a candidate whose account lock is currently held (callback/refresh still running)', async () => {
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest
        .fn()
        .mockResolvedValue([{ id: 'req-1', marketplaceAccountId: 'acc-1' }]),
      failIfStillStaleProcessing: jest.fn(),
    };
    const advisoryLockService = {
      tryAcquire: jest.fn().mockResolvedValue(null),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    const recovered = await service.recoverStaleProcessing();

    expect(recovered).toBe(0);
    expect(
      authorizationRequestsService.failIfStillStaleProcessing,
    ).not.toHaveBeenCalled();
  });

  it('recoverStaleProcessing marks FAILED and releases the lock when it acquires it', async () => {
    const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest
        .fn()
        .mockResolvedValue([{ id: 'req-1', marketplaceAccountId: 'acc-1' }]),
      failIfStillStaleProcessing: jest.fn().mockResolvedValue(true),
    };
    const advisoryLockService = {
      tryAcquire: jest.fn().mockResolvedValue(lockHandle),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    const recovered = await service.recoverStaleProcessing();

    expect(recovered).toBe(1);
    expect(
      authorizationRequestsService.failIfStillStaleProcessing,
    ).toHaveBeenCalledWith('req-1', expect.any(Date));
    expect(lockHandle.release).toHaveBeenCalled();
  });

  it('recoverStaleProcessing counts only candidates actually changed by failIfStillStaleProcessing', async () => {
    const lockHandle = { release: jest.fn().mockResolvedValue(undefined) };
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest
        .fn()
        .mockResolvedValue([{ id: 'req-1', marketplaceAccountId: 'acc-1' }]),
      failIfStillStaleProcessing: jest.fn().mockResolvedValue(false), // already handled elsewhere
    };
    const advisoryLockService = {
      tryAcquire: jest.fn().mockResolvedValue(lockHandle),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    expect(await service.recoverStaleProcessing()).toBe(0);
  });
});
