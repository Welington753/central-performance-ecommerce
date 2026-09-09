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
      items: [
        {
          itemId: 'MLB111',
          variationId: null,
          sellerSku: 'SKU-1',
          title: 'Produto de teste',
          quantity: 2,
          unitPrice: '99.95',
          currencyId: 'BRL',
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
});
