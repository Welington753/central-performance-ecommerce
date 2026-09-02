import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  PreconditionFailedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { AmazonOrdersSyncController } from './amazon-orders-sync.controller';
import { AmazonOrdersSyncError } from './amazon-orders-sync.service';

function buildController(
  overrides: { syncService?: Record<string, jest.Mock> } = {},
) {
  const syncService = { syncOrders: jest.fn(), ...overrides.syncService };
  const controller = new AmazonOrdersSyncController(syncService as never);
  return { controller, syncService };
}

const SUMMARY = {
  syncRunId: 'run-1',
  status: 'SUCCESS' as const,
  dateFrom: '2026-07-03T00:00:00.000Z',
  dateTo: '2026-09-01T00:00:00.000Z',
  pagesFetched: 1,
  ordersFetched: 2,
  ordersUpserted: 2,
  itemsUpserted: 2,
};

describe('AmazonOrdersSyncController', () => {
  it('requires AccessTokenGuard at the class level (endpoint protegido)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AmazonOrdersSyncController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  describe('syncOrders', () => {
    it('delegates to the sync service and returns its sanitized aggregate summary', async () => {
      const { controller, syncService } = buildController({
        syncService: { syncOrders: jest.fn().mockResolvedValue(SUMMARY) },
      });

      const result = await controller.syncOrders('acc-1');

      expect(syncService.syncOrders).toHaveBeenCalledWith('acc-1', {
        from: undefined,
        to: undefined,
      });
      expect(result).toEqual(SUMMARY);
    });

    it('forwards an explicit from/to body to the service', async () => {
      const { controller, syncService } = buildController({
        syncService: { syncOrders: jest.fn().mockResolvedValue(SUMMARY) },
      });

      await controller.syncOrders('acc-1', {
        from: '2026-08-01',
        to: '2026-08-05',
      });

      expect(syncService.syncOrders).toHaveBeenCalledWith('acc-1', {
        from: '2026-08-01',
        to: '2026-08-05',
      });
    });

    it('never returns individual order ids, SKUs or tokens — only the allowlisted aggregate fields', async () => {
      const { controller } = buildController({
        syncService: { syncOrders: jest.fn().mockResolvedValue(SUMMARY) },
      });
      const result = await controller.syncOrders('acc-1');
      expect(Object.keys(result).sort()).toEqual(
        [
          'syncRunId',
          'status',
          'dateFrom',
          'dateTo',
          'pagesFetched',
          'ordersFetched',
          'ordersUpserted',
          'itemsUpserted',
        ].sort(),
      );
    });

    it.each([
      ['SYNC_ALREADY_RUNNING', ConflictException],
      ['ACCOUNT_NOT_CONNECTED', ConflictException],
      ['AMAZON_NOT_CONFIGURED', PreconditionFailedException],
      ['INVALID_PERIOD', BadRequestException],
      ['PROVIDER_UNAVAILABLE', ServiceUnavailableException],
      ['PROVIDER_REJECTED_REQUEST', BadGatewayException],
      ['INVALID_PROVIDER_RESPONSE', BadGatewayException],
      ['SYNC_FAILED', ServiceUnavailableException],
    ] as const)(
      'maps AmazonOrdersSyncError "%s" to %s',
      async (code, expectedExceptionClass) => {
        const { controller } = buildController({
          syncService: {
            syncOrders: jest
              .fn()
              .mockRejectedValue(new AmazonOrdersSyncError(code)),
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
            .mockRejectedValue(
              new AmazonOrdersSyncError('PROVIDER_RATE_LIMITED'),
            ),
        },
      });

      const error: unknown = await controller
        .syncOrders('acc-1')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    });

    it('never leaks internal detail — the HTTP error body carries only the sanitized code', async () => {
      const { controller } = buildController({
        syncService: {
          syncOrders: jest
            .fn()
            .mockRejectedValue(new AmazonOrdersSyncError('SYNC_FAILED')),
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
