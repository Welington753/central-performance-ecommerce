import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  BadGatewayException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { ShopeeOrdersSyncError } from './shopee-orders-sync-error';
import { ShopeeOrdersSyncController } from './shopee-orders-sync.controller';

function buildController(
  overrides: { syncService?: Record<string, jest.Mock> } = {},
) {
  const syncService = { syncOrders: jest.fn(), ...overrides.syncService };
  const controller = new ShopeeOrdersSyncController(syncService as never);
  return { controller, syncService };
}

describe('ShopeeOrdersSyncController', () => {
  it('exige AccessTokenGuard no nível da classe', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ShopeeOrdersSyncController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  describe('syncOrders', () => {
    it('delega ao serviço e devolve o resumo sanitizado', async () => {
      const summary = {
        syncRunId: 'run-1',
        status: 'SUCCESS',
        periodFrom: '2026-07-03T00:00:00.000Z',
        periodTo: '2026-09-01T00:00:00.000Z',
        pagesFetched: 1,
        ordersFetched: 2,
        ordersCreated: 2,
        ordersUpdated: 0,
        itemsPersisted: 2,
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
      ['NOT_CONNECTED', ConflictException],
      ['CONNECTION_BUSY', ConflictException],
      ['NOT_CONFIGURED', ConflictException],
      ['DATA_UNAVAILABLE', BadGatewayException],
      ['TEMPORARILY_UNAVAILABLE', ServiceUnavailableException],
      ['SYNC_FAILED', ServiceUnavailableException],
    ] as const)(
      'mapeia ShopeeOrdersSyncError "%s" para %s',
      async (code, expectedExceptionClass) => {
        const { controller } = buildController({
          syncService: {
            syncOrders: jest
              .fn()
              .mockRejectedValue(new ShopeeOrdersSyncError(code)),
          },
        });

        await expect(controller.syncOrders('acc-1')).rejects.toBeInstanceOf(
          expectedExceptionClass,
        );
      },
    );

    it('propaga erros que não são ShopeeOrdersSyncError sem transformação', async () => {
      const originalError = new Error('erro inesperado qualquer');
      const { controller } = buildController({
        syncService: { syncOrders: jest.fn().mockRejectedValue(originalError) },
      });

      await expect(controller.syncOrders('acc-1')).rejects.toBe(originalError);
    });
  });
});
