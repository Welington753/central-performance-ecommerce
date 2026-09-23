import type {
  ShopeeOrderDetailItem,
  ShopeeOrderDetailOrder,
  ShopeeOrderStatus,
} from './shopee-order-detail-response';
import { mapShopeeOrder, ShopeeOrderMappingError } from './shopee-order.mapper';

const ALL_ORDER_STATUSES: ShopeeOrderStatus[] = [
  'UNPAID',
  'READY_TO_SHIP',
  'PROCESSED',
  'SHIPPED',
  'COMPLETED',
  'IN_CANCEL',
  'CANCELLED',
  'INVOICE_PENDING',
  'TO_CONFIRM_RECEIVE',
  'TO_RETURN',
];

function validItem(
  overrides: Partial<ShopeeOrderDetailItem> = {},
): ShopeeOrderDetailItem {
  return {
    itemId: '2600144043',
    itemName: 'backpack',
    itemSku: 'item-sku',
    modelId: '221404189791',
    modelName: '60g',
    modelSku: 'model-sku',
    quantity: 2,
    originalPrice: 3000.0,
    discountedPrice: 2480.0,
    ...overrides,
  };
}

function validOrder(
  overrides: Partial<ShopeeOrderDetailOrder> = {},
): ShopeeOrderDetailOrder {
  return {
    orderSn: '2404098R48U37H',
    region: 'VN',
    currency: 'VND',
    orderStatus: 'COMPLETED',
    totalAmount: 1004.0,
    createTime: 1712601591,
    updateTime: 1713139948,
    fulfillmentFlag: 'fulfilled_by_local_seller',
    items: [validItem()],
    ...overrides,
  };
}

const ACCOUNT_ID = 'account-1';

