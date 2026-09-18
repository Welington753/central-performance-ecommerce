import { Logger } from '@nestjs/common';
import { Marketplace } from '../contracts/marketplace.enum';
import { MarketplaceAccountStatus } from '../marketplace-accounts/marketplace-account.entity';
import { ShopeeOrdersSyncService } from './shopee-orders-sync.service';

/**
 * Log estruturado e sanitizado `SHOPEE_ORDER_SYNC_FAILED` — único ponto de
 * emissão (nível de sincronização, `ShopeeOrdersSyncService`), nunca
 * duplicado por camada (`ShopeeOrdersApiClient`/`shopee-orders-fetch.util.ts`
 * nunca logam, só anexam diagnóstico sanitizado ao erro). Split próprio do
 * spec de comportamento já existente (`shopee-orders-sync.service.spec.ts`).
 */
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
  return { service, persistence };
}

describe('ShopeeOrdersSyncService.syncOrders - log SHOPEE_ORDER_SYNC_FAILED', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('provider_rejected em get_order_list: loga stage ORDER_LIST exatamente uma vez', async () => {
    const { service } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue({
          kind: 'provider_rejected',
          diagnostics: { httpStatus: 200, providerErrorCode: 'error_shop' },
        }),
      },
    });

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, payload] = errorSpy.mock.calls[0] as [string, unknown];
    expect(message).toBe('SHOPEE_ORDER_SYNC_FAILED');
    expect(payload).toMatchObject({
      failureCode: 'DATA_UNAVAILABLE',
      marketplaceAccountId: ACCOUNT_ID,
      syncRunId: 'run-1',
      stage: 'ORDER_LIST',
      outcomeKind: 'provider_rejected',
      providerErrorCode: 'error_shop',
      httpStatus: 200,
    });
  });

  it('provider_rejected em get_order_detail: loga stage ORDER_DETAIL exatamente uma vez', async () => {
    const { service } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue(listSuccess(['A'])),
        getOrderDetail: jest.fn().mockResolvedValue({
          kind: 'provider_rejected',
          diagnostics: {
            httpStatus: 200,
            providerErrorCode: 'error_order_not_umi',
          },
        }),
      },
    });

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, payload] = errorSpy.mock.calls[0] as [string, unknown];
    expect(message).toBe('SHOPEE_ORDER_SYNC_FAILED');
    expect(payload).toMatchObject({
      failureCode: 'DATA_UNAVAILABLE',
      stage: 'ORDER_DETAIL',
      outcomeKind: 'provider_rejected',
      providerErrorCode: 'error_order_not_umi',
    });
  });

  it('ShopeeOrderMappingError: loga stage MAPPING e mappingReason correto, exatamente uma vez', async () => {
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

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, payload] = errorSpy.mock.calls[0] as [string, unknown];
    expect(message).toBe('SHOPEE_ORDER_SYNC_FAILED');
    expect(payload).toMatchObject({
      failureCode: 'DATA_UNAVAILABLE',
      stage: 'MAPPING',
      mappingReason: 'MISSING_TOTAL_AMOUNT',
    });
    expect(payload).not.toHaveProperty('outcomeKind');
  });

  it('invalid_response: loga outcomeKind sem corpo bruto, sem raw.message, sem order_sn', async () => {
    const { service } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue({
          kind: 'invalid_response',
          diagnostics: { httpStatus: 200 },
        }),
      },
    });

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toThrow();

    const [, payload] = errorSpy.mock.calls[0] as [string, unknown];
    expect(payload).toMatchObject({ outcomeKind: 'invalid_response' });
    expect(JSON.stringify(payload)).not.toContain('mensagem sensivel');
    expect(JSON.stringify(payload)).not.toContain('555444333');
    expect(JSON.stringify(payload)).not.toContain('token-abc');
  });

  it('providerRequestId invalido nunca e registrado no log', async () => {
    const { service } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue({
          kind: 'provider_rejected',
          diagnostics: { httpStatus: 200, providerErrorCode: 'error_shop' },
        }),
      },
    });

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toThrow();

    const [, payload] = errorSpy.mock.calls[0] as [string, unknown];
    expect(payload).not.toHaveProperty('providerRequestId');
  });

  it('tokens, sign, order_sn e dados do pedido nunca aparecem no log', async () => {
    const { service } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue(listSuccess(['SECRET_SN'])),
        getOrderDetail: jest.fn().mockResolvedValue({
          kind: 'provider_rejected',
          diagnostics: { httpStatus: 200, providerErrorCode: 'error_shop' },
        }),
      },
    });

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toThrow();

    const [, payload] = errorSpy.mock.calls[0] as [string, unknown];
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('SECRET_SN');
    expect(serialized).not.toContain('token-abc');
    expect(serialized).not.toContain('555444333');
  });

  it('DATA_UNAVAILABLE publico permanece inalterado (thrown code)', async () => {
    const { service } = buildService({
      client: {
        getOrderList: jest.fn().mockResolvedValue({
          kind: 'invalid_response',
          diagnostics: { httpStatus: 200 },
        }),
      },
    });

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toMatchObject({
      code: 'DATA_UNAVAILABLE',
    });
  });

  it('NOT_CONNECTED (sem stage): nunca loga SHOPEE_ORDER_SYNC_FAILED', async () => {
    const { service } = buildService({
      marketplaceAccountsService: {
        findByIdOrFail: jest
          .fn()
          .mockResolvedValue(
            connectedAccount({ status: MarketplaceAccountStatus.DISCONNECTED }),
          ),
      },
    });

    await expect(service.syncOrders(ACCOUNT_ID)).rejects.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('sucesso: nunca loga SHOPEE_ORDER_SYNC_FAILED', async () => {
    const { service } = buildService();
    await service.syncOrders(ACCOUNT_ID);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
