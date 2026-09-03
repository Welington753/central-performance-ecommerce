import type {
  RawAmazonOrder,
  RawAmazonOrderItem,
} from './amazon-order-response';
import {
  AmazonOrderQuarantinedError,
  mapAmazonOrder,
} from './amazon-order.mapper';

const ALLOWED_MARKETPLACE_IDS = ['A2Q3Y263D00KWC'];
const ACCOUNT_ID = 'acc-amazon-1';

function item(overrides: Partial<RawAmazonOrderItem> = {}): RawAmazonOrderItem {
  return {
    orderItemId: 'item-1',
    quantityOrdered: 2,
    asin: 'B000000001',
    sellerSku: 'SKU-1',
    title: 'Produto 1',
    unitPrice: { amount: '99.95', currencyCode: 'BRL' },
    itemSubtotal: { amount: '199.90', currencyCode: 'BRL' },
    ...overrides,
  };
}

function order(overrides: Partial<RawAmazonOrder> = {}): RawAmazonOrder {
  return {
    orderId: 'ORDER-1',
    createdTime: '2026-08-01T10:00:00Z',
    lastUpdatedTime: '2026-08-01T10:05:00Z',
    marketplaceId: 'A2Q3Y263D00KWC',
    fulfillmentStatus: 'SHIPPED',
    fulfilledBy: 'AMAZON',
    grandTotal: { amount: '199.90', currencyCode: 'BRL' },
    items: [item()],
    ...overrides,
  };
}

