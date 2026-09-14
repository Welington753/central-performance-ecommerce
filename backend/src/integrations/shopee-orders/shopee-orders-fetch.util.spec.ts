import {
  fetchShopeeOrderDetails,
  fetchShopeeOrderSns,
  MAX_PAGES_PER_BLOCK,
  MAX_TOTAL_ORDERS_PER_SYNC,
  ORDER_DETAIL_BATCH_SIZE,
} from './shopee-orders-fetch.util';
import { ShopeeOrdersSyncError } from './shopee-orders-sync-error';
import type { ShopeeSyncBlock } from './shopee-orders-sync-window.util';

/** Acesso tipado a um argumento de chamada de um `jest.fn()` não genérico — evita `no-unsafe-member-access`. */
function callArg<T>(mockFn: jest.Mock, callIndex: number): T {
  const calls = mockFn.mock.calls as unknown[][];
  return calls[callIndex][0] as T;
}

const CREDENTIALS = { accessToken: 'token-abc', shopId: '555444333' };
const BLOCK: ShopeeSyncBlock = {
  timeFrom: 1_700_000_000,
  timeTo: 1_700_003_600,
};

function listSuccess(
  orderSns: string[],
  overrides: { more?: boolean; nextCursor?: string | null } = {},
) {
  return {
    kind: 'success' as const,
    result: {
      orders: orderSns.map((orderSn) => ({ orderSn })),
      more: overrides.more ?? false,
      nextCursor: overrides.nextCursor ?? null,
      requestId: 'req-1',
    },
  };
}

function detailSuccess(orderSns: string[]) {
  return {
    kind: 'success' as const,
    result: {
      orders: orderSns.map((orderSn) => ({ orderSn }) as never),
      requestId: 'req-1',
    },
  };
}

