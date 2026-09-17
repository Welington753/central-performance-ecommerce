import { ConflictException, NotFoundException } from '@nestjs/common';
import { SyncRunType } from '../../sync/sync-run.entity';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { SyncAlreadyRunningError } from '../marketplace-orders/marketplace-orders-persistence.service';
import { ShopeeOrderMappingError } from './shopee-order.mapper';
import { ShopeeOrdersSyncError } from './shopee-orders-sync-error';
import { ShopeeOrdersSyncService } from './shopee-orders-sync.service';

const ACCOUNT_ID = 'account-1';
const CREDENTIALS = { accessToken: 'token-abc', shopId: '555444333' };

function connectedAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    marketplace: Marketplace.SHOPEE,
    status: MarketplaceAccountStatus.CONNECTED,
    externalSellerId: '555444333',
    ...overrides,
  };
}

function listSuccess(orderSns: string[]) {
  return {
    kind: 'success' as const,
    result: {
      orders: orderSns.map((orderSn) => ({ orderSn })),
      more: false,
      nextCursor: null,
      requestId: 'req-1',
    },
  };
}

function detailSuccess(orders: Record<string, unknown>[]) {
  return {
    kind: 'success' as const,
    result: { orders, requestId: 'req-1' },
  };
}

function validDetailOrder(orderSn: string) {
  return {
    orderSn,
    region: 'BR',
    currency: 'BRL',
    orderStatus: 'COMPLETED',
    totalAmount: 100,
    createTime: 1700000000,
    updateTime: 1700003600,
    fulfillmentFlag: null,
    items: [],
  };
}

function buildService(
  overrides: {
    marketplaceAccountsService?: Record<string, jest.Mock>;
    accessTokenService?: Record<string, jest.Mock>;
    client?: Record<string, jest.Mock>;
    persistence?: Record<string, jest.Mock>;
  } = {},
) {
  const marketplaceAccountsService = {
    findByIdOrFail: jest.fn().mockResolvedValue(connectedAccount()),
    ...overrides.marketplaceAccountsService,
  };
  const accessTokenService = {
    ensureValidShopCredentials: jest.fn().mockResolvedValue(CREDENTIALS),
    ...overrides.accessTokenService,
  };
  const client = {
    getOrderList: jest.fn().mockResolvedValue(listSuccess([])),
    getOrderDetail: jest.fn().mockResolvedValue(detailSuccess([])),
    ...overrides.client,
  };
  const persistence = {
    getAccountSyncCoverage: jest.fn().mockResolvedValue({
      intervals: [],
      oldestFrom: null,
      oldestRunRecordsRead: null,
    }),
    beginSyncRun: jest.fn().mockResolvedValue('run-1'),
    persistOrders: jest.fn().mockResolvedValue({
      ordersCreated: 0,
      ordersUpdated: 0,
      itemsPersisted: 0,
    }),
    finalizeSyncRunSuccess: jest.fn().mockResolvedValue(undefined),
    finalizeSyncRunFailure: jest.fn().mockResolvedValue(undefined),
    finalizeSyncRunIncomplete: jest.fn().mockResolvedValue(undefined),
    finalizeSyncRunPartial: jest.fn().mockResolvedValue(undefined),
    markAccountSynced: jest.fn().mockResolvedValue(undefined),
    ...overrides.persistence,
  };

  const service = new ShopeeOrdersSyncService(
    marketplaceAccountsService as never,
    accessTokenService as never,
    client as never,
    persistence as never,
  );
  return {
    service,
    marketplaceAccountsService,
    accessTokenService,
    client,
    persistence,
  };
}

