import type { RawMercadoLivreOrder } from './mercado-livre-order-response';
import {
  InvalidOrderDateError,
  mapMercadoLivreOrder,
} from './mercado-livre-order.mapper';

function rawOrder(
  overrides: Partial<RawMercadoLivreOrder> = {},
): RawMercadoLivreOrder {
  return {
    externalOrderId: '123',
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
    ...overrides,
  };
}

describe('mapMercadoLivreOrder', () => {
  it('maps every allowlisted field, converting dates to Date instances', () => {
    const mapped = mapMercadoLivreOrder('account-1', rawOrder());

    expect(mapped).toEqual({
      marketplaceAccountId: 'account-1',
      externalOrderId: '123',
      status: 'paid',
      currencyId: 'BRL',
      totalAmount: '199.90',
      packId: null,
      dateCreated: new Date('2026-08-15T10:00:00.000-04:00'),
      dateClosed: new Date('2026-08-15T10:05:00.000-04:00'),
      marketplaceLastUpdated: new Date('2026-08-15T10:05:00.000-04:00'),
      items: [
        {
          externalItemId: 'MLB111',
          variationId: null,
          sellerSku: 'SKU-1',
          title: 'Produto de teste',
          quantity: 2,
          unitPrice: '99.95',
          currencyId: 'BRL',
        },
      ],
    });
  });

  it('never includes any buyer/PII-shaped key — the mapped shape is a fixed allowlist', () => {
    const mapped = mapMercadoLivreOrder('account-1', rawOrder());
    const keys = Object.keys(mapped);
    expect(keys).toEqual([
      'marketplaceAccountId',
      'externalOrderId',
      'status',
      'currencyId',
      'totalAmount',
      'packId',
      'dateCreated',
      'dateClosed',
      'marketplaceLastUpdated',
      'items',
    ]);
  });

  it('maps null dateClosed/lastUpdated/packId through as null', () => {
    const mapped = mapMercadoLivreOrder(
      'account-1',
      rawOrder({ dateClosed: null, lastUpdated: null, packId: null }),
    );
    expect(mapped.dateClosed).toBeNull();
    expect(mapped.marketplaceLastUpdated).toBeNull();
    expect(mapped.packId).toBeNull();
  });

  it('maps an order with no items to an empty items array', () => {
    const mapped = mapMercadoLivreOrder('account-1', rawOrder({ items: [] }));
    expect(mapped.items).toEqual([]);
  });

  it('preserves a non-null packId as-is', () => {
    const mapped = mapMercadoLivreOrder(
      'account-1',
      rawOrder({ packId: '2000000101334825' }),
    );
    expect(mapped.packId).toBe('2000000101334825');
  });

  it('maps every item of a multi-item order, preserving quantity/price per item', () => {
    const mapped = mapMercadoLivreOrder(
      'account-1',
      rawOrder({
        items: [
          {
            itemId: 'MLB111',
            variationId: null,
            sellerSku: 'SKU-A',
            title: 'Produto A',
            quantity: 2,
            unitPrice: '10.00',
            currencyId: 'BRL',
          },
          {
            itemId: 'MLB222',
            variationId: null,
            sellerSku: 'SKU-B',
            title: 'Produto B',
            quantity: 3,
            unitPrice: '25.50',
            currencyId: 'BRL',
          },
        ],
      }),
    );

    expect(mapped.items).toHaveLength(2);
    expect(mapped.items[0]).toEqual({
      externalItemId: 'MLB111',
      variationId: null,
      sellerSku: 'SKU-A',
      title: 'Produto A',
      quantity: 2,
      unitPrice: '10.00',
      currencyId: 'BRL',
    });
    expect(mapped.items[1]).toEqual({
      externalItemId: 'MLB222',
      variationId: null,
      sellerSku: 'SKU-B',
      title: 'Produto B',
      quantity: 3,
      unitPrice: '25.50',
      currencyId: 'BRL',
    });
  });

  it('throws InvalidOrderDateError when date_created cannot be parsed', () => {
    expect(() =>
      mapMercadoLivreOrder(
        'account-1',
        rawOrder({ dateCreated: 'not-a-date' }),
      ),
    ).toThrow(InvalidOrderDateError);
  });
});