describe('mapShopeeOrder', () => {
  it('mapeia um pedido completo', () => {
    const result = mapShopeeOrder(ACCOUNT_ID, validOrder());

    expect(result).toEqual({
      marketplaceAccountId: ACCOUNT_ID,
      externalOrderId: '2404098R48U37H',
      status: 'paid',
      currencyId: 'VND',
      totalAmount: '1004.00',
      packId: null,
      dateCreated: new Date(1712601591 * 1000),
      dateClosed: null,
      marketplaceLastUpdated: new Date(1713139948 * 1000),
      sourceStatus: 'COMPLETED',
      fulfillmentChannel: 'fulfilled_by_local_seller',
      externalMarketplaceId: null,
      logisticsClassification: 'SELLER_FULFILLED',
      logisticsType: null,
      items: [
        {
          externalItemId: '2600144043',
          variationId: '221404189791',
          sellerSku: 'model-sku',
          title: 'backpack',
          quantity: 2,
          unitPrice: '2480.00',
          currencyId: 'VND',
        },
      ],
    });
  });

  const EXPECTED_CANONICAL_STATUS: Record<ShopeeOrderStatus, string> = {
    UNPAID: 'pending',
    INVOICE_PENDING: 'pending',
    IN_CANCEL: 'pending',
    READY_TO_SHIP: 'paid',
    PROCESSED: 'paid',
    SHIPPED: 'paid',
    COMPLETED: 'paid',
    TO_CONFIRM_RECEIVE: 'paid',
    CANCELLED: 'cancelled',
    TO_RETURN: 'cancelled',
  };

  it('mapeia TO_CONFIRM_RECEIVE para paid, preservando o bruto em sourceStatus', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ orderStatus: 'TO_CONFIRM_RECEIVE' }),
    );
    expect(result.status).toBe('paid');
    expect(result.sourceStatus).toBe('TO_CONFIRM_RECEIVE');
  });

  it('mapeia TO_RETURN para cancelled, preservando o bruto em sourceStatus — devolução nunca compõe faturamento pago', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ orderStatus: 'TO_RETURN' }),
    );
    expect(result.status).toBe('cancelled');
    expect(result.status).not.toBe('paid');
    expect(result.sourceStatus).toBe('TO_RETURN');
  });

  it.each(ALL_ORDER_STATUSES)(
    'mapeia "%s" para o status canônico correto, preservando o bruto em sourceStatus',
    (orderStatus) => {
      const result = mapShopeeOrder(ACCOUNT_ID, validOrder({ orderStatus }));
      expect(result.status).toBe(EXPECTED_CANONICAL_STATUS[orderStatus]);
      expect(result.sourceStatus).toBe(orderStatus);
    },
  );

  it('falha fechado com UNKNOWN_ORDER_STATUS para um status fora do vocabulário fechado', () => {
    const unknownStatus =
      'SOME_UNDOCUMENTED_STATUS' as unknown as ShopeeOrderStatus;
    try {
      mapShopeeOrder(ACCOUNT_ID, validOrder({ orderStatus: unknownStatus }));
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(ShopeeOrderMappingError);
      expect((error as ShopeeOrderMappingError).reason).toBe(
        'UNKNOWN_ORDER_STATUS',
      );
    }
  });

  it('lança ShopeeOrderMappingError quando totalAmount está ausente', () => {
    expect(() =>
      mapShopeeOrder(ACCOUNT_ID, validOrder({ totalAmount: null })),
    ).toThrow(ShopeeOrderMappingError);
  });

  it('erro de totalAmount ausente identifica o motivo, nunca dado do pedido', () => {
    try {
      mapShopeeOrder(ACCOUNT_ID, validOrder({ totalAmount: null }));
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(ShopeeOrderMappingError);
      const mappingError = error as ShopeeOrderMappingError;
      expect(mappingError.reason).toBe('MISSING_TOTAL_AMOUNT');
      expect(mappingError.message).toBe('MISSING_TOTAL_AMOUNT');
      expect(mappingError.message).not.toContain('2404098R48U37H');
      expect(mappingError.message).not.toContain('VND');
    }
  });

  it('usa createTime como fallback quando updateTime está ausente', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ updateTime: null, createTime: 1700000000 }),
    );
    expect(result.marketplaceLastUpdated).toEqual(new Date(1700000000 * 1000));
  });

  it('preserva updateTime quando presente (não usa createTime)', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ createTime: 1700000000, updateTime: 1700003600 }),
    );
    expect(result.marketplaceLastUpdated).toEqual(new Date(1700003600 * 1000));
  });

  it('lança ShopeeOrderMappingError quando createTime está fora do intervalo válido de Date', () => {
    expect(() =>
      mapShopeeOrder(
        ACCOUNT_ID,
        validOrder({ createTime: Number.MAX_SAFE_INTEGER }),
      ),
    ).toThrow(ShopeeOrderMappingError);
    try {
      mapShopeeOrder(
        ACCOUNT_ID,
        validOrder({ createTime: Number.MAX_SAFE_INTEGER }),
      );
    } catch (error) {
      expect((error as ShopeeOrderMappingError).reason).toBe(
        'INVALID_TIMESTAMP',
      );
    }
  });

  it('lança ShopeeOrderMappingError quando updateTime está fora do intervalo válido de Date', () => {
    expect(() =>
      mapShopeeOrder(
        ACCOUNT_ID,
        validOrder({ updateTime: Number.MAX_SAFE_INTEGER }),
      ),
    ).toThrow(ShopeeOrderMappingError);
  });

  it('arredonda o valor monetário para 2 casas com toFixed(2) — mesmo comportamento comprovado de moneyToDecimalString (Mercado Livre)', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ totalAmount: 1004.005 }),
    );
    expect(result.totalAmount).toBe((1004.005).toFixed(2));
  });

  it('usa discountedPrice como unitPrice, nunca originalPrice', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({
        items: [validItem({ originalPrice: 9999.99, discountedPrice: 500.5 })],
      }),
    );
    expect(result.items[0].unitPrice).toBe('500.50');
  });

  it('sellerSku prioriza modelSku quando presente', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({
        items: [validItem({ modelSku: 'model-sku', itemSku: 'item-sku' })],
      }),
    );
    expect(result.items[0].sellerSku).toBe('model-sku');
  });

  it('sellerSku cai para itemSku quando modelSku está ausente', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({
        items: [validItem({ modelSku: null, itemSku: 'item-sku' })],
      }),
    );
    expect(result.items[0].sellerSku).toBe('item-sku');
  });

  it('sellerSku é null quando ambos os SKUs estão ausentes', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({
        items: [validItem({ modelSku: null, itemSku: null })],
      }),
    );
    expect(result.items[0].sellerSku).toBeNull();
  });

  it('variationId é null quando modelId é o sentinela "0"', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ items: [validItem({ modelId: '0' })] }),
    );
    expect(result.items[0].variationId).toBeNull();
  });

  it('variationId preserva modelId válido', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ items: [validItem({ modelId: '221404189791' })] }),
    );
    expect(result.items[0].variationId).toBe('221404189791');
  });

  it('a moeda do pedido é herdada por todos os itens', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({
        currency: 'BRL',
        items: [validItem(), validItem({ itemId: '999' })],
      }),
    );
    expect(result.items[0].currencyId).toBe('BRL');
    expect(result.items[1].currencyId).toBe('BRL');
  });

  it('logisticsType nunca é preenchido pela Shopee', () => {
    const result = mapShopeeOrder(ACCOUNT_ID, validOrder());
    expect(result.logisticsType).toBeNull();
  });

  it('classifica fulfillmentFlag "fulfilled_by_shopee" como MARKETPLACE_FULFILLED', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ fulfillmentFlag: 'fulfilled_by_shopee' }),
    );
    expect(result.logisticsClassification).toBe('MARKETPLACE_FULFILLED');
  });

  it('classifica fulfillmentFlag "fulfilled_by_local_seller" como SELLER_FULFILLED', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ fulfillmentFlag: 'fulfilled_by_local_seller' }),
    );
    expect(result.logisticsClassification).toBe('SELLER_FULFILLED');
  });

  it('classifica fulfillmentFlag ausente (null) como UNKNOWN', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ fulfillmentFlag: null }),
    );
    expect(result.logisticsClassification).toBe('UNKNOWN');
  });

  it('classifica fulfillmentFlag fora do vocabulário fechado como UNKNOWN — nunca inferido como sem Full', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ fulfillmentFlag: 'algum_outro_valor' }),
    );
    expect(result.logisticsClassification).toBe('UNKNOWN');
  });

  it('normaliza fulfillmentFlag por trim/lowercase antes de classificar', () => {
    const result = mapShopeeOrder(
      ACCOUNT_ID,
      validOrder({ fulfillmentFlag: '  Fulfilled_By_Shopee  ' }),
    );
    expect(result.logisticsClassification).toBe('MARKETPLACE_FULFILLED');
  });

  it('nunca inclui nenhum campo pessoal no resultado', () => {
    const result = mapShopeeOrder(ACCOUNT_ID, validOrder());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/buyer|recipient|dropshipper|prescription/i);
  });

  it('não modifica o objeto de entrada', () => {
    const input = validOrder();
    const frozenInput = Object.freeze({
      ...input,
      items: input.items.map((item) => Object.freeze(item)),
    });
    expect(() => mapShopeeOrder(ACCOUNT_ID, frozenInput)).not.toThrow();
  });
});