describe('fetchShopeeOrderSns', () => {
  it('página única: devolve os order_sn, capped=false', async () => {
    const getOrderList = jest.fn().mockResolvedValue(listSuccess(['A', 'B']));
    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });

    expect(result).toEqual({
      orderSns: ['A', 'B'],
      pagesFetched: 1,
      capped: false,
    });
    expect(getOrderList).toHaveBeenCalledTimes(1);
    expect(getOrderList).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'token-abc',
        shopId: '555444333',
        timeRangeField: 'update_time',
        timeFrom: BLOCK.timeFrom,
        timeTo: BLOCK.timeTo,
        pageSize: 100,
        cursor: undefined,
      }),
    );
  });

  it('múltiplas páginas: envia o nextCursor na chamada seguinte e para quando more=false', async () => {
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(
        listSuccess(['A'], { more: true, nextCursor: 'cur-1' }),
      )
      .mockResolvedValueOnce(
        listSuccess(['B'], { more: true, nextCursor: 'cur-2' }),
      )
      .mockResolvedValueOnce(listSuccess(['C']));

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });

    expect(result).toEqual({
      orderSns: ['A', 'B', 'C'],
      pagesFetched: 3,
      capped: false,
    });
    expect(callArg(getOrderList, 1)).toMatchObject({ cursor: 'cur-1' });
    expect(callArg(getOrderList, 2)).toMatchObject({ cursor: 'cur-2' });
  });

  it('zero pedidos: devolve lista vazia sem erro', async () => {
    const getOrderList = jest.fn().mockResolvedValue(listSuccess([]));
    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });
    expect(result).toEqual({ orderSns: [], pagesFetched: 1, capped: false });
  });

  it('nenhum bloco: devolve lista vazia sem nenhuma chamada', async () => {
    const getOrderList = jest.fn();
    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [],
    });
    expect(result).toEqual({ orderSns: [], pagesFetched: 0, capped: false });
    expect(getOrderList).not.toHaveBeenCalled();
  });

  it('deduplica order_sn repetido entre páginas do mesmo bloco, preservando a primeira ordem', async () => {
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(
        listSuccess(['A', 'B'], { more: true, nextCursor: 'cur-1' }),
      )
      .mockResolvedValueOnce(listSuccess(['B', 'C']));

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });
    expect(result.orderSns).toEqual(['A', 'B', 'C']);
  });

  it('deduplica order_sn repetido entre blocos diferentes (sobreposição de 1s)', async () => {
    const block2: ShopeeSyncBlock = {
      timeFrom: BLOCK.timeTo - 1,
      timeTo: BLOCK.timeTo + 1000,
    };
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(listSuccess(['A', 'B']))
      .mockResolvedValueOnce(listSuccess(['B', 'C']));

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK, block2],
    });
    expect(result.orderSns).toEqual(['A', 'B', 'C']);
  });

  it('cursor repetido: para com capped=true, nunca reenvia a mesma chamada em loop', async () => {
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(
        listSuccess(['A'], { more: true, nextCursor: 'cur-1' }),
      )
      .mockResolvedValueOnce(
        listSuccess(['B'], { more: true, nextCursor: 'cur-1' }),
      );

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });
    expect(result.capped).toBe(true);
    expect(getOrderList).toHaveBeenCalledTimes(2);
  });

  it('cursor vazio com more=true (resposta hipoteticamente inconsistente): para com capped=true, nunca lança nem loopa', async () => {
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(
        listSuccess(['A'], { more: true, nextCursor: '' as unknown as string }),
      );

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });
    expect(result.capped).toBe(true);
    expect(getOrderList).toHaveBeenCalledTimes(1);
  });

  it('teto de páginas por bloco: para com capped=true ao atingir MAX_PAGES_PER_BLOCK', async () => {
    const getOrderList = jest
      .fn()
      .mockImplementation((req: { cursor?: string }) => {
        const page = req.cursor ? Number(req.cursor) : 0;
        return Promise.resolve(
          listSuccess([`order-${page}`], {
            more: true,
            nextCursor: String(page + 1),
          }),
        );
      });

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });
    expect(result.capped).toBe(true);
    expect(getOrderList).toHaveBeenCalledTimes(MAX_PAGES_PER_BLOCK);
  });

  it('teto total de pedidos: para com capped=true ao atingir MAX_TOTAL_ORDERS_PER_SYNC, nunca ultrapassa', async () => {
    const getOrderList = jest
      .fn()
      .mockImplementation((req: { cursor?: string }) => {
        const page = req.cursor ? Number(req.cursor) : 0;
        const orders = Array.from(
          { length: 100 },
          (_, i) => `order-${page}-${i}`,
        );
        return Promise.resolve(
          listSuccess(orders, { more: true, nextCursor: String(page + 1) }),
        );
      });

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });
    expect(result.capped).toBe(true);
    expect(result.orderSns.length).toBeLessThanOrEqual(
      MAX_TOTAL_ORDERS_PER_SYNC,
    );
    expect(new Set(result.orderSns).size).toBe(result.orderSns.length);
  });

  it.each([
    ['configuration_error', 'NOT_CONFIGURED'],
    ['invalid_request', 'NOT_CONFIGURED'],
    ['provider_rejected', 'DATA_UNAVAILABLE'],
    ['invalid_response', 'DATA_UNAVAILABLE'],
    ['rate_limited', 'TEMPORARILY_UNAVAILABLE'],
    ['temporary_failure', 'TEMPORARILY_UNAVAILABLE'],
    ['unknown_result', 'TEMPORARILY_UNAVAILABLE'],
  ] as const)(
    'outcome "%s" de getOrderList vira ShopeeOrdersSyncError("%s")',
    async (kind, expectedCode) => {
      const getOrderList = jest.fn().mockResolvedValue({ kind });
      await expect(
        fetchShopeeOrderSns({
          client: { getOrderList },
          credentials: CREDENTIALS,
          blocks: [BLOCK],
        }),
      ).rejects.toMatchObject(new ShopeeOrdersSyncError(expectedCode));
    },
  );
});

