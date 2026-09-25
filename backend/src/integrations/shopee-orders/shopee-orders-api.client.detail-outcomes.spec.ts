import { ShopeeOrdersApiClient } from './shopee-orders-api.client';
import {
  ACCESS_TOKEN,
  fixedClock,
  jsonResponse,
  makeCredentialsService,
  SHOP_ID,
  textResponse,
  VALID_ORDER_SN_LIST,
  validOrderDetailBody,
  validOrderDetailItem,
  validOrderDetailOrder,
} from './shopee-orders-api.client.test-helpers';

/**
 * Split por responsabilidade (mesmo padrão de `getOrderList`) - mapeamento
 * de outcomes de `getOrderDetail` (Checkpoint CP2K-2): sucesso, integridade
 * do lote, rejeição do provedor, status HTTP, rede/parsing e a garantia de
 * nunca retentar.
 */
describe('ShopeeOrdersApiClient.getOrderDetail - sucesso', () => {
  it('returns success with sanitized order and item fields', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderDetailBody()));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toEqual({
      kind: 'success',
      result: {
        orders: [
          {
            orderSn: '2404098R48U37H',
            region: 'VN',
            currency: 'VND',
            orderStatus: 'COMPLETED',
            totalAmount: 1004.0,
            createTime: 1712601591,
            updateTime: 1713139948,
            fulfillmentFlag: 'fulfilled_by_local_seller',
            buyer: null,
            items: [
              {
                itemId: '2600144043',
                itemName: 'backpack',
                itemSku: 'sku',
                modelId: '221404189791',
                modelName: '60g',
                modelSku: 'QAZ-SADOER-05',
                quantity: 1,
                originalPrice: 300000,
                discountedPrice: 48000,
              },
            ],
          },
        ],
        requestId: 'req-abc123',
      },
    });
  });

  it('returns success with totalAmount null when absent (never a fallback)', async () => {
    const order = validOrderDetailOrder();
    delete (order as Record<string, unknown>).total_amount;
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [order] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.result.orders[0].totalAmount).toBeNull();
    }
  });

  it('normalizes an empty item_sku/model_sku to null', async () => {
    const order = validOrderDetailOrder({
      item_list: [validOrderDetailItem({ item_sku: '', model_sku: '' })],
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [order] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.result.orders[0].items[0].itemSku).toBeNull();
      expect(outcome.result.orders[0].items[0].modelSku).toBeNull();
    }
  });

  it('accepts a large but still safe item_id/model_id, as strings', async () => {
    const order = validOrderDetailOrder({
      item_list: [
        validOrderDetailItem({
          item_id: 9007199254740991,
          model_id: 9007199254740991,
        }),
      ],
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [order] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.result.orders[0].items[0].itemId).toBe('9007199254740991');
      expect(outcome.result.orders[0].items[0].modelId).toBe(
        '9007199254740991',
      );
    }
  });

  it('keeps only allowlisted buyer fields — never CPF, messages or raw keys — in the outcome', async () => {
    const order = validOrderDetailOrder({
      buyer_user_id: 1170319091,
      buyer_username: 'xt4fdsf96j',
      buyer_cpf_id: '123.456.789-00',
      recipient_address: { name: 'Max', phone: '3828203' },
      message_to_seller: 'please gift wrap',
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [order] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome.kind).toBe('success');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain('buyer_user_id');
    expect(serialized).not.toContain('buyer_cpf_id');
    expect(serialized).not.toContain('123.456.789-00');
    expect(serialized).not.toContain('please gift wrap');
    expect(serialized).toContain('"buyerUserId":"1170319091"');
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - status desconhecido e integridade do lote', () => {
  it('returns invalid_response for an undocumented order_status', async () => {
    const order = validOrderDetailOrder({ order_status: 'SOME_FUTURE_STATUS' });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [order] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    // `providerOrderStatusCode` (diagnóstico sanitizado) é o ÚNICO campo
    // autorizado a repetir um `order_status` uppercase válido — nunca
    // order_sn/item/preço/corpo bruto.
    expect(outcome).toMatchObject({
      kind: 'invalid_response',
      diagnostics: {
        validationIssueCode: 'ORDER_STATUS_INVALID',
        providerOrderStatusCode: 'SOME_FUTURE_STATUS',
      },
    });
  });

  it('returns invalid_response for a response containing an orderSn that was not requested', async () => {
    const order = validOrderDetailOrder({ order_sn: 'NOT-REQUESTED' });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [order] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toMatchObject({ kind: 'invalid_response' });
  });

  it('returns invalid_response when a requested orderSn is missing from the response (no partial success)', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toMatchObject({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a duplicated orderSn in the response', async () => {
    const orderA = validOrderDetailOrder({ order_sn: 'AAA' });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(200, validOrderDetailBody({ orders: [orderA, orderA] })),
      );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: ['AAA', 'BBB'],
    });
    expect(outcome).toMatchObject({ kind: 'invalid_response' });
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - rejeicao do provedor e status HTTP', () => {
  it('returns provider_rejected for error_not_found', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        error: 'error_not_found',
        message: 'Wrong parameters, detail: the order is not found.',
      }),
    );
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        orderSnList: VALID_ORDER_SN_LIST,
      }),
    ).toMatchObject({ kind: 'provider_rejected' });
  });

  it('returns rate_limited with a valid Retry-After parsed to milliseconds on 429', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '30' }));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        orderSnList: VALID_ORDER_SN_LIST,
      }),
    ).toMatchObject({ kind: 'rate_limited', retryAfterMs: 30000 });
  });

  it.each([500, 503])(
    'returns temporary_failure on HTTP %s',
    async (status) => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(status, {}));
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );

      expect(
        await client.getOrderDetail({
          accessToken: ACCESS_TOKEN,
          shopId: SHOP_ID,
          orderSnList: VALID_ORDER_SN_LIST,
        }),
      ).toMatchObject({ kind: 'temporary_failure' });
    },
  );
});

