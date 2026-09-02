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
    itemProceeds: null,
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
  it('maps a well-formed paid order to the shared record shape', () => {
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
          externalItemId: 'item-1',
          variationId: null,
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
        items: [item({ unitPrice: null, itemProceeds: null })],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.status).toBe('pending');
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

  it('throws MISSING_ITEM_PRICE for a PAID order whose item has neither unitPrice nor a valid proceeds[type=ITEM] fallback', () => {
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({ items: [item({ unitPrice: null, itemProceeds: null })] }),
        ALLOWED_MARKETPLACE_IDS,
      );
      fail('expected to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AmazonOrderQuarantinedError);
      expect((error as AmazonOrderQuarantinedError).reason).toBe(
        'MISSING_ITEM_PRICE',
      );
    }
  });

  it('falls back to proceeds[type=ITEM] when product.price.unitPrice is absent, for a paid order', () => {
    const mapped = mapAmazonOrder(
      ACCOUNT_ID,
      order({
        items: [
          item({
            unitPrice: null,
            itemProceeds: { amount: '80.00', currencyCode: 'BRL' },
          }),
        ],
      }),
      ALLOWED_MARKETPLACE_IDS,
    );
    expect(mapped.items[0].unitPrice).toBe('80.00');
  });

  it('throws CURRENCY_MISMATCH when an item currency diverges from the order currency', () => {
    try {
      mapAmazonOrder(
        ACCOUNT_ID,
        order({
          grandTotal: { amount: '199.90', currencyCode: 'BRL' },
          items: [
            item({ unitPrice: { amount: '99.95', currencyCode: 'USD' } }),
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
