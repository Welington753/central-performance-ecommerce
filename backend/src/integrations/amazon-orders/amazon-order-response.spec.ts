import { validateOrdersSearchResponseBody } from './amazon-order-response';

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    orderItemId: 'item-1',
    quantityOrdered: 2,
    product: {
      asin: 'B000000001',
      sellerSku: 'SKU-1',
      title: 'Produto 1',
      price: { unitPrice: { amount: '99.95', currencyCode: 'BRL' } },
    },
    ...overrides,
  };
}

function validOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'ORDER-1',
    createdTime: '2026-08-01T10:00:00Z',
    lastUpdatedTime: '2026-08-01T10:05:00Z',
    salesChannel: { marketplaceId: 'A2Q3Y263D00KWC' },
    fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'AMAZON' },
    proceeds: { grandTotal: { amount: '199.90', currencyCode: 'BRL' } },
    orderItems: [validItem()],
    ...overrides,
  };
}

function validBody(orders: unknown[] = [validOrder()], nextToken?: string) {
  return {
    orders,
    pagination: nextToken ? { nextToken } : {},
  };
}

describe('validateOrdersSearchResponseBody', () => {
  it('accepts a well-formed page and normalizes every allowlisted field', () => {
    const result = validateOrdersSearchResponseBody(validBody());
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.orders).toHaveLength(1);
    const order = result.orders[0];
    expect(order.orderId).toBe('ORDER-1');
    expect(order.marketplaceId).toBe('A2Q3Y263D00KWC');
    expect(order.fulfillmentStatus).toBe('SHIPPED');
    expect(order.fulfilledBy).toBe('AMAZON');
    expect(order.grandTotal).toEqual({ amount: '199.90', currencyCode: 'BRL' });
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toEqual({
      orderItemId: 'item-1',
      quantityOrdered: 2,
      asin: 'B000000001',
      sellerSku: 'SKU-1',
      title: 'Produto 1',
      unitPrice: { amount: '99.95', currencyCode: 'BRL' },
      itemSubtotal: null,
    });
    expect(result.pagination.nextToken).toBeNull();
  });

  it('parses pagination.nextToken when present', () => {
    const result = validateOrdersSearchResponseBody(
      validBody([validOrder()], 'token-abc'),
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.pagination.nextToken).toBe('token-abc');
  });

  it('accepts an empty orders array (last/empty page)', () => {
    const result = validateOrdersSearchResponseBody(validBody([]));
    expect(result).toEqual({
      valid: true,
      orders: [],
      pagination: { nextToken: null },
    });
  });

  it('never copies an unknown/unlisted field into the parsed order', () => {
    const result = validateOrdersSearchResponseBody(
      validBody([
        validOrder({
          buyerInfo: { name: 'SHOULD_NEVER_LEAK', email: 'buyer@example.com' },
          shippingAddress: { addressLine1: 'SHOULD_NEVER_LEAK' },
        }),
      ]),
    );
    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain('SHOULD_NEVER_LEAK');
    expect(JSON.stringify(result)).not.toContain('buyer@example.com');
  });

  it.each([null, undefined, 'a string', 42, []])(
    'rejects a non-object body (%p)',
    (body) => {
      expect(validateOrdersSearchResponseBody(body)).toEqual({ valid: false });
    },
  );

  it('rejects a body whose orders field is not an array', () => {
    expect(
      validateOrdersSearchResponseBody({ orders: 'not-an-array' }),
    ).toEqual({ valid: false });
  });

  it('rejects the WHOLE page when a single order has a missing orderId', () => {
    const body = validBody();
    const order = body.orders[0] as Record<string, unknown>;
    delete order.orderId;
    expect(validateOrdersSearchResponseBody(body)).toEqual({ valid: false });
  });

  it('rejects the whole page for an invalid createdTime', () => {
    expect(
      validateOrdersSearchResponseBody(
        validBody([validOrder({ createdTime: 'not-a-date' })]),
      ),
    ).toEqual({ valid: false });
  });

  it('rejects the whole page for a missing salesChannel.marketplaceId', () => {
    expect(
      validateOrdersSearchResponseBody(
        validBody([validOrder({ salesChannel: {} })]),
      ),
    ).toEqual({ valid: false });
  });

  it('accepts INVOICE_UNCONFIRMED as a known fulfillmentStatus (official migration guide)', () => {
    const result = validateOrdersSearchResponseBody(
      validBody([
        validOrder({
          fulfillment: {
            fulfillmentStatus: 'INVOICE_UNCONFIRMED',
            fulfilledBy: 'AMAZON',
          },
        }),
      ]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.orders[0].fulfillmentStatus).toBe('INVOICE_UNCONFIRMED');
    }
  });

  it('rejects the whole page for an unknown fulfillmentStatus', () => {
    expect(
      validateOrdersSearchResponseBody(
        validBody([
          validOrder({ fulfillment: { fulfillmentStatus: 'MADE_UP_STATUS' } }),
        ]),
      ),
    ).toEqual({ valid: false });
  });

  it('normalizes an unrecognized fulfilledBy value to null (never rejects the whole order for it)', () => {
    const result = validateOrdersSearchResponseBody(
      validBody([
        validOrder({
          fulfillment: { fulfillmentStatus: 'SHIPPED', fulfilledBy: 'WEIRD' },
        }),
      ]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.orders[0].fulfilledBy).toBeNull();
  });

  it('tolerates a missing/invalid grandTotal at the parser level (null, not a rejection) — the mapper decides quarantine', () => {
    const result = validateOrdersSearchResponseBody(
      validBody([validOrder({ proceeds: {} })]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.orders[0].grandTotal).toBeNull();
  });

  it('rejects the whole page for a non-array orderItems', () => {
    expect(
      validateOrdersSearchResponseBody(
        validBody([validOrder({ orderItems: 'not-an-array' })]),
      ),
    ).toEqual({ valid: false });
  });

  it('rejects the whole page when an item has an invalid quantityOrdered (zero, negative, or non-integer)', () => {
    for (const badQuantity of [0, -1, 1.5, 'two']) {
      const result = validateOrdersSearchResponseBody(
        validBody([
          validOrder({
            orderItems: [validItem({ quantityOrdered: badQuantity })],
          }),
        ]),
      );
      expect(result).toEqual({ valid: false });
    }
  });

  it('rejects the whole page when an item is missing its title', () => {
    const item = validItem();
    (item.product as Record<string, unknown>).title = '';
    expect(
      validateOrdersSearchResponseBody(
        validBody([validOrder({ orderItems: [item] })]),
      ),
    ).toEqual({ valid: false });
  });

  it('tolerates a missing item unitPrice at the parser level (null, not a rejection)', () => {
    const item = validItem({
      product: { asin: 'B1', sellerSku: 'SKU-1', title: 'X' },
    });
    const result = validateOrdersSearchResponseBody(
      validBody([validOrder({ orderItems: [item] })]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.orders[0].items[0].unitPrice).toBeNull();
  });

  it('reads the ITEM-typed breakdown subtotal from the official orderItems[].proceeds.breakdowns[] object, ignoring other types', () => {
    const item = validItem({
      product: { asin: 'B1', sellerSku: 'SKU-1', title: 'X' }, // sem price.unitPrice
      proceeds: {
        breakdowns: [
          {
            type: 'SHIPPING',
            subtotal: { amount: '15.00', currencyCode: 'BRL' },
          },
          {
            type: 'ITEM',
            subtotal: { amount: '80.00', currencyCode: 'BRL' },
          },
          {
            type: 'TAX',
            subtotal: { amount: '5.00', currencyCode: 'BRL' },
          },
        ],
      },
    });
    const result = validateOrdersSearchResponseBody(
      validBody([validOrder({ orderItems: [item] })]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.orders[0].items[0].itemSubtotal).toEqual({
        amount: '80.00',
        currencyCode: 'BRL',
      });
    }
  });

  it('never accepts the old fictitious { type, amount }[] array format as a financial proceeds source', () => {
    const item = validItem({
      product: { asin: 'B1', sellerSku: 'SKU-1', title: 'X' },
      proceeds: [
        { type: 'ITEM', amount: { amount: '80.00', currencyCode: 'BRL' } },
      ],
    });
    const result = validateOrdersSearchResponseBody(
      validBody([validOrder({ orderItems: [item] })]),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.orders[0].items[0].itemSubtotal).toBeNull();
    }
  });

  it('tolerates proceeds with no breakdowns array, or with no ITEM-typed entry (null, not a rejection)', () => {
    const noBreakdowns = validateOrdersSearchResponseBody(
      validBody([
        validOrder({
          orderItems: [validItem({ proceeds: {} })],
        }),
      ]),
    );
    expect(noBreakdowns.valid).toBe(true);
    if (noBreakdowns.valid) {
      expect(noBreakdowns.orders[0].items[0].itemSubtotal).toBeNull();
    }

    const noItemEntry = validateOrdersSearchResponseBody(
      validBody([
        validOrder({
          orderItems: [
            validItem({
              proceeds: {
                breakdowns: [
                  {
                    type: 'SHIPPING',
                    subtotal: { amount: '15.00', currencyCode: 'BRL' },
                  },
                ],
              },
            }),
          ],
        }),
      ]),
    );
    expect(noItemEntry.valid).toBe(true);
    if (noItemEntry.valid) {
      expect(noItemEntry.orders[0].items[0].itemSubtotal).toBeNull();
    }
  });
});
