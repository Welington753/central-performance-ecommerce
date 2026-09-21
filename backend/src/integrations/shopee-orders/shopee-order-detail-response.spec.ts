import { validateShopeeOrderDetailResponseBody } from './shopee-order-detail-response';

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    item_id: 2600144043,
    item_name: 'backpack',
    item_sku: 'sku',
    model_id: 221404189791,
    model_name: '60g',
    model_sku: 'QAZ-SADOER-05',
    model_quantity_purchased: 1,
    model_original_price: 300000,
    model_discounted_price: 48000,
    ...overrides,
  };
}

function validOrder(overrides: Record<string, unknown> = {}) {
  return {
    order_sn: '2404098R48U37H',
    region: 'VN',
    currency: 'VND',
    order_status: 'COMPLETED',
    total_amount: 1004.0,
    create_time: 1712601591,
    update_time: 1713139948,
    fulfillment_flag: 'fulfilled_by_local_seller',
    item_list: [validItem()],
    ...overrides,
  };
}

function baseBody(
  overrides: {
    orders?: Record<string, unknown>[];
    error?: unknown;
    message?: unknown;
    request_id?: unknown;
  } = {},
) {
  return {
    error: overrides.error ?? '',
    message: overrides.message ?? '',
    request_id: overrides.request_id ?? 'req-abc123',
    response: {
      order_list: overrides.orders ?? [validOrder()],
    },
  };
}

const REQUESTED = ['2404098R48U37H'];

describe('validateShopeeOrderDetailResponseBody - sucesso completo', () => {
  it('accepts a fully valid single order with one item', () => {
    const result = validateShopeeOrderDetailResponseBody(baseBody(), REQUESTED);
    expect(result).toEqual({
      valid: true,
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

  it.each([
    'UNPAID',
    'READY_TO_SHIP',
    'PROCESSED',
    'SHIPPED',
    'COMPLETED',
    'IN_CANCEL',
    'CANCELLED',
    'INVOICE_PENDING',
  ] as const)('accepts documented order_status %s', (order_status) => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ order_status })] }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].orderStatus).toBe(order_status);
    }
  });

  it('rejects an undocumented/unknown order_status, never exposing raw order/item data', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [validOrder({ order_status: 'SOME_FUTURE_STATUS' })],
      }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
    // `providerOrderStatusCode` sanitizado (Checkpoint de diagnóstico) é o
    // ÚNICO campo autorizado a repetir o valor bruto do status — nunca o
    // order_sn, item, preço ou qualquer outro dado do pedido.
    expect(result).toMatchObject({
      issue: {
        code: 'ORDER_STATUS_INVALID',
        providerOrderStatusCode: 'SOME_FUTURE_STATUS',
      },
    });
  });
});

describe('validateShopeeOrderDetailResponseBody - totalAmount ausente/invalido', () => {
  it('normalizes an absent total_amount to null, never inventing a fallback', () => {
    const order = validOrder();
    delete (order as Record<string, unknown>).total_amount;
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [order] }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].totalAmount).toBeNull();
    }
  });

  it.each([-1, NaN, Infinity, -Infinity, '1004.0'])(
    'rejects an invalid total_amount when present: %p',
    (total_amount) => {
      const result = validateShopeeOrderDetailResponseBody(
        baseBody({ orders: [validOrder({ total_amount })] }),
        REQUESTED,
      );
      expect(result).toMatchObject({ valid: false });
    },
  );

  it('accepts a total_amount of exactly zero', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ total_amount: 0 })] }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].totalAmount).toBe(0);
    }
  });
});

describe('validateShopeeOrderDetailResponseBody - updateTime ausente/invalido', () => {
  it('normalizes an absent update_time to null', () => {
    const order = validOrder();
    delete (order as Record<string, unknown>).update_time;
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [order] }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].updateTime).toBeNull();
    }
  });

  it('rejects an update_time of the wrong type when present', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ update_time: 'not-a-number' })] }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });
});

