import { validateOrdersSearchResponseBody } from './mercado-livre-order-response';

function validOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 123456789,
    status: 'paid',
    currency_id: 'BRL',
    total_amount: 199.9,
    pack_id: null,
    date_created: '2026-08-15T10:00:00.000-04:00',
    date_closed: '2026-08-15T10:05:00.000-04:00',
    last_updated: '2026-08-15T10:05:00.000-04:00',
    order_items: [
      {
        item: {
          id: 'MLB111',
          title: 'Produto de teste',
          variation_id: null,
          seller_sku: 'SKU-1',
        },
        quantity: 2,
        unit_price: 99.95,
        currency_id: 'BRL',
      },
    ],
    // Campos de comprador — devem ser IGNORADOS pelo validador (allowlist),
    // nunca fazer o corpo ser rejeitado nem "vazar" para o resultado.
    buyer: { id: 999, nickname: 'comprador_x', email: 'x@example.com' },
    ...overrides,
  };
}

function validBody(orders: unknown[] = [validOrder()]) {
  return {
    paging: { total: orders.length, offset: 0, limit: 50 },
    results: orders,
  };
}

describe('validateOrdersSearchResponseBody', () => {
  it('accepts a well-formed page and maps only the expected fields', () => {
    const result = validateOrdersSearchResponseBody(validBody());

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.paging).toEqual({ total: 1, offset: 0, limit: 50 });
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toEqual({
      externalOrderId: '123456789',
      status: 'paid',
      currencyId: 'BRL',
      totalAmount: '199.90',
      packId: null,
      dateCreated: '2026-08-15T10:00:00.000-04:00',
      dateClosed: '2026-08-15T10:05:00.000-04:00',
      lastUpdated: '2026-08-15T10:05:00.000-04:00',
      shippingId: null,
      payments: [],
      items: [
        {
          itemId: 'MLB111',
          variationId: null,
          sellerSku: 'SKU-1',
          title: 'Produto de teste',
          quantity: 2,
          unitPrice: '99.95',
          currencyId: 'BRL',
          saleFee: null,
        },
      ],
    });
    // Nenhum campo de comprador vaza para o objeto validado.
    expect(JSON.stringify(result.orders[0])).not.toContain('comprador_x');
  });

  it.each([
    ['body não é objeto', 'not-an-object'],
    ['body nulo', null],
    ['sem paging', { results: [] }],
    ['paging malformado', { paging: { total: 'x' }, results: [] }],
    ['results ausente', { paging: { total: 0, offset: 0, limit: 50 } }],
    [
      'results não é array',
      { paging: { total: 0, offset: 0, limit: 50 }, results: 'oops' },
    ],
  ])('rejects when %s', (_label, body) => {
    expect(validateOrdersSearchResponseBody(body)).toEqual({ valid: false });
  });

  it('rejects the whole page when a single order has an unknown status', () => {
    const body = validBody([validOrder({ status: 'something_unexpected' })]);
    expect(validateOrdersSearchResponseBody(body)).toEqual({ valid: false });
  });

  it('rejects the whole page when a single order is missing a required field', () => {
    const order = validOrder();
    delete (order as Record<string, unknown>).total_amount;
    expect(validateOrdersSearchResponseBody(validBody([order]))).toEqual({
      valid: false,
    });
  });

  it('rejects the whole page when an item is missing a required field', () => {
    const order = validOrder();
    (order.order_items[0] as Record<string, unknown>).unit_price = undefined;
    expect(validateOrdersSearchResponseBody(validBody([order]))).toEqual({
      valid: false,
    });
  });

  it('accepts an order with no items', () => {
    const order = validOrder({ order_items: [] });
    const result = validateOrdersSearchResponseBody(validBody([order]));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.orders[0].items).toEqual([]);
  });

  it('accepts a numeric external order id and stringifies it', () => {
    const result = validateOrdersSearchResponseBody(
      validBody([validOrder({ id: 42 })]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.orders[0].externalOrderId).toBe('42');
  });

  describe('pack_id (pedido pertencente a um pack)', () => {
    it('extracts a non-null pack_id as-is', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([validOrder({ pack_id: '2000000101334825' })]),
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.orders[0].packId).toBe('2000000101334825');
      }
    });

    it('keeps packId null when pack_id is absent', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([validOrder({ pack_id: null })]),
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].packId).toBeNull();
    });
  });

  describe('order_items com múltiplos itens', () => {
    it('maps every item, preserving quantity and unit_price of each one', () => {
      const order = validOrder({
        order_items: [
          {
            item: {
              id: 'MLB111',
              title: 'Produto A',
              variation_id: null,
              seller_sku: 'SKU-A',
            },
            quantity: 2,
            unit_price: 10,
            currency_id: 'BRL',
          },
          {
            item: {
              id: 'MLB222',
              title: 'Produto B',
              variation_id: null,
              seller_sku: 'SKU-B',
            },
            quantity: 3,
            unit_price: 25.5,
            currency_id: 'BRL',
          },
          {
            item: {
              id: 'MLB333',
              title: 'Produto C',
              variation_id: null,
              seller_sku: 'SKU-C',
            },
            quantity: 1,
            unit_price: 7.25,
            currency_id: 'BRL',
          },
        ],
      });

      const result = validateOrdersSearchResponseBody(validBody([order]));
      expect(result.valid).toBe(true);
      if (!result.valid) return;

      expect(result.orders[0].items).toHaveLength(3);
      expect(result.orders[0].items.map((item) => item.itemId)).toEqual([
        'MLB111',
        'MLB222',
        'MLB333',
      ]);
      expect(result.orders[0].items.map((item) => item.quantity)).toEqual([
        2, 3, 1,
      ]);
      expect(result.orders[0].items.map((item) => item.unitPrice)).toEqual([
        '10.00',
        '25.50',
        '7.25',
      ]);
    });
  });

  describe('shipping.id (Fase 4, "Full")', () => {
    it('extracts shipping.id as shippingId, stringified', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([validOrder({ shipping: { id: 555 } })]),
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].shippingId).toBe('555');
    });

    it('defaults shippingId to null when shipping is absent', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([validOrder()]),
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].shippingId).toBeNull();
    });

    it('defaults shippingId to null when shipping is malformed, without rejecting the order', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([validOrder({ shipping: 'not-an-object' })]),
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].shippingId).toBeNull();
    });
  });

  describe('payments (CP2K-7D, campos financeiros confirmados)', () => {
    function orderWithPayments(payments: unknown[]) {
      return validOrder({ payments });
    }

    it('extracts every financial field of a payment as a money string', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([
          orderWithPayments([
            {
              status: 'approved',
              marketplace_fee: 12.5,
              shipping_cost: 9.9,
              taxes_amount: 1.23,
              coupon_amount: 5,
              transaction_amount_refunded: 0,
            },
          ]),
        ]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments).toEqual([
        {
          status: 'approved',
          marketplaceFee: '12.50',
          shippingCost: '9.90',
          taxesAmount: '1.23',
          couponAmount: '5.00',
          transactionAmountRefunded: '0.00',
        },
      ]);
    });

    it('defaults payments to an empty array when the order has none', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([validOrder()]),
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].payments).toEqual([]);
    });

    it('maps an absent financial field on a payment to null, never rejecting the order', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([orderWithPayments([{ status: 'approved' }])]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments).toEqual([
        {
          status: 'approved',
          marketplaceFee: null,
          shippingCost: null,
          taxesAmount: null,
          couponAmount: null,
          transactionAmountRefunded: null,
        },
      ]);
    });

    it('maps an explicit null financial field on a payment to null, same as absent', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([
          orderWithPayments([{ status: 'approved', taxes_amount: null }]),
        ]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments[0].taxesAmount).toBeNull();
    });

    it('preserves zero as a distinct money string, never null', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([
          orderWithPayments([{ status: 'approved', coupon_amount: 0 }]),
        ]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments[0].couponAmount).toBe('0.00');
    });

    it('maps a wrong-typed financial field to null, never rejecting the order (optional-field policy)', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([
          orderWithPayments([
            { status: 'approved', shipping_cost: 'not-a-number' },
          ]),
        ]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments[0].shippingCost).toBeNull();
    });

    it('keeps every payment when there are multiple', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([
          orderWithPayments([
            { status: 'approved', shipping_cost: 10 },
            { status: 'cancelled', shipping_cost: 20 },
          ]),
        ]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments).toHaveLength(2);
      expect(result.orders[0].payments.map((p) => p.status)).toEqual([
        'approved',
        'cancelled',
      ]);
    });

    it('skips a malformed payment entry silently, without rejecting the order', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([
          orderWithPayments(['not-an-object', { status: 'approved' }]),
        ]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments).toHaveLength(1);
    });

    it('defaults status to "unknown" when a payment entry has no valid status, never treated as approved', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([orderWithPayments([{ shipping_cost: 10 }])]),
      );
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(result.orders[0].payments[0].status).toBe('unknown');
    });
  });

  describe('order_items[].sale_fee', () => {
    it('extracts a present sale_fee as a money string', () => {
      const order = validOrder();
      (order.order_items[0] as Record<string, unknown>).sale_fee = 3.45;
      const result = validateOrdersSearchResponseBody(validBody([order]));
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].items[0].saleFee).toBe('3.45');
    });

    it('defaults saleFee to null when absent', () => {
      const result = validateOrdersSearchResponseBody(
        validBody([validOrder()]),
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].items[0].saleFee).toBeNull();
    });

    it('preserves zero sale_fee as a distinct money string, never null', () => {
      const order = validOrder();
      (order.order_items[0] as Record<string, unknown>).sale_fee = 0;
      const result = validateOrdersSearchResponseBody(validBody([order]));
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].items[0].saleFee).toBe('0.00');
    });

    it('maps a wrong-typed sale_fee to null, never rejecting the order', () => {
      const order = validOrder();
      (order.order_items[0] as Record<string, unknown>).sale_fee =
        'not-a-number';
      const result = validateOrdersSearchResponseBody(validBody([order]));
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.orders[0].items[0].saleFee).toBeNull();
    });
  });
});