describe('fetchShopeeOrderDetails', () => {
  it('lote único (<=50): uma chamada, devolve os pedidos', async () => {
    const getOrderDetail = jest
      .fn()
      .mockResolvedValue(detailSuccess(['A', 'B']));
    const result = await fetchShopeeOrderDetails({
      client: { getOrderDetail },
      credentials: CREDENTIALS,
      orderSns: ['A', 'B'],
    });
    expect(getOrderDetail).toHaveBeenCalledTimes(1);
    expect(
      result.map((o) => (o as unknown as { orderSn: string }).orderSn),
    ).toEqual(['A', 'B']);
  });

  it('exatamente 50 order_sn: uma única chamada (limite do lote)', async () => {
    const orderSns = Array.from({ length: 50 }, (_, i) => `order-${i}`);
    const getOrderDetail = jest
      .fn()
      .mockImplementation((req: { orderSnList: string[] }) =>
        Promise.resolve(detailSuccess(req.orderSnList)),
      );
    const result = await fetchShopeeOrderDetails({
      client: { getOrderDetail },
      credentials: CREDENTIALS,
      orderSns,
    });
    expect(getOrderDetail).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(50);
  });

  it('51 order_sn: duas chamadas (50 + 1)', async () => {
    const orderSns = Array.from({ length: 51 }, (_, i) => `order-${i}`);
    const getOrderDetail = jest
      .fn()
      .mockImplementation((req: { orderSnList: string[] }) =>
        Promise.resolve(detailSuccess(req.orderSnList)),
      );
    const result = await fetchShopeeOrderDetails({
      client: { getOrderDetail },
      credentials: CREDENTIALS,
      orderSns,
    });
    expect(getOrderDetail).toHaveBeenCalledTimes(2);
    expect(
      callArg<{ orderSnList: string[] }>(getOrderDetail, 0).orderSnList,
    ).toHaveLength(50);
    expect(
      callArg<{ orderSnList: string[] }>(getOrderDetail, 1).orderSnList,
    ).toHaveLength(1);
    expect(result).toHaveLength(51);
  });

  it('múltiplos lotes: divide em blocos de até 50, preservando todos os pedidos', async () => {
    const orderSns = Array.from({ length: 120 }, (_, i) => `order-${i}`);
    const getOrderDetail = jest
      .fn()
      .mockImplementation((req: { orderSnList: string[] }) =>
        Promise.resolve(detailSuccess(req.orderSnList)),
      );

    const result = await fetchShopeeOrderDetails({
      client: { getOrderDetail },
      credentials: CREDENTIALS,
      orderSns,
    });

    expect(getOrderDetail).toHaveBeenCalledTimes(3);
    expect(
      callArg<{ orderSnList: string[] }>(getOrderDetail, 0).orderSnList,
    ).toHaveLength(ORDER_DETAIL_BATCH_SIZE);
    expect(
      callArg<{ orderSnList: string[] }>(getOrderDetail, 2).orderSnList,
    ).toHaveLength(20);
    expect(result).toHaveLength(120);
  });

  it('lista vazia: nenhuma chamada, devolve lista vazia', async () => {
    const getOrderDetail = jest.fn();
    const result = await fetchShopeeOrderDetails({
      client: { getOrderDetail },
      credentials: CREDENTIALS,
      orderSns: [],
    });
    expect(getOrderDetail).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it.each([
    ['configuration_error', 'NOT_CONFIGURED'],
    ['provider_rejected', 'DATA_UNAVAILABLE'],
    ['invalid_response', 'DATA_UNAVAILABLE'],
    ['rate_limited', 'TEMPORARILY_UNAVAILABLE'],
    ['temporary_failure', 'TEMPORARILY_UNAVAILABLE'],
    ['unknown_result', 'TEMPORARILY_UNAVAILABLE'],
  ] as const)(
    'outcome "%s" de getOrderDetail vira ShopeeOrdersSyncError("%s")',
    async (kind, expectedCode) => {
      const getOrderDetail = jest.fn().mockResolvedValue({ kind });
      await expect(
        fetchShopeeOrderDetails({
          client: { getOrderDetail },
          credentials: CREDENTIALS,
          orderSns: ['A'],
        }),
      ).rejects.toMatchObject(new ShopeeOrdersSyncError(expectedCode));
    },
  );
});