describe('mapAmazonOrder', () => {
  it('maps a well-formed paid order to the shared record shape — unit price derived from the ITEM subtotal, listing identity from ASIN/SKU (never orderItemId)', () => {
    const mapped = mapAmazonOrder(ACCOUNT_ID, order(), ALLOWED_MARKETPLACE_IDS);

    expect(mapped).toEqual({
      marketplaceAccountId: ACCOUNT_ID,
      externalOrderId: 'ORDER-1',
      status: 'paid',
      currencyId: 'BRL',
      totalAmount: '199.90',
      packId: null,
      dateCreated: new Date('2026-08-01T10:00:00Z'),
      dateClosed: null,
      marketplaceLastUpdated: new Date('2026-08-01T10:05:00Z'),
      sourceStatus: 'SHIPPED',
      fulfillmentChannel: 'AMAZON',
      externalMarketplaceId: 'A2Q3Y263D00KWC',
      items: [
        {
          externalItemId: 'B000000001',
          variationId: 'SKU-1',
          sellerSku: 'SKU-1',
          title: 'Produto 1',
          quantity: 2,
          unitPrice: '99.95',
          currencyId: 'BRL',
        },
      ],
    });
  });

  it('maps FBM (fulfilledBy MERCHANT) correctly', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({ fulfilledBy: 'MERCHANT' }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.fulfillmentChannel).toBe('MERCHANT');
  });

  it('preserves the original Amazon status separately from the canonical one', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({ fulfillmentStatus: 'PARTIALLY_SHIPPED' }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.status).toBe('paid');
    expect(mapped.sourceStatus).toBe('PARTIALLY_SHIPPED');
  });

  it('maps CANCELLED to the cancelled canonical status', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        fulfillmentStatus: 'CANCELLED',
        grandTotal: { amount: '199.90', currencyCode: 'BRL' },
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.status).toBe('cancelled');
  });

  it('a cancelled order without a valid grandTotal is still persisted (never quarantined) with totalAmount "0.00" — cancellation KPI never needs revenue', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({ fulfillmentStatus: 'CANCELLED', grandTotal: null }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.status).toBe('cancelled');
    expect(mapped.totalAmount).toBe('0.00');
  });

  it('a pending order without item prices is still persisted with "0.00" placeholders — never affects any paid-only KPI', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        fulfillmentStatus: 'PENDING',
        // grandTotal ausente é tolerado para pending, mas a MOEDA do pedido
        // ainda precisa vir de algum lugar — aqui, do próprio grandTotal
        // presente (cenário real: Amazon manda o total estimado mesmo para
        // um pedido ainda pendente, só o preço do ITEM que está ausente).
        grandTotal: { amount: '0.00', currencyCode: 'BRL' },
        items: [item({ unitPrice: null, itemSubtotal: null })],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.status).toBe('pending');
    expect(mapped.items[0].unitPrice).toBe('0.00');
  });

  it('maps INVOICE_UNCONFIRMED to pending — never paid nor cancelled — while preserving the original source status', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        fulfillmentStatus: 'INVOICE_UNCONFIRMED',
        grandTotal: { amount: '0.00', currencyCode: 'BRL' },
        items: [item({ unitPrice: null, itemSubtotal: null })],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.status).toBe('pending');
    expect(mapped.status).not.toBe('paid');
    expect(mapped.status).not.toBe('cancelled');
    expect(mapped.sourceStatus).toBe('INVOICE_UNCONFIRMED');
  });

  it('a non-paid item never uses the (line-total) itemSubtotal as a per-unit display price — only product.price.unitPrice, or "0.00"', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        fulfillmentStatus: 'PENDING',
        grandTotal: { amount: '0.00', currencyCode: 'BRL' },
        items: [
          item({
            unitPrice: null,
            itemSubtotal: { amount: '199.90', currencyCode: 'BRL' },
          }),
        ],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.items[0].unitPrice).toBe('0.00');
  });

  it('throws MARKETPLACE_NOT_ALLOWED for a marketplaceId outside the configured allowlist', () => {
    expect(() =>
      mapAmazonOrder(
        ACCOUNT_ID,
        order({ marketplaceId: 'SOME-OTHER-MARKETPLACE' }),
        ALLOWED_MARKETPLACE_IDS,
      ),
    ).toThrow(AmazonOrderQuarantinedError);
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({ marketplaceId: 'SOME-OTHER-MARKETPLACE' }),
        ALLOWED_MARKETPLACE_IDS,
      );
    } catch (error) {
      expect((error as AmazonOrderQuarantinedError).reason).toBe(
        'MARKETPLACE_NOT_ALLOWED',
      );
    }
  });

  it('throws MISSING_GRAND_TOTAL for a PAID order without a valid grandTotal — never substitutes zero', () => {
    expect(() =>
      mapAmazonOrder(
        ACCOUNT_ID,
        order({ fulfillmentStatus: 'SHIPPED', grandTotal: null }),
        ALLOWED_MARKETPLACE_IDS,
      ),
    ).toThrow(AmazonOrderQuarantinedError);
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({ fulfillmentStatus: 'UNSHIPPED', grandTotal: null }),
        ALLOWED_MARKETPLACE_IDS,
      );
    } catch (error) {
      expect((error as AmazonOrderQuarantinedError).reason).toBe(
        'MISSING_GRAND_TOTAL',
      );
    }
  });

  it('throws MISSING_ITEM_PROCEEDS for a PAID order whose item has no ITEM-typed proceeds subtotal — never falls back to product.price.unitPrice', () => {
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({
          items: [
            item({
              unitPrice: { amount: '99.95', currencyCode: 'BRL' }, // presente, mas irrelevante
              itemSubtotal: null,
            }),
          ],
        }),
        ALLOWED_MARKETPLACE_IDS,
      );
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AmazonOrderQuarantinedError);
      expect((error as AmazonOrderQuarantinedError).reason).toBe(
        'MISSING_ITEM_PROCEEDS',
      );
    }
  });

  it('mandatory checkpoint example: quantity 2 + ITEM subtotal 99.98 produces unit price 49.99 (never 199.96 / never a double count)', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        grandTotal: { amount: '99.98', currencyCode: 'BRL' },
        items: [
          item({
            quantityOrdered: 2,
            unitPrice: null,
            itemSubtotal: { amount: '99.98', currencyCode: 'BRL' },
          }),
        ],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.items[0].unitPrice).toBe('49.99');
    expect(mapped.items[0].quantity).toBe(2);
    // A "receita da linha" (quantidade × unitário persistido) reproduz
    // exatamente o subtotal original — nunca dobra o valor.
    expect(
      Number(mapped.items[0].quantity) * Number(mapped.items[0].unitPrice),
    ).toBeCloseTo(99.98);
  });

  it('throws ITEM_SUBTOTAL_NOT_DIVISIBLE when the ITEM subtotal cannot be split exactly (in cents) by the quantity — never rounds silently', () => {
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({
          grandTotal: { amount: '10.00', currencyCode: 'BRL' },
          items: [
            item({
              quantityOrdered: 3,
              unitPrice: null,
              itemSubtotal: { amount: '10.00', currencyCode: 'BRL' },
            }),
          ],
        }),
        ALLOWED_MARKETPLACE_IDS,
      );
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AmazonOrderQuarantinedError);
      expect((error as AmazonOrderQuarantinedError).reason).toBe(
        'ITEM_SUBTOTAL_NOT_DIVISIBLE',
      );
    }
  });

  it('a divergent product.price.unitPrice never silently replaces the ITEM proceeds subtotal for a paid order', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        grandTotal: { amount: '99.98', currencyCode: 'BRL' },
        items: [
          item({
            quantityOrdered: 2,
            // Preço de catálogo bem diferente do subtotal financeiro real —
            // nunca deve vazar para o unitário persistido.
            unitPrice: { amount: '500.00', currencyCode: 'BRL' },
            itemSubtotal: { amount: '99.98', currencyCode: 'BRL' },
          }),
        ],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.items[0].unitPrice).toBe('49.99');
  });

  it('throws CURRENCY_MISMATCH when a paid item ITEM-subtotal currency diverges from the order currency', () => {
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({
          grandTotal: { amount: '199.90', currencyCode: 'BRL' },
          items: [
            item({
              unitPrice: null,
              itemSubtotal: { amount: '99.95', currencyCode: 'USD' },
            }),
          ],
        }),
        ALLOWED_MARKETPLACE_IDS,
      );
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AmazonOrderQuarantinedError);
      expect((error as AmazonOrderQuarantinedError).reason).toBe(
        'CURRENCY_MISMATCH',
      );
    }
  });

  it('throws MISSING_CURRENCY when there is no grandTotal AND no item has a resolvable price (no currency determinable anywhere)', () => {
    const orderWithNoPriceAnywhere = order({
      fulfillmentStatus: 'PENDING',
      grandTotal: null,
      items: [],
    });
    expect(() =>
      mapAmazonOrder(
        ACCOUNT_ID,
        orderWithNoPriceAnywhere,
        ALLOWED_MARKETPLACE_IDS,
      ),
    ).toThrow(AmazonOrderQuarantinedError);
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        orderWithNoPriceAnywhere,
        ALLOWED_MARKETPLACE_IDS,
      );
    } catch (error) {
      expect((error as AmazonOrderQuarantinedError).reason).toBe(
        'MISSING_CURRENCY',
      );
    }
  });

  it('never leaks the raw order payload in the quarantine error', () => {
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({ grandTotal: null }),
        ALLOWED_MARKETPLACE_IDS,
      );
      fail('expected to throw');
    } catch (error) {
      expect(JSON.stringify((error as Error).message)).not.toContain('{');
      expect((error as AmazonOrderQuarantinedError).orderId).toBe('ORDER-1');
    }
  });
});