describe('validateShopeeOrderDetailResponseBody - createTime obrigatorio', () => {
  it('rejects a missing create_time', () => {
    const order = validOrder();
    delete (order as Record<string, unknown>).create_time;
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [order] }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it.each([0, -1, 1.5, NaN])(
    'rejects an invalid create_time: %p',
    (create_time) => {
      const result = validateShopeeOrderDetailResponseBody(
        baseBody({ orders: [validOrder({ create_time })] }),
        REQUESTED,
      );
      expect(result).toMatchObject({ valid: false });
    },
  );
});

describe('validateShopeeOrderDetailResponseBody - fulfillmentFlag', () => {
  it('normalizes an absent fulfillment_flag to null', () => {
    const order = validOrder();
    delete (order as Record<string, unknown>).fulfillment_flag;
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [order] }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].fulfillmentFlag).toBeNull();
    }
  });

  it('rejects a fulfillment_flag of the wrong type when present', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ fulfillment_flag: 123 })] }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });
});

describe('validateShopeeOrderDetailResponseBody - region/currency', () => {
  it('rejects a currency of the wrong length', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ currency: 'VNDX' })] }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('rejects a missing region', () => {
    const order = validOrder();
    delete (order as Record<string, unknown>).region;
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [order] }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });
});

describe('validateShopeeOrderDetailResponseBody - item_list estrutural', () => {
  it('rejects item_list that is not an array', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ item_list: {} })] }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('accepts an empty item_list', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ item_list: [] })] }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].items).toEqual([]);
    }
  });

  it('normalizes an empty item_sku/model_sku to null', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [
          validOrder({
            item_list: [validItem({ item_sku: '', model_sku: '' })],
          }),
        ],
      }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].items[0].itemSku).toBeNull();
      expect(result.result.orders[0].items[0].modelSku).toBeNull();
    }
  });

  it('normalizes an empty model_name to null', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [validOrder({ item_list: [validItem({ model_name: '' })] })],
      }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].items[0].modelName).toBeNull();
    }
  });

  it('rejects a missing/empty item_name (never nulled, always required)', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [validOrder({ item_list: [validItem({ item_name: '' })] })],
      }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('accepts model_id 0 (documented sentinel for "no variation"), never nulling it', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [validOrder({ item_list: [validItem({ model_id: 0 })] })],
      }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].items[0].modelId).toBe('0');
    }
  });

  it('rejects a negative model_id', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [validOrder({ item_list: [validItem({ model_id: -1 })] })],
      }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('rejects item_id 0 (item_id must be strictly positive, unlike model_id)', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [validOrder({ item_list: [validItem({ item_id: 0 })] })],
      }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it.each([0, -1, 1.5, NaN])(
    'rejects an invalid model_quantity_purchased: %p',
    (model_quantity_purchased) => {
      const result = validateShopeeOrderDetailResponseBody(
        baseBody({
          orders: [
            validOrder({
              item_list: [validItem({ model_quantity_purchased })],
            }),
          ],
        }),
        REQUESTED,
      );
      expect(result).toMatchObject({ valid: false });
    },
  );

  it.each([-1, NaN, Infinity])(
    'rejects an invalid model_original_price: %p',
    (model_original_price) => {
      const result = validateShopeeOrderDetailResponseBody(
        baseBody({
          orders: [
            validOrder({ item_list: [validItem({ model_original_price })] }),
          ],
        }),
        REQUESTED,
      );
      expect(result).toMatchObject({ valid: false });
    },
  );

  it.each([-1, NaN, Infinity])(
    'rejects an invalid model_discounted_price: %p',
    (model_discounted_price) => {
      const result = validateShopeeOrderDetailResponseBody(
        baseBody({
          orders: [
            validOrder({
              item_list: [validItem({ model_discounted_price })],
            }),
          ],
        }),
        REQUESTED,
      );
      expect(result).toMatchObject({ valid: false });
    },
  );
});

describe('validateShopeeOrderDetailResponseBody - request_id', () => {
  it('accepts a colon-delimited request_id (mesmo formato real observado em get_order_list, Checkpoint CP2K-3B-R2)', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ request_id: 'abc123:def456:00112233' }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.requestId).toBe('abc123:def456:00112233');
    }
  });
});