describe('ShopeeOrdersSyncService.syncOrders', () => {
  describe('validação de conta', () => {
    it('conta inexistente: propaga o erro de findByIdOrFail, nunca cria SyncRun', async () => {
      const { service, persistence } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockRejectedValue(new NotFoundException('não encontrada')),
        },
      });
      await expect(service.syncOrders(ACCOUNT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(persistence.beginSyncRun).not.toHaveBeenCalled();
    });

    it('marketplace errado: 404 genérico, nunca cria SyncRun', async () => {
      const { service, persistence } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(
              connectedAccount({ marketplace: Marketplace.AMAZON }),
            ),
        },
      });
      await expect(service.syncOrders(ACCOUNT_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(persistence.beginSyncRun).not.toHaveBeenCalled();
    });

    it('conta desconectada: NOT_CONNECTED, nunca cria SyncRun', async () => {
      const { service, persistence } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest.fn().mockResolvedValue(
            connectedAccount({
              status: MarketplaceAccountStatus.DISCONNECTED,
            }),
          ),
        },
      });
      await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject(
        new ShopeeOrdersSyncError('NOT_CONNECTED'),
      );
      expect(persistence.beginSyncRun).not.toHaveBeenCalled();
    });

    it('sem externalSellerId: NOT_CONNECTED, nunca cria SyncRun', async () => {
      const { service, persistence } = buildService({
        marketplaceAccountsService: {
          findByIdOrFail: jest
            .fn()
            .mockResolvedValue(connectedAccount({ externalSellerId: null })),
        },
      });
      await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject(
        new ShopeeOrdersSyncError('NOT_CONNECTED'),
      );
      expect(persistence.beginSyncRun).not.toHaveBeenCalled();
    });
  });

  it('execução já em andamento: SYNC_ALREADY_RUNNING, nenhum SyncRun órfão para finalizar', async () => {
    const { service, persistence } = buildService({
      persistence: {
        beginSyncRun: jest
          .fn()
          .mockRejectedValue(new SyncAlreadyRunningError()),
      },
    });
    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject(
      new ShopeeOrdersSyncError('SYNC_ALREADY_RUNNING'),
    );
    expect(persistence.finalizeSyncRunFailure).not.toHaveBeenCalled();
  });

  it('credenciais são obtidas exatamente uma vez, mesmo com múltiplas páginas/blocos', async () => {
    const { service, accessTokenService } = buildService({
      client: {
        getOrderList: jest
          .fn()
          .mockResolvedValueOnce({
            kind: 'success',
            result: {
              orders: [{ orderSn: 'A' }],
              more: true,
              nextCursor: 'c1',
              requestId: 'r',
            },
          })
          .mockResolvedValue(listSuccess(['B'])),
        getOrderDetail: jest.fn().mockResolvedValue(detailSuccess([])),
      },
    });
    await service.syncOrders(ACCOUNT_ID);
    expect(accessTokenService.ensureValidShopCredentials).toHaveBeenCalledTimes(
      1,
    );
  });

  it.each([
    ['ACCOUNT_BUSY', 'CONNECTION_BUSY'],
    ['SHOPEE_NOT_CONFIGURED', 'NOT_CONFIGURED'],
    ['ACCOUNT_NOT_ELIGIBLE', 'NOT_CONNECTED'],
  ] as const)(
    'falha de credenciais "%s" finaliza o SyncRun como FAILURE e lança "%s"',
    async (conflictMessage, expectedCode) => {
      const { service, persistence } = buildService({
        accessTokenService: {
          ensureValidShopCredentials: jest
            .fn()
            .mockRejectedValue(new ConflictException(conflictMessage)),
        },
      });
      await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject(
        new ShopeeOrdersSyncError(expectedCode),
      );
      expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
        'run-1',
        expectedCode,
        expect.any(String),
        expect.any(Date),
      );
    },
  );

  it.each([
    ['temporary_failure', 'TEMPORARILY_UNAVAILABLE'],
    ['invalid_response', 'DATA_UNAVAILABLE'],
  ] as const)(
    'outcome "%s" de getOrderList finaliza como FAILURE "%s", nunca persiste',
    async (kind, expectedCode) => {
      const { service, persistence } = buildService({
        client: { getOrderList: jest.fn().mockResolvedValue({ kind }) },
      });
      await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject(
        new ShopeeOrdersSyncError(expectedCode),
      );
      expect(persistence.persistOrders).not.toHaveBeenCalled();
      expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
        'run-1',
        expectedCode,
        expect.any(String),
        expect.any(Date),
      );
    },
  );

  it('outcome inválido de getOrderDetail finaliza como FAILURE DATA_UNAVAILABLE, nunca persiste', async () => {
    const { service, persistence } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue(listSuccess(['A'])),
        getOrderDetail: jest
          .fn()
          .mockResolvedValue({ kind: 'invalid_response' }),
      },
    });
    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject(
      new ShopeeOrdersSyncError('DATA_UNAVAILABLE'),
    );
    expect(persistence.persistOrders).not.toHaveBeenCalled();
  });

  it('mapeamento inválido (totalAmount ausente) aborta ANTES de persistir, finaliza FAILURE DATA_UNAVAILABLE', async () => {
    const { service, persistence } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue(listSuccess(['A'])),
        getOrderDetail: jest
          .fn()
          .mockResolvedValue(
            detailSuccess([{ ...validDetailOrder('A'), totalAmount: null }]),
          ),
      },
    });
    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject(
      new ShopeeOrdersSyncError('DATA_UNAVAILABLE'),
    );
    expect(persistence.persistOrders).not.toHaveBeenCalled();
    expect(persistence.finalizeSyncRunFailure).toHaveBeenCalledWith(
      'run-1',
      'DATA_UNAVAILABLE',
      expect.any(String),
      expect.any(Date),
    );
  });

  it('erro de mapeamento propaga como ShopeeOrderMappingError encapsulado, nunca vaza dado do pedido', async () => {
    const { service } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue(listSuccess(['A'])),
        getOrderDetail: jest
          .fn()
          .mockResolvedValue(
            detailSuccess([{ ...validDetailOrder('A'), totalAmount: null }]),
          ),
      },
    });
    try {
      await service.syncOrders(ACCOUNT_ID);
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error).not.toBeInstanceOf(ShopeeOrderMappingError);
      expect(error).toBeInstanceOf(ShopeeOrdersSyncError);
    }
  });

  it('sucesso com ZERO pedidos: SUCCESS, persistOrders([]), markAccountSynced chamado', async () => {
    const { service, persistence } = buildService();
    const result = await service.syncOrders(ACCOUNT_ID);

    expect(result.status).toBe('SUCCESS');
    expect(result.ordersFetched).toBe(0);
    expect(persistence.persistOrders).toHaveBeenCalledWith([]);
    expect(persistence.finalizeSyncRunSuccess).toHaveBeenCalledTimes(1);
    expect(persistence.markAccountSynced).toHaveBeenCalledTimes(1);
    expect(persistence.finalizeSyncRunIncomplete).not.toHaveBeenCalled();
    expect(persistence.finalizeSyncRunFailure).not.toHaveBeenCalled();
  });

  it('passes options.type through to beginSyncRun when provided', async () => {
    const { service, persistence } = buildService();

    await service.syncOrders(ACCOUNT_ID, { type: SyncRunType.INCREMENTAL });

    expect(persistence.beginSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: SyncRunType.INCREMENTAL }),
    );
  });

  it('calls beginSyncRun with type: undefined when syncOrders is called without options — relies on beginSyncRun defaulting to MANUAL itself, never overrides it (manual sync, unchanged behavior)', async () => {
    const { service, persistence } = buildService();

    await service.syncOrders(ACCOUNT_ID);

    expect(persistence.beginSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({ type: undefined }),
    );
  });

  it('sucesso com VÁRIOS pedidos: mapeia, persiste e finaliza SUCCESS', async () => {
    const { service, persistence } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue(listSuccess(['A', 'B'])),
        getOrderDetail: jest
          .fn()
          .mockResolvedValue(
            detailSuccess([validDetailOrder('A'), validDetailOrder('B')]),
          ),
      },
      persistence: {
        persistOrders: jest.fn().mockResolvedValue({
          ordersCreated: 2,
          ordersUpdated: 0,
          itemsPersisted: 0,
        }),
      },
    });

    const result = await service.syncOrders(ACCOUNT_ID);

    expect(result.status).toBe('SUCCESS');
    expect(result.ordersFetched).toBe(2);
    expect(result.ordersCreated).toBe(2);
    expect(persistence.persistOrders).toHaveBeenCalledTimes(1);
    const calls = persistence.persistOrders.mock.calls as unknown[][];
    const persistedOrders = calls[0][0] as Array<{ externalOrderId: string }>;
    expect(persistedOrders.map((o) => o.externalOrderId)).toEqual(['A', 'B']);
    expect(persistence.markAccountSynced).toHaveBeenCalledTimes(1);
  });

  describe('teto de segurança (Checkpoint CP2K-5C-3): PARTIAL via finalizeSyncRunPartial', () => {
    it('cap SEM fronteira (dentro do primeiro bloco): status INCOMPLETE, PARTIAL com covered_through null, nunca finalizeSyncRunIncomplete, nunca markAccountSynced', async () => {
      const { service, persistence } = buildService({
        client: {
          getOrderList: jest.fn().mockResolvedValue({
            kind: 'success',
            result: {
              orders: [{ orderSn: 'A' }],
              more: true,
              nextCursor: '',
              requestId: 'r',
            },
          }),
        },
      });

      const result = await service.syncOrders(ACCOUNT_ID);

      expect(result.status).toBe('INCOMPLETE');
      expect(persistence.finalizeSyncRunPartial).toHaveBeenCalledTimes(1);
      expect(persistence.finalizeSyncRunPartial).toHaveBeenCalledWith(
        'run-1',
        {
          ordersFetched: 1,
          ordersCreated: 0,
          ordersUpdated: 0,
          recordsFailed: 0,
          pagesFetched: 1,
          itemsPersisted: 0,
        },
        null,
        'SHOPEE_SAFETY_CAP_REACHED',
        expect.any(String),
        expect.any(Date),
      );
      expect(persistence.finalizeSyncRunIncomplete).not.toHaveBeenCalled();
      expect(persistence.finalizeSyncRunSuccess).not.toHaveBeenCalled();
      expect(persistence.markAccountSynced).not.toHaveBeenCalled();
      expect(persistence.finalizeSyncRunFailure).not.toHaveBeenCalled();
    });

    it('cap COM fronteira (bloco 1 completo naturalmente, bloco 2 capado): PARTIAL com covered_through = timeTo do bloco 1', async () => {
      const blockCalls: number[] = [];
      const { service, persistence } = buildService({
        client: {
          getOrderList: jest
            .fn()
            .mockImplementation((input: { timeTo: number }) => {
              blockCalls.push(input.timeTo);
              if (blockCalls.length === 1) {
                return Promise.resolve(listSuccess(['A']));
              }
              return Promise.resolve({
                kind: 'success',
                result: {
                  orders: [{ orderSn: 'B' }],
                  more: true,
                  nextCursor: '',
                  requestId: 'r',
                },
              });
            }),
          getOrderDetail: jest
            .fn()
            .mockResolvedValue(
              detailSuccess([validDetailOrder('A'), validDetailOrder('B')]),
            ),
        },
        persistence: {
          persistOrders: jest.fn().mockResolvedValue({
            ordersCreated: 2,
            ordersUpdated: 0,
            itemsPersisted: 0,
          }),
        },
      });

      const result = await service.syncOrders(ACCOUNT_ID);

      expect(result.status).toBe('INCOMPLETE');
      expect(blockCalls.length).toBeGreaterThanOrEqual(2);
      const firstBlockTimeTo = blockCalls[0];
      expect(persistence.finalizeSyncRunPartial).toHaveBeenCalledTimes(1);
      const call = persistence.finalizeSyncRunPartial.mock.calls[0] as [
        string,
        unknown,
        Date | null,
        string,
        string,
        Date,
      ];
      const coveredThrough = call[2];
      expect(coveredThrough).not.toBeNull();
      expect((coveredThrough as Date).getTime()).toBe(firstBlockTimeTo * 1000);
      expect(persistence.finalizeSyncRunIncomplete).not.toHaveBeenCalled();
      expect(persistence.markAccountSynced).not.toHaveBeenCalled();
    });

    it('persiste mesmo quando capped=true (o que foi coletado antes do teto), atomicamente, antes de finalizar', async () => {
      const { service, persistence } = buildService({
        client: {
          getOrderList: jest.fn().mockResolvedValue({
            kind: 'success',
            result: {
              orders: [{ orderSn: 'A' }],
              more: true,
              nextCursor: '',
              requestId: 'r',
            },
          }),
          getOrderDetail: jest
            .fn()
            .mockResolvedValue(detailSuccess([validDetailOrder('A')])),
        },
        persistence: {
          persistOrders: jest.fn().mockResolvedValue({
            ordersCreated: 1,
            ordersUpdated: 0,
            itemsPersisted: 0,
          }),
        },
      });

      const result = await service.syncOrders(ACCOUNT_ID);
      expect(result.status).toBe('INCOMPLETE');
      expect(result.ordersCreated).toBe(1);
      expect(persistence.persistOrders).toHaveBeenCalledTimes(1);
    });

    it(
      'cap SEM fronteira em duas execuções consecutivas (cobertura mockada sempre vazia): ' +
        'periodFrom não avança, nenhuma cobertura falsa é criada',
      async () => {
        const { service, persistence } = buildService({
          client: {
            getOrderList: jest.fn().mockResolvedValue({
              kind: 'success',
              result: {
                orders: [{ orderSn: 'A' }],
                more: true,
                nextCursor: '',
                requestId: 'r',
              },
            }),
          },
        });

        await service.syncOrders(ACCOUNT_ID);
        await service.syncOrders(ACCOUNT_ID);

        expect(persistence.getAccountSyncCoverage).toHaveBeenCalledTimes(2);
        expect(persistence.markAccountSynced).not.toHaveBeenCalled();
        expect(persistence.finalizeSyncRunPartial).toHaveBeenCalledTimes(2);
        for (const call of persistence.finalizeSyncRunPartial.mock
          .calls as unknown[][]) {
          expect(call[2]).toBeNull();
        }
        const beginCalls = persistence.beginSyncRun.mock.calls as unknown[][];
        const firstWindow = beginCalls[0][0] as { periodFrom: Date };
        const secondWindow = beginCalls[1][0] as { periodFrom: Date };
        expect(
          Math.abs(
            firstWindow.periodFrom.getTime() -
              secondWindow.periodFrom.getTime(),
          ),
        ).toBeLessThan(5000);
      },
    );
  });
});