describe('ShopeeOrdersApiClient.getOrderDetail - rede, timeout, JSON e resposta grande', () => {
  it('returns unknown_result for a generic fetch rejection', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        orderSnList: VALID_ORDER_SN_LIST,
      }),
    ).toMatchObject({ kind: 'unknown_result' });
  });

  it('returns invalid_response for a non-JSON body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(200, 'not-json{{'));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        orderSnList: VALID_ORDER_SN_LIST,
      }),
    ).toMatchObject({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a genuinely empty response body', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(textResponse(200, ''));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    expect(
      await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        orderSnList: VALID_ORDER_SN_LIST,
      }),
    ).toMatchObject({ kind: 'invalid_response' });
  });

  it('returns invalid_response for a response body above the size limit, without parsing it', async () => {
    const orderSnList = Array.from(
      { length: 50 },
      (_, i) => `20121800${String(i).padStart(6, '0')}`,
    );
    const orders = orderSnList.map((order_sn) =>
      validOrderDetailOrder({
        order_sn,
        item_list: Array.from({ length: 80 }, () => validOrderDetailItem()),
      }),
    );
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(200, validOrderDetailBody({ orders })));
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList,
    });

    expect(outcome).toMatchObject({ kind: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects upfront via a declared oversized Content-Length header, without reading the body', async () => {
    const textSpy = jest.fn().mockResolvedValue('{}');
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name === 'content-length' ? '99999999' : null),
      },
      text: textSpy,
    });
    const client = new ShopeeOrdersApiClient(
      makeCredentialsService(),
      fetchImpl,
      fixedClock,
    );

    const outcome = await client.getOrderDetail({
      accessToken: ACCESS_TOKEN,
      shopId: SHOP_ID,
      orderSnList: VALID_ORDER_SN_LIST,
    });

    expect(outcome).toMatchObject({ kind: 'invalid_response' });
    expect(textSpy).not.toHaveBeenCalled();
  });
});

describe('ShopeeOrdersApiClient.getOrderDetail - nunca retenta automaticamente', () => {
  it('never retries after any failure outcome - exactly one fetch call', async () => {
    const scenarios: Array<() => Response> = [
      () => jsonResponse(429, {}),
      () => jsonResponse(500, {}),
      () => jsonResponse(200, { error: 'error_param', message: '' }),
      () => textResponse(200, 'not-json'),
    ];

    for (const makeResponse of scenarios) {
      const fetchImpl = jest.fn().mockResolvedValue(makeResponse());
      const client = new ShopeeOrdersApiClient(
        makeCredentialsService(),
        fetchImpl,
        fixedClock,
      );
      await client.getOrderDetail({
        accessToken: ACCESS_TOKEN,
        shopId: SHOP_ID,
        orderSnList: VALID_ORDER_SN_LIST,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});
