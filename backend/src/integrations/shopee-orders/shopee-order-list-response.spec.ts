import { validateShopeeOrderListResponseBody } from './shopee-order-list-response';

function baseBody(
  overrides: {
    response?: Record<string, unknown>;
    error?: unknown;
    message?: unknown;
    request_id?: unknown;
  } = {},
) {
  return {
    error: '',
    message: '',
    request_id: 'req-abc123',
    response: {
      more: false,
      next_cursor: '',
      order_list: [],
      ...overrides.response,
    },
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
    ...(overrides.message !== undefined ? { message: overrides.message } : {}),
    ...(overrides.request_id !== undefined
      ? { request_id: overrides.request_id }
      : {}),
  };
}

describe('validateShopeeOrderListResponseBody - pagina vazia valida', () => {
  it('accepts an empty order_list with more=false, normalizing nextCursor to null', () => {
    const result = validateShopeeOrderListResponseBody(baseBody());
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
  });
});

describe('validateShopeeOrderListResponseBody - uma e varias orders', () => {
  it('accepts a single order', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: [{ order_sn: '201218V2Y6E59M' }] } }),
    );
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [{ orderSn: '201218V2Y6E59M' }],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
  });

  it('accepts multiple orders, preserving order and never deduplicating', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({
        response: {
          order_list: [
            { order_sn: '201218V2Y6E59M' },
            { order_sn: '201218V2W2SG1E' },
            { order_sn: '201218V2Y6E59M' },
          ],
        },
      }),
    );
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [
          { orderSn: '201218V2Y6E59M' },
          { orderSn: '201218V2W2SG1E' },
          { orderSn: '201218V2Y6E59M' },
        ],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
  });

  it('never coerces order_sn to a number, keeping it a string', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: [{ order_sn: '201218000000' }] } }),
    );
    expect(result).toEqual({
      valid: true,
      result: expect.objectContaining({
        orders: [{ orderSn: '201218000000' }],
      }) as unknown,
    });
    if (result.valid) {
      expect(typeof result.result.orders[0].orderSn).toBe('string');
    }
  });
});

describe('validateShopeeOrderListResponseBody - order_sn invalido', () => {
  it('rejects a missing order_sn', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: [{}] } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects an empty order_sn', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: [{ order_sn: '' }] } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects an order_sn of the wrong type', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: [{ order_sn: 123456 }] } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects an order_sn above the local conservative length limit', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: [{ order_sn: 'a'.repeat(65) }] } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects a non-object entry in order_list', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: ['201218V2Y6E59M'] } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects order_list that is not an array', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { order_list: {} } }),
    );
    expect(result).toEqual({ valid: false });
  });
});

describe('validateShopeeOrderListResponseBody - more/next_cursor', () => {
  it('rejects a more field of the wrong type', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { more: 'true' } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects more=true without a valid next_cursor', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { more: true, next_cursor: '' } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects more=true with a next_cursor of the wrong type', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { more: true, next_cursor: 20 } }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('rejects more=true with a next_cursor above the local conservative length limit', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({
        response: { more: true, next_cursor: 'a'.repeat(513) },
      }),
    );
    expect(result).toEqual({ valid: false });
  });

  it('accepts more=true with a valid next_cursor', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { more: true, next_cursor: '20' } }),
    );
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [],
        more: true,
        nextCursor: '20',
        requestId: 'req-abc123',
      },
    });
  });

  it('normalizes an empty next_cursor to null when more=false', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ response: { more: false, next_cursor: '' } }),
    );
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
  });

  it('normalizes an absent next_cursor to null when more=false', () => {
    const body = baseBody();
    delete (body.response as Record<string, unknown>).next_cursor;
    const result = validateShopeeOrderListResponseBody(body);
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
  });
});

describe('validateShopeeOrderListResponseBody - request_id', () => {
  it('rejects a missing request_id', () => {
    const body = baseBody();
    delete (body as Record<string, unknown>).request_id;
    expect(validateShopeeOrderListResponseBody(body)).toEqual({ valid: false });
  });

  it('rejects an empty request_id', () => {
    expect(
      validateShopeeOrderListResponseBody(baseBody({ request_id: '' })),
    ).toEqual({ valid: false });
  });

  it('rejects a request_id of the wrong type', () => {
    expect(
      validateShopeeOrderListResponseBody(baseBody({ request_id: 12345 })),
    ).toEqual({ valid: false });
  });

  it('rejects a request_id above the length limit', () => {
    expect(
      validateShopeeOrderListResponseBody(
        baseBody({ request_id: 'a'.repeat(129) }),
      ),
    ).toEqual({ valid: false });
  });

  it('accepts a colon-delimited request_id (formato real observado no Sandbox, Checkpoint CP2K-3B-R2)', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ request_id: 'abc123:def456:00112233' }),
    );
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [],
        more: false,
        nextCursor: null,
        requestId: 'abc123:def456:00112233',
      },
    });
  });
});

describe('validateShopeeOrderListResponseBody - envelope estruturalmente invalido', () => {
  it('rejects a null body', () => {
    expect(validateShopeeOrderListResponseBody(null)).toEqual({ valid: false });
  });

  it('rejects an array body', () => {
    expect(validateShopeeOrderListResponseBody([])).toEqual({ valid: false });
  });

  it('rejects a primitive body', () => {
    expect(validateShopeeOrderListResponseBody('not-an-object')).toEqual({
      valid: false,
    });
  });

  it('rejects a body with a non-empty error', () => {
    expect(
      validateShopeeOrderListResponseBody(baseBody({ error: 'error_param' })),
    ).toEqual({ valid: false });
  });

  it('rejects a body with error/message of the wrong type', () => {
    expect(
      validateShopeeOrderListResponseBody(baseBody({ error: 123 })),
    ).toEqual({ valid: false });
    expect(
      validateShopeeOrderListResponseBody(baseBody({ message: 123 })),
    ).toEqual({ valid: false });
  });

  it('rejects a body without a response object', () => {
    const body = baseBody() as Record<string, unknown>;
    delete body.response;
    expect(validateShopeeOrderListResponseBody(body)).toEqual({ valid: false });
  });

  it('rejects a response that is not an object', () => {
    expect(
      validateShopeeOrderListResponseBody({
        error: '',
        message: '',
        request_id: 'req-abc123',
        response: [],
      }),
    ).toEqual({ valid: false });
  });
});

describe('validateShopeeOrderListResponseBody - nao expoe campos extras', () => {
  it('never leaks unknown order-level fields (e.g. order_status) into the parsed result', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({
        response: {
          order_list: [
            { order_sn: '201218V2Y6E59M', order_status: 'READY_TO_SHIP' },
          ],
        },
      }),
    );
    expect(result).toEqual({
      valid: true,
      result: {
        orders: [{ orderSn: '201218V2Y6E59M' }],
        more: false,
        nextCursor: null,
        requestId: 'req-abc123',
      },
    });
    if (result.valid) {
      expect(JSON.stringify(result.result)).not.toContain('order_status');
      expect(JSON.stringify(result.result)).not.toContain('READY_TO_SHIP');
    }
  });

  it('never leaks the message field into the parsed result', () => {
    const result = validateShopeeOrderListResponseBody(
      baseBody({ message: 'irrelevant but present message' }),
    );
    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain('irrelevant but present');
  });
});
