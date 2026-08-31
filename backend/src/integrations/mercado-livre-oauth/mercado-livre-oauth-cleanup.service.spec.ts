import { Logger } from '@nestjs/common';
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

  it('recoverStaleProcessing isolates a failure on one candidate — a throwing tryAcquire/failIfStillStaleProcessing for candidate A does not stop candidate B from being processed', async () => {
    const lockHandleB = { release: jest.fn().mockResolvedValue(undefined) };
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest.fn().mockResolvedValue([
        { id: 'req-A-broken', marketplaceAccountId: 'acc-A' },
        { id: 'req-B-ok', marketplaceAccountId: 'acc-B' },
      ]),
      failIfStillStaleProcessing: jest.fn((id: string) =>
        id === 'req-B-ok'
          ? Promise.resolve(true)
          : Promise.reject(new Error('db down')),
      ),
    };
    const advisoryLockService = {
      tryAcquire: jest.fn((accountId: string) =>
        accountId === 'acc-A'
          ? Promise.reject(new Error('connection reset'))
          : Promise.resolve(lockHandleB),
      ),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    const recovered = await service.recoverStaleProcessing();

    // A falhou (tryAcquire rejeitou), mas B ainda foi processada e contada.
    expect(recovered).toBe(1);
    expect(
      authorizationRequestsService.failIfStillStaleProcessing,
    ).toHaveBeenCalledWith('req-B-ok', expect.any(Date));
    expect(lockHandleB.release).toHaveBeenCalledTimes(1);
  });

  it('recoverStaleProcessing never logs a raw secret from a failed candidate — code, state, Bearer token, and client_secret are all sanitized before reaching the Logger', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const sensitiveError = new Error(
      'ML token exchange failed: code=abc123 state=xyz789 ' +
        'Authorization: Bearer APP_USR-1234567890abcdef ' +
        'client_secret=super-secret-value',
    );
    const authorizationRequestsService = {
      findStaleProcessingCandidates: jest
        .fn()
        .mockResolvedValue([{ id: 'req-1', marketplaceAccountId: 'acc-1' }]),
      failIfStillStaleProcessing: jest.fn().mockRejectedValue(sensitiveError),
    };
    const advisoryLockService = {
      tryAcquire: jest
        .fn()
        .mockResolvedValue({ release: jest.fn().mockResolvedValue(undefined) }),
    };
    const service = new MercadoLivreOAuthCleanupService(
      authorizationRequestsService as never,
      advisoryLockService as never,
      makeConfigService(120000),
    );

    await service.recoverStaleProcessing();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(errorSpy.mock.calls[0]);
    expect(loggedPayload).not.toContain('abc123');
    expect(loggedPayload).not.toContain('xyz789');
    expect(loggedPayload).not.toContain('APP_USR-1234567890abcdef');
    expect(loggedPayload).not.toContain('super-secret-value');

    errorSpy.mockRestore();
  });
});
