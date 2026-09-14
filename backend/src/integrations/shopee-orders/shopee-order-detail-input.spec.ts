import { validateShopeeOrderDetailInput } from './shopee-order-detail-input';

describe('validateShopeeOrderDetailInput - caminho valido', () => {
  it('accepts a single orderSn', () => {
    const result = validateShopeeOrderDetailInput({
      orderSnList: ['201214JAJXU6G7'],
    });
    expect(result).toEqual({
      valid: true,
      input: { orderSnList: ['201214JAJXU6G7'] },
    });
  });

  it('accepts exactly 50 distinct orderSn values', () => {
    const orderSnList = Array.from(
      { length: 50 },
      (_, i) => `20121800${String(i).padStart(6, '0')}`,
    );
    const result = validateShopeeOrderDetailInput({ orderSnList });
    expect(result).toEqual({ valid: true, input: { orderSnList } });
  });

  it('never alters, trims or converts a valid orderSn', () => {
    const orderSnList = ['201214JAJXU6G7', '201214JASXYXY6'];
    const result = validateShopeeOrderDetailInput({ orderSnList });
    if (result.valid) {
      expect(result.input.orderSnList).toEqual(orderSnList);
      expect(result.input.orderSnList[0]).toBe(orderSnList[0]);
    } else {
      throw new Error('expected valid result');
    }
  });
});

describe('validateShopeeOrderDetailInput - tamanho do lote invalido', () => {
  it('rejects an empty orderSnList', () => {
    const result = validateShopeeOrderDetailInput({ orderSnList: [] });
    expect(result).toEqual({
      valid: false,
      failureCode: 'INVALID_ORDER_SN_LIST_SIZE',
    });
  });

  it('rejects a list with 51 entries', () => {
    const orderSnList = Array.from(
      { length: 51 },
      (_, i) => `20121800${String(i).padStart(6, '0')}`,
    );
    const result = validateShopeeOrderDetailInput({ orderSnList });
    expect(result).toEqual({
      valid: false,
      failureCode: 'INVALID_ORDER_SN_LIST_SIZE',
    });
  });

  it('rejects a non-array orderSnList', () => {
    const result = validateShopeeOrderDetailInput({
      orderSnList: 'not-an-array' as unknown as string[],
    });
    expect(result).toEqual({
      valid: false,
      failureCode: 'INVALID_ORDER_SN_LIST_SIZE',
    });
  });
});

describe('validateShopeeOrderDetailInput - orderSn invalido', () => {
  it.each(['', 'a'.repeat(65)])('rejects an invalid orderSn: %p', (orderSn) => {
    const result = validateShopeeOrderDetailInput({ orderSnList: [orderSn] });
    expect(result).toEqual({ valid: false, failureCode: 'INVALID_ORDER_SN' });
  });

  it('rejects an orderSn of the wrong type', () => {
    const result = validateShopeeOrderDetailInput({
      orderSnList: [12345 as unknown as string],
    });
    expect(result).toEqual({ valid: false, failureCode: 'INVALID_ORDER_SN' });
  });

  it.each([' 201214JAJXU6G7', '201214JAJXU6G7 ', ' 201214JAJXU6G7 '])(
    'rejects an orderSn with external whitespace instead of trimming it: %p',
    (orderSn) => {
      const result = validateShopeeOrderDetailInput({ orderSnList: [orderSn] });
      expect(result).toEqual({ valid: false, failureCode: 'INVALID_ORDER_SN' });
    },
  );

  it('rejects an orderSn containing a literal comma (would corrupt the joined query param)', () => {
    const result = validateShopeeOrderDetailInput({
      orderSnList: ['201214JAJXU6G7,201214JASXYXY6'],
    });
    expect(result).toEqual({ valid: false, failureCode: 'INVALID_ORDER_SN' });
  });

  it('rejects an orderSn containing a control character', () => {
    const result = validateShopeeOrderDetailInput({
      orderSnList: [`201214${String.fromCharCode(0)}JAJXU6G7`],
    });
    expect(result).toEqual({ valid: false, failureCode: 'INVALID_ORDER_SN' });
  });

  it('accepts an orderSn exactly at the length limit and rejects one above it', () => {
    const atLimit = validateShopeeOrderDetailInput({
      orderSnList: ['a'.repeat(64)],
    });
    expect(atLimit.valid).toBe(true);

    const aboveLimit = validateShopeeOrderDetailInput({
      orderSnList: ['a'.repeat(65)],
    });
    expect(aboveLimit).toEqual({
      valid: false,
      failureCode: 'INVALID_ORDER_SN',
    });
  });
});

describe('validateShopeeOrderDetailInput - duplicados', () => {
  it('rejects a duplicated orderSn instead of silently deduplicating', () => {
    const result = validateShopeeOrderDetailInput({
      orderSnList: ['201214JAJXU6G7', '201214JAJXU6G7'],
    });
    expect(result).toEqual({
      valid: false,
      failureCode: 'DUPLICATE_ORDER_SN',
    });
  });

  it('rejects a duplicate anywhere in a larger valid-looking list', () => {
    const result = validateShopeeOrderDetailInput({
      orderSnList: ['201214JAJXU6G7', '201214JASXYXY6', '201214JAJXU6G7'],
    });
    expect(result).toEqual({
      valid: false,
      failureCode: 'DUPLICATE_ORDER_SN',
    });
  });
});
