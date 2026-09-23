import { classifyShopeeFulfillmentFlag } from './shopee-fulfillment-flag-classification';

describe('classifyShopeeFulfillmentFlag', () => {
  it('mapeia "fulfilled_by_shopee" para MARKETPLACE_FULFILLED', () => {
    expect(classifyShopeeFulfillmentFlag('fulfilled_by_shopee')).toBe(
      'MARKETPLACE_FULFILLED',
    );
  });

  it('mapeia "fulfilled_by_local_seller" para SELLER_FULFILLED', () => {
    expect(classifyShopeeFulfillmentFlag('fulfilled_by_local_seller')).toBe(
      'SELLER_FULFILLED',
    );
  });

  it('mapeia null para UNKNOWN', () => {
    expect(classifyShopeeFulfillmentFlag(null)).toBe('UNKNOWN');
  });

  it('mapeia string vazia para UNKNOWN', () => {
    expect(classifyShopeeFulfillmentFlag('')).toBe('UNKNOWN');
  });

  it('mapeia valor não reconhecido para UNKNOWN — nunca heurística de transportadora/warehouse', () => {
    expect(classifyShopeeFulfillmentFlag('warehouse_managed')).toBe('UNKNOWN');
    expect(classifyShopeeFulfillmentFlag('SPX_EXPRESS')).toBe('UNKNOWN');
  });

  it('normaliza por trim e lowercase, nunca contains/startsWith', () => {
    expect(classifyShopeeFulfillmentFlag('  FULFILLED_BY_SHOPEE  ')).toBe(
      'MARKETPLACE_FULFILLED',
    );
    expect(classifyShopeeFulfillmentFlag('Fulfilled_By_Local_Seller')).toBe(
      'SELLER_FULFILLED',
    );
    expect(classifyShopeeFulfillmentFlag('fulfilled_by_shopee_warehouse')).toBe(
      'UNKNOWN',
    );
  });
});
