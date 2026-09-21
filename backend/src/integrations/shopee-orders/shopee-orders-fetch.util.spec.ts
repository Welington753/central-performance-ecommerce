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
      completedThroughSeconds: null,
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

  it('usa create_time quando explicitamente pedido (Fase 4, backfill histórico)', async () => {
    const getOrderList = jest.fn().mockResolvedValue(listSuccess(['A']));
    await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
      timeRangeField: 'create_time',
    });

    expect(getOrderList).toHaveBeenCalledWith(
      expect.objectContaining({ timeRangeField: 'create_time' }),
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
      completedThroughSeconds: null,
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
    expect(result).toEqual({
      orderSns: [],
      pagesFetched: 1,
      capped: false,
      completedThroughSeconds: null,
    });
  });

  it('nenhum bloco: devolve lista vazia sem nenhuma chamada', async () => {
    const getOrderList = jest.fn();
    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [],
    });
    expect(result).toEqual({
      orderSns: [],
      pagesFetched: 0,
      capped: false,
      completedThroughSeconds: null,
    });
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
    expect(result.completedThroughSeconds).toBeNull();
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
    expect(result.completedThroughSeconds).toBeNull();
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
    expect(result.completedThroughSeconds).toBeNull();
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
    expect(result.completedThroughSeconds).toBeNull();
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

  it('exatamente MAX_TOTAL_ORDERS_PER_SYNC pedidos com more=false: capped=false, enumeração concluída normalmente (CP2K-5B)', async () => {
    const orderSns = Array.from(
      { length: MAX_TOTAL_ORDERS_PER_SYNC },
      (_, i) => `order-${i}`,
    );
    const getOrderList = jest
      .fn()
      .mockResolvedValue(listSuccess(orderSns, { more: false }));

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });

    expect(result.capped).toBe(false);
    expect(result.completedThroughSeconds).toBeNull();
    expect(result.orderSns).toHaveLength(MAX_TOTAL_ORDERS_PER_SYNC);
    expect(getOrderList).toHaveBeenCalledTimes(1);
  });

  it('exatamente MAX_TOTAL_ORDERS_PER_SYNC pedidos com more=true: capped=true, nunca busca a próxima página (CP2K-5B)', async () => {
    const orderSns = Array.from(
      { length: MAX_TOTAL_ORDERS_PER_SYNC },
      (_, i) => `order-${i}`,
    );
    const getOrderList = jest
      .fn()
      .mockResolvedValue(
        listSuccess(orderSns, { more: true, nextCursor: 'cur-next' }),
      );

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });

    expect(result.capped).toBe(true);
    expect(result.completedThroughSeconds).toBeNull();
    expect(result.orderSns).toHaveLength(MAX_TOTAL_ORDERS_PER_SYNC);
    expect(getOrderList).toHaveBeenCalledTimes(1);
  });

  it('última página leva o total a 5050 mas more=false: capped=false, nenhum order_sn truncado (CP2K-5B-R1)', async () => {
    const firstPage = Array.from(
      { length: MAX_TOTAL_ORDERS_PER_SYNC - 50 },
      (_, i) => `p1-${i}`,
    );
    const secondPage = Array.from({ length: 100 }, (_, i) => `p2-${i}`);
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(
        listSuccess(firstPage, { more: true, nextCursor: 'cur-1' }),
      )
      .mockResolvedValueOnce(listSuccess(secondPage, { more: false }));

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });

    expect(result.capped).toBe(false);
    expect(result.completedThroughSeconds).toBeNull();
    expect(result.orderSns.length).toBe(MAX_TOTAL_ORDERS_PER_SYNC - 50 + 100);
    expect(getOrderList).toHaveBeenCalledTimes(2);
  });

  it('página NÃO final leva o total a 5050 com more=true: capped=true, nenhuma chamada seguinte (CP2K-5B-R1)', async () => {
    const firstPage = Array.from(
      { length: MAX_TOTAL_ORDERS_PER_SYNC - 50 },
      (_, i) => `p1-${i}`,
    );
    const secondPage = Array.from({ length: 100 }, (_, i) => `p2-${i}`);
    const getOrderList = jest
      .fn()
      .mockResolvedValueOnce(
        listSuccess(firstPage, { more: true, nextCursor: 'cur-1' }),
      )
      .mockResolvedValueOnce(
        listSuccess(secondPage, { more: true, nextCursor: 'cur-2' }),
      );

    const result = await fetchShopeeOrderSns({
      client: { getOrderList },
      credentials: CREDENTIALS,
      blocks: [BLOCK],
    });

    expect(result.capped).toBe(true);
    expect(result.completedThroughSeconds).toBeNull();
    expect(result.orderSns.length).toBe(MAX_TOTAL_ORDERS_PER_SYNC - 50 + 100);
    expect(getOrderList).toHaveBeenCalledTimes(2);
  });

  describe('completedThroughSeconds (Checkpoint CP2K-5C-2)', () => {
    const BLOCK_1: ShopeeSyncBlock = {
      timeFrom: 1_700_000_000,
      timeTo: 1_700_100_000,
    };
    const BLOCK_2: ShopeeSyncBlock = {
      timeFrom: 1_700_099_999,
      timeTo: 1_700_200_000,
    };
    const BLOCK_3: ShopeeSyncBlock = {
      timeFrom: 1_700_199_999,
      timeTo: 1_700_300_000,
    };
    const BLOCK_4: ShopeeSyncBlock = {
      timeFrom: 1_700_299_999,
      timeTo: 1_700_400_000,
    };
    const BLOCK_5: ShopeeSyncBlock = {
      timeFrom: 1_700_399_999,
      timeTo: 1_700_500_000,
    };

    function fullPage(prefix: string, length: number) {
      return Array.from({ length }, (_, i) => `${prefix}-${i}`);
    }

    it('bloco concluído naturalmente, existe bloco seguinte e total >= MAX: para ANTES do próximo bloco, capped=true, completedThroughSeconds=timeTo do bloco concluído', async () => {
      const getOrderList = jest.fn().mockResolvedValueOnce(
        listSuccess(fullPage('b1', MAX_TOTAL_ORDERS_PER_SYNC), {
          more: false,
        }),
      );

      const result = await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCK_1, BLOCK_2],
      });

      expect(result.capped).toBe(true);
      expect(result.completedThroughSeconds).toBe(BLOCK_1.timeTo);
      expect(result.orderSns).toHaveLength(MAX_TOTAL_ORDERS_PER_SYNC);
      // Nenhuma chamada com timeFrom do bloco 2 — o teto parou ANTES dele.
      expect(getOrderList).toHaveBeenCalledTimes(1);
      expect(getOrderList).not.toHaveBeenCalledWith(
        expect.objectContaining({ timeFrom: BLOCK_2.timeFrom }),
      );
    });

    it('mesmo cenário (total >= MAX), mas o bloco concluído é o ÚLTIMO da janela: capped=false, completedThroughSeconds=null — janela inteira enumerada', async () => {
      const getOrderList = jest.fn().mockResolvedValueOnce(
        listSuccess(fullPage('b1', MAX_TOTAL_ORDERS_PER_SYNC), {
          more: false,
        }),
      );

      const result = await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCK_1],
      });

      expect(result.capped).toBe(false);
      expect(result.completedThroughSeconds).toBeNull();
      expect(result.orderSns).toHaveLength(MAX_TOTAL_ORDERS_PER_SYNC);
      expect(getOrderList).toHaveBeenCalledTimes(1);
    });

    it('cap no bloco 3 de 5 (more=true + teto): completedThroughSeconds é o timeTo do bloco 2 (último concluído)', async () => {
      const getOrderList = jest
        .fn()
        .mockResolvedValueOnce(listSuccess(fullPage('b1', 10), { more: false }))
        .mockResolvedValueOnce(listSuccess(fullPage('b2', 10), { more: false }))
        .mockResolvedValueOnce(
          listSuccess(fullPage('b3', MAX_TOTAL_ORDERS_PER_SYNC - 20), {
            more: true,
            nextCursor: 'cur-b3',
          }),
        );

      const result = await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCK_1, BLOCK_2, BLOCK_3, BLOCK_4, BLOCK_5],
      });

      expect(result.capped).toBe(true);
      expect(result.completedThroughSeconds).toBe(BLOCK_2.timeTo);
      expect(result.orderSns).toHaveLength(MAX_TOTAL_ORDERS_PER_SYNC);
      expect(getOrderList).toHaveBeenCalledTimes(3);
    });

    it('cap no primeiro bloco (more=true + teto): completedThroughSeconds=null — nenhum bloco foi concluído ainda', async () => {
      const getOrderList = jest.fn().mockResolvedValueOnce(
        listSuccess(fullPage('b1', MAX_TOTAL_ORDERS_PER_SYNC), {
          more: true,
          nextCursor: 'cur-b1',
        }),
      );

      const result = await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCK_1, BLOCK_2],
      });

      expect(result.capped).toBe(true);
      expect(result.completedThroughSeconds).toBeNull();
      expect(getOrderList).toHaveBeenCalledTimes(1);
    });

    it('cursor anômalo (cíclico) no bloco 2: capped=true, completedThroughSeconds preserva a fronteira do bloco 1 (já concluído)', async () => {
      const getOrderList = jest
        .fn()
        .mockResolvedValueOnce(listSuccess(fullPage('b1', 5), { more: false }))
        .mockResolvedValueOnce(
          listSuccess(fullPage('b2-p0', 5), {
            more: true,
            nextCursor: 'cur-cycle',
          }),
        )
        .mockResolvedValueOnce(
          listSuccess(fullPage('b2-p1', 5), {
            more: true,
            nextCursor: 'cur-cycle', // repete o cursor já visto — ciclo
          }),
        );

      const result = await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCK_1, BLOCK_2, BLOCK_3],
      });

      expect(result.capped).toBe(true);
      expect(result.completedThroughSeconds).toBe(BLOCK_1.timeTo);
      expect(getOrderList).toHaveBeenCalledTimes(3);
      // Nenhuma chamada chegou a tocar o bloco 3.
      expect(getOrderList).not.toHaveBeenCalledWith(
        expect.objectContaining({ timeFrom: BLOCK_3.timeFrom }),
      );
    });

    it('cursor vazio (anômalo) no bloco 2 com more=true: capped=true, completedThroughSeconds preserva a fronteira do bloco 1', async () => {
      const getOrderList = jest
        .fn()
        .mockResolvedValueOnce(listSuccess(fullPage('b1', 5), { more: false }))
        .mockResolvedValueOnce(
          listSuccess(fullPage('b2', 5), {
            more: true,
            nextCursor: '' as unknown as string,
          }),
        );

      const result = await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCK_1, BLOCK_2],
      });

      expect(result.capped).toBe(true);
      expect(result.completedThroughSeconds).toBe(BLOCK_1.timeTo);
      expect(getOrderList).toHaveBeenCalledTimes(2);
    });

    it('enumeração COMPLETA de múltiplos blocos, sem nunca atingir o teto: capped=false, completedThroughSeconds=null', async () => {
      const getOrderList = jest
        .fn()
        .mockResolvedValueOnce(listSuccess(fullPage('b1', 3), { more: false }))
        .mockResolvedValueOnce(listSuccess(fullPage('b2', 4), { more: false }))
        .mockResolvedValueOnce(listSuccess(fullPage('b3', 2), { more: false }));

      const result = await fetchShopeeOrderSns({
        client: { getOrderList },
        credentials: CREDENTIALS,
        blocks: [BLOCK_1, BLOCK_2, BLOCK_3],
      });

      expect(result.capped).toBe(false);
      expect(result.completedThroughSeconds).toBeNull();
      expect(result.orderSns).toHaveLength(9);
      expect(getOrderList).toHaveBeenCalledTimes(3);
    });
  });
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
