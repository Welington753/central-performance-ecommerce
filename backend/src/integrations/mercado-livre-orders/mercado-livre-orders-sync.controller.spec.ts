import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  BadGatewayException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { MercadoLivreOrdersSyncController } from './mercado-livre-orders-sync.controller';
import { SyncOrdersError } from './mercado-livre-orders-sync.service';

function buildController(
  overrides: { syncService?: Record<string, jest.Mock> } = {},
) {
  const syncService = { syncOrders: jest.fn(), ...overrides.syncService };
  const controller = new MercadoLivreOrdersSyncController(syncService as never);
  return { controller, syncService };
}

describe('MercadoLivreOrdersSyncController', () => {
  it('requires AccessTokenGuard at the class level (endpoint protegido)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MercadoLivreOrdersSyncController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  describe('syncOrders', () => {
    it('delegates to the sync service and returns its sanitized summary', async () => {
      const summary = {
        status: 'SUCCESS',
        startedAt: '2026-09-01T00:00:00.000Z',
        finishedAt: '2026-09-01T00:00:05.000Z',
        pagesFetched: 1,
        ordersFetched: 2,
        ordersCreated: 2,
        ordersUpdated: 0,
        itemsPersisted: 2,
        periodFrom: '2026-07-03T00:00:00.000Z',
        periodTo: '2026-09-01T00:00:00.000Z',
      };
      const { controller, syncService } = buildController({
        syncService: { syncOrders: jest.fn().mockResolvedValue(summary) },
      });

      const result = await controller.syncOrders('acc-1');

      expect(syncService.syncOrders).toHaveBeenCalledWith('acc-1');
      expect(result).toEqual(summary);
    });

    it.each([
      ['SYNC_ALREADY_RUNNING', ConflictException],
      ['ACCOUNT_NOT_CONNECTED', ConflictException],
      ['PROVIDER_UNAVAILABLE', ServiceUnavailableException],
      ['INVALID_PROVIDER_RESPONSE', BadGatewayException],
      ['SYNC_FAILED', ServiceUnavailableException],
    ] as const)(
      'maps SyncOrdersError "%s" to %s',
      async (code, expectedExceptionClass) => {
        const { controller } = buildController({
          syncService: {
            syncOrders: jest.fn().mockRejectedValue(new SyncOrdersError(code)),
          },
        });

        await expect(controller.syncOrders('acc-1')).rejects.toBeInstanceOf(
          expectedExceptionClass,
        );
      },
    );

    it('maps PROVIDER_RATE_LIMITED to HTTP 429', async () => {
      const { controller } = buildController({
        syncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(new SyncOrdersError('PROVIDER_RATE_LIMITED')),
        },
      });

      const error: unknown = await controller
        .syncOrders('acc-1')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    });

    it('never leaks the sanitized error code into a body containing internal fields', async () => {
      const { controller } = buildController({
        syncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(new SyncOrdersError('SYNC_FAILED')),
        },
      });
      const error: unknown = await controller
        .syncOrders('acc-1')
        .catch((e: unknown) => e);
      const body = (error as HttpException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body.message).toBe('SYNC_FAILED');
      expect(Object.keys(body).sort()).toEqual(
        ['message', 'error', 'statusCode'].sort(),
      );
    });
  });
});
