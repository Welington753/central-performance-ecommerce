import type {
  RawMercadoLivreOrder,
  RawMercadoLivrePayment,
} from './mercado-livre-order-response';
import {
  InvalidOrderDateError,
  mapMercadoLivreOrder,
} from './mercado-livre-order.mapper';

function rawPayment(
  overrides: Partial<RawMercadoLivrePayment> = {},
): RawMercadoLivrePayment {
  return {
    status: 'approved',
    marketplaceFee: null,
    shippingCost: null,
    taxesAmount: null,
    couponAmount: null,
    transactionAmountRefunded: null,
    ...overrides,
  };
}

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
    payments: [],
    buyer: null,
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
      externalShipmentId: null,
      marketplaceFeeAmount: null,
      buyerShippingCostAmount: null,
      taxesAmount: null,
      couponAmount: null,
      refundedAmount: null,
      buyer: null,
      items: [
        {
          externalItemId: 'MLB111',
          variationId: null,
          sellerSku: 'SKU-1',
          title: 'Produto de teste',
          quantity: 2,
          unitPrice: '99.95',
          currencyId: 'BRL',
          saleFeeAmount: null,
        },
      ],
    });
  });

  describe('buyer (função Clientes)', () => {
    it('maps id + nickname + first/last name, never inventing email/phone/address', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          buyer: {
            id: '999',
            nickname: 'COMPRADOR_X',
            firstName: 'Maria',
            lastName: 'Silva',
          },
        }),
      );
      expect(mapped.buyer).toEqual({
        externalBuyerId: '999',
        dataSource: 'MERCADO_LIVRE_ORDERS',
        username: 'COMPRADOR_X',
        buyerName: 'Maria Silva',
        recipientName: null,
        email: null,
        recipientPhone: null,
        city: null,
        state: null,
        postalCode: null,
      });
    });

    it('keeps buyerName null when the source did not send any name part', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          buyer: { id: '1', nickname: null, firstName: null, lastName: null },
        }),
      );
      expect(mapped.buyer?.buyerName).toBeNull();
      expect(mapped.buyer?.username).toBeNull();
    });
  });

  it('never includes any PII-shaped key outside `buyer` — the mapped shape is a fixed allowlist', () => {
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
      // Correção da auditoria Full: `shipping.id` passa a ser PERSISTIDO,
      // para permitir reclassificar depois um pedido deixado `UNKNOWN`.
      // Identificador do ENVIO — nunca dado de comprador.
      'externalShipmentId',
      'marketplaceFeeAmount',
      'buyerShippingCostAmount',
      'taxesAmount',
      'couponAmount',
      'refundedAmount',
      // Função "Clientes": comprador restrito à allowlist de `MappedBuyerRecord`.
      'buyer',
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
            saleFee: null,
          },
          {
            itemId: 'MLB222',
            variationId: null,
            sellerSku: 'SKU-B',
            title: 'Produto B',
            quantity: 3,
            unitPrice: '25.50',
            currencyId: 'BRL',
            saleFee: null,
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
      saleFeeAmount: null,
    });
    expect(mapped.items[1]).toEqual({
      externalItemId: 'MLB222',
      variationId: null,
      sellerSku: 'SKU-B',
      title: 'Produto B',
      quantity: 3,
      unitPrice: '25.50',
      currencyId: 'BRL',
      saleFeeAmount: null,
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

  describe('campos financeiros (CP2K-7D) — agregação de payments elegíveis', () => {
    // Regra confirmada no preflight do CP2K-7D: só payments com
    // status === 'approved' contribuem para o agregado do pedido — qualquer
    // outro status (cancelled, rejected, in_process, refunded, etc.) nunca
    // contamina a soma.
    it('sums a single approved payment field into the order-level amount', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [
            rawPayment({
              marketplaceFee: '12.50',
              shippingCost: '9.90',
              taxesAmount: '1.23',
              couponAmount: '5.00',
              transactionAmountRefunded: '0.00',
            }),
          ],
        }),
      );
      expect(mapped.marketplaceFeeAmount).toBe('12.50');
      expect(mapped.buyerShippingCostAmount).toBe('9.90');
      expect(mapped.taxesAmount).toBe('1.23');
      expect(mapped.couponAmount).toBe('5.00');
      expect(mapped.refundedAmount).toBe('0.00');
    });

    it('sums the field across multiple eligible (approved) payments', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [
            rawPayment({ shippingCost: '10.00' }),
            rawPayment({ shippingCost: '5.50' }),
          ],
        }),
      );
      expect(mapped.buyerShippingCostAmount).toBe('15.50');
    });

    it('never lets a non-eligible payment contaminate the aggregate', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [
            rawPayment({ shippingCost: '10.00' }),
            rawPayment({ status: 'cancelled', shippingCost: '999.00' }),
          ],
        }),
      );
      expect(mapped.buyerShippingCostAmount).toBe('10.00');
    });

    it('maps to null when no eligible payment has the field', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [
            rawPayment({ status: 'cancelled', shippingCost: '10.00' }),
          ],
        }),
      );
      expect(mapped.buyerShippingCostAmount).toBeNull();
    });

    it('maps to null when there are no payments at all', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({ payments: [] }),
      );
      expect(mapped.marketplaceFeeAmount).toBeNull();
      expect(mapped.buyerShippingCostAmount).toBeNull();
      expect(mapped.taxesAmount).toBeNull();
      expect(mapped.couponAmount).toBeNull();
      expect(mapped.refundedAmount).toBeNull();
    });

    it('keeps zero distinct from null when the only eligible payment has zero', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [rawPayment({ couponAmount: '0.00' })],
        }),
      );
      expect(mapped.couponAmount).toBe('0.00');
      expect(mapped.couponAmount).not.toBeNull();
    });

    it('refundedAmount comes from transactionAmountRefunded', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [rawPayment({ transactionAmountRefunded: '42.10' })],
        }),
      );
      expect(mapped.refundedAmount).toBe('42.10');
    });

    it('buyerShippingCostAmount is sourced from payments[].shippingCost — the cost charged to the buyer, never a seller cost', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [rawPayment({ shippingCost: '7.00' })],
        }),
      );
      expect(mapped.buyerShippingCostAmount).toBe('7.00');
    });

    it('rounds monetary sums using the same cents-based utility as the rest of the codebase (no float drift)', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [
            rawPayment({ shippingCost: '0.10' }),
            rawPayment({ shippingCost: '0.20' }),
          ],
        }),
      );
      // 0.10 + 0.20 em float daria 0.30000000000000004 — soma em centavos
      // (bigint) garante exatamente "0.30".
      expect(mapped.buyerShippingCostAmount).toBe('0.30');
    });

    it('persists sale_fee per item', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          items: [
            {
              itemId: 'MLB111',
              variationId: null,
              sellerSku: 'SKU-1',
              title: 'Produto de teste',
              quantity: 2,
              unitPrice: '99.95',
              currencyId: 'BRL',
              saleFee: '4.99',
            },
          ],
        }),
      );
      expect(mapped.items[0].saleFeeAmount).toBe('4.99');
    });

    it('maps item saleFeeAmount to null when the raw item has none', () => {
      const mapped = mapMercadoLivreOrder('account-1', rawOrder());
      expect(mapped.items[0].saleFeeAmount).toBeNull();
    });

    it('never changes any pre-existing field while mapping the new financial fields', () => {
      const mapped = mapMercadoLivreOrder(
        'account-1',
        rawOrder({
          payments: [rawPayment({ shippingCost: '1.00' })],
        }),
      );
      expect(mapped.totalAmount).toBe('199.90');
      expect(mapped.status).toBe('paid');
      expect(mapped.currencyId).toBe('BRL');
      expect(mapped.items[0].unitPrice).toBe('99.95');
      expect(mapped.items[0].quantity).toBe(2);
    });
  });
});