describe('mapAmazonOrder — listing identity (Correção 5)', () => {
  it('uses the ASIN as externalItemId and the SKU as variationId when both are present', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({ items: [item({ asin: 'B111', sellerSku: 'SKU-A' })] }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.items[0].externalItemId).toBe('B111');
    expect(mapped.items[0].variationId).toBe('SKU-A');
  });

  it('falls back to a deterministic SKU-based identity when ASIN is absent', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({ items: [item({ asin: null, sellerSku: 'SKU-B' })] }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.items[0].externalItemId).toBe('SKU:SKU-B');
    expect(mapped.items[0].variationId).toBeNull();
  });

  it('falls back to orderItemId only as a last resort, when neither ASIN nor SKU is present', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        items: [
          item({ orderItemId: 'item-only-id', asin: null, sellerSku: null }),
        ],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.items[0].externalItemId).toBe('item-only-id');
    expect(mapped.items[0].variationId).toBeNull();
  });

  it('the same ASIN/SKU across two different orderItemIds resolves to the SAME listing identity — never two different listings', () => {
    const mappedFirst = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        orderId: 'ORDER-1',
        items: [
          item({ orderItemId: 'item-a', asin: 'B999', sellerSku: 'SKU-X' }),
        ],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    const mappedSecond = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        orderId: 'ORDER-2',
        items: [
          item({ orderItemId: 'item-b', asin: 'B999', sellerSku: 'SKU-X' }),
        ],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mappedFirst.items[0].externalItemId).toBe(
      mappedSecond.items[0].externalItemId,
    );
    expect(mappedFirst.items[0].variationId).toBe(
      mappedSecond.items[0].variationId,
    );
  });
});