describe('validateShopeeOrderDetailResponseBody - IDs int64 seguros vs. unsafe', () => {
  it('rejects an item_id that already lost int64 precision after JSON.parse', () => {
    const text = JSON.stringify(baseBody()).replace(
      '"item_id":2600144043',
      '"item_id":9007199254740993',
    );
    const result = validateShopeeOrderDetailResponseBody(
      JSON.parse(text) as unknown,
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('rejects a model_id that already lost int64 precision after JSON.parse', () => {
    const text = JSON.stringify(baseBody()).replace(
      '"model_id":221404189791',
      '"model_id":9007199254740993',
    );
    const result = validateShopeeOrderDetailResponseBody(
      JSON.parse(text) as unknown,
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('accepts a large but still safe item_id, converting to string only after validation', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [
          validOrder({ item_list: [validItem({ item_id: 9007199254740991 })] }),
        ],
      }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders[0].items[0].itemId).toBe('9007199254740991');
      expect(typeof result.result.orders[0].items[0].itemId).toBe('string');
    }
  });
});

describe('validateShopeeOrderDetailResponseBody - campos pessoais ignorados', () => {
  it('never leaks buyer/recipient personal fields into the result, even if present in the raw body', () => {
    const order = validOrder({
      buyer_user_id: 1170319091,
      buyer_username: 'xt4fdsf96j',
      buyer_cpf_id: '123.456.789-00',
      recipient_address: { name: 'Max', phone: '3828203' },
      dropshipper: 'someone',
      dropshipper_phone: '099999999',
      message_to_seller: 'please gift wrap',
    });
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [order] }),
      REQUESTED,
    );
    expect(result.valid).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('buyer_user_id');
    expect(serialized).not.toContain('xt4fdsf96j');
    expect(serialized).not.toContain('123.456.789-00');
    expect(serialized).not.toContain('Max');
    expect(serialized).not.toContain('3828203');
    expect(serialized).not.toContain('dropshipper');
    expect(serialized).not.toContain('please gift wrap');
  });
});

describe('validateShopeeOrderDetailResponseBody - integridade do lote', () => {
  it('rejects a response containing an orderSn that was not requested', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [validOrder({ order_sn: 'NOT-REQUESTED-1' })] }),
      REQUESTED,
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('rejects a response missing a requested orderSn (no partial success)', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [] }),
      ['2404098R48U37H', '201214JASXYXY6'],
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('rejects a response with a duplicated orderSn', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [validOrder(), validOrder()],
      }),
      ['2404098R48U37H', '201214JASXYXY6'],
    );
    expect(result).toMatchObject({ valid: false });
  });

  it('accepts a response matching the requested set exactly, in any order', () => {
    const orderA = validOrder({ order_sn: 'AAA' });
    const orderB = validOrder({ order_sn: 'BBB' });
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({ orders: [orderB, orderA] }),
      ['AAA', 'BBB'],
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.result.orders.map((o) => o.orderSn)).toEqual([
        'BBB',
        'AAA',
      ]);
    }
  });

  it('rejects a response with more entries than requested (never accepts more than 50/requested count)', () => {
    const result = validateShopeeOrderDetailResponseBody(
      baseBody({
        orders: [
          validOrder({ order_sn: 'AAA' }),
          validOrder({ order_sn: 'BBB' }),
        ],
      }),
      ['AAA'],
    );
    expect(result).toMatchObject({ valid: false });
  });
});

describe('validateShopeeOrderDetailResponseBody - envelope estruturalmente invalido', () => {
  it('rejects a null body', () => {
    expect(
      validateShopeeOrderDetailResponseBody(null, REQUESTED),
    ).toMatchObject({ valid: false });
  });

  it('rejects a body with a non-empty error', () => {
    expect(
      validateShopeeOrderDetailResponseBody(
        baseBody({ error: 'error_not_found' }),
        REQUESTED,
      ),
    ).toMatchObject({ valid: false });
  });

  it('rejects a body without a response object', () => {
    const body = baseBody() as Record<string, unknown>;
    delete body.response;
    expect(
      validateShopeeOrderDetailResponseBody(body, REQUESTED),
    ).toMatchObject({ valid: false });
  });

  it('rejects order_list that is not an array', () => {
    expect(
      validateShopeeOrderDetailResponseBody(
        {
          error: '',
          message: '',
          request_id: 'req-abc123',
          response: { order_list: {} },
        },
        REQUESTED,
      ),
    ).toMatchObject({ valid: false });
  });

  it('rejects a missing/invalid request_id', () => {
    expect(
      validateShopeeOrderDetailResponseBody(
        baseBody({ request_id: '' }),
        REQUESTED,
      ),
    ).toMatchObject({ valid: false });
  });
});
