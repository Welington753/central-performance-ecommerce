import {
  fetchShopeeOrderDetails,
  fetchShopeeOrderSns,
  ORDER_DETAIL_BATCH_SIZE,
} from './shopee-orders-fetch.util';
import { ShopeeOrdersSyncError } from './shopee-orders-sync-error';
import type { ShopeeSyncBlock } from './shopee-orders-sync-window.util';

/**
 * Propagação de diagnóstico sanitizado (stage/blockIndex/batchIndex/outcome)
 * de `ShopeeOrdersApiClient` até `ShopeeOrdersSyncError` — split próprio do
 * spec de comportamento de paginação já existente
 * (`shopee-orders-fetch.util.spec.ts`).
 */
const CREDENTIALS = { accessToken: 'token-abc', shopId: '555444333' };
const BLOCKS: ShopeeSyncBlock[] = [
  { timeFrom: 1_700_000_000, timeTo: 1_700_003_600 },
  { timeFrom: 1_700_003_599, timeTo: 1_700_007_200 },
];

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

describe('fetchShopeeOrderSns - diagnostico', () => {
  it('provider_rejected no bloco 0: stage ORDER_LIST, blockIndex 0, outcomeKind e providerErrorCode propagados', async () => {
    const getOrderList = jest.fn().mockResolvedValue({
      kind: 'provider_rejected',
      diagnostics: { httpStatus: 200, providerErrorCode: 'error_shop' },
    });

    await expect(
      fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: BLOCKS,
      }),
    ).rejects.toMatchObject(
      new ShopeeOrdersSyncError('DATA_UNAVAILABLE', {
        stage: 'ORDER_LIST',
        outcomeKind: 'provider_rejected',
        providerErrorCode: 'error_shop',
        httpStatus: 200,
        blockIndex: 0,
      }),
    );
  });

  it('provider_rejected no segundo bloco (primeiro concluiu com sucesso): blockIndex 1', async () => {
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(listSuccess(['A']))
      .mockResolvedValueOnce({
        kind: 'provider_rejected',
        diagnostics: { httpStatus: 200, providerErrorCode: 'error_shop' },
      });

    await expect(
      fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: BLOCKS,
      }),
    ).rejects.toMatchObject(
      new ShopeeOrdersSyncError('DATA_UNAVAILABLE', {
        stage: 'ORDER_LIST',
        outcomeKind: 'provider_rejected',
        blockIndex: 1,
      }),
    );
  });

  it('invalid_response: outcomeKind e httpStatus propagados, sem providerErrorCode', async () => {
    const getOrderList = jest.fn().mockResolvedValue({
      kind: 'invalid_response',
      diagnostics: { httpStatus: 200 },
    });

    try {
      await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCKS[0]],
      });
      throw new Error('deveria ter lancado');
    } catch (error) {
      expect(error).toBeInstanceOf(ShopeeOrdersSyncError);
      const syncError = error as ShopeeOrdersSyncError;
      expect(syncError.diagnostics?.stage).toBe('ORDER_LIST');
      expect(syncError.diagnostics?.outcomeKind).toBe('invalid_response');
      expect(syncError.diagnostics?.httpStatus).toBe(200);
      expect(syncError.diagnostics?.providerErrorCode).toBeUndefined();
    }
  });

  it('unknown_result: diagnostics presente só com stage/outcomeKind/blockIndex, nunca httpStatus', async () => {
    const getOrderList = jest
      .fn()
      .mockResolvedValue({ kind: 'unknown_result' });

    try {
      await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCKS[0]],
      });
      throw new Error('deveria ter lancado');
    } catch (error) {
      const syncError = error as ShopeeOrdersSyncError;
      expect(syncError.diagnostics?.stage).toBe('ORDER_LIST');
      expect(syncError.diagnostics?.outcomeKind).toBe('unknown_result');
      expect(syncError.diagnostics?.httpStatus).toBeUndefined();
      expect(syncError.diagnostics?.blockIndex).toBe(0);
    }
  });
});

describe('fetchShopeeOrderDetails - diagnostico', () => {
  it('provider_rejected no primeiro lote: stage ORDER_DETAIL, batchIndex 0', async () => {
    const getOrderDetail = jest.fn().mockResolvedValue({
      kind: 'provider_rejected',
      diagnostics: {
        httpStatus: 200,
        providerErrorCode: 'error_order_not_umi',
      },
    });

    await expect(
      fetchShopeeOrderDetails({
        client: { getOrderDetail },
        credentials: CREDENTIALS,
        orderSns: ['A'],
      }),
    ).rejects.toMatchObject(
      new ShopeeOrdersSyncError('DATA_UNAVAILABLE', {
        stage: 'ORDER_DETAIL',
        outcomeKind: 'provider_rejected',
        providerErrorCode: 'error_order_not_umi',
        httpStatus: 200,
        batchIndex: 0,
      }),
    );
  });

  it('provider_rejected no segundo lote (primeiro concluiu com sucesso): batchIndex 1', async () => {
    const orderSns = Array.from(
      { length: ORDER_DETAIL_BATCH_SIZE + 1 },
      (_, i) => `ORDER_${i}`,
    );
    const getOrderDetail = jest
      .fn()
      .mockResolvedValueOnce({
        kind: 'success',
        result: {
          orders: orderSns
            .slice(0, ORDER_DETAIL_BATCH_SIZE)
            .map((orderSn) => ({ orderSn }) as never),
          requestId: 'req-1',
        },
      })
      .mockResolvedValueOnce({
        kind: 'provider_rejected',
        diagnostics: { httpStatus: 200, providerErrorCode: 'error_shop' },
      });

    await expect(
      fetchShopeeOrderDetails({
        client: { getOrderDetail },
        credentials: CREDENTIALS,
        orderSns,
      }),
    ).rejects.toMatchObject(
      new ShopeeOrdersSyncError('DATA_UNAVAILABLE', {
        stage: 'ORDER_DETAIL',
        batchIndex: 1,
      }),
    );
  });

  it('nunca inclui order_sn no diagnostico propagado', async () => {
    const getOrderDetail = jest.fn().mockResolvedValue({
      kind: 'invalid_response',
      diagnostics: { httpStatus: 200 },
    });

    try {
      await fetchShopeeOrderDetails({
        client: { getOrderDetail },
        credentials: CREDENTIALS,
        orderSns: ['SECRET_ORDER_SN'],
      });
      throw new Error('deveria ter lancado');
    } catch (error) {
      expect(
        JSON.stringify((error as ShopeeOrdersSyncError).diagnostics),
      ).not.toContain('SECRET_ORDER_SN');
    }
  });
});
