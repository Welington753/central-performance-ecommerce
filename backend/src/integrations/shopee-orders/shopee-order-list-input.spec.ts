import {
  ShopeeOrderListInput,
  validateShopeeOrderListInput,
} from './shopee-order-list-input';

const VALID_INPUT: ShopeeOrderListInput = {
  timeRangeField: 'create_time',
  timeFrom: 1700000000,
  timeTo: 1700003600,
  pageSize: 20,
};

describe('validateShopeeOrderListInput - caminho valido', () => {
  it('accepts a fully valid input without a cursor, normalizing cursor to null', () => {
    const result = validateShopeeOrderListInput(VALID_INPUT);
    expect(result).toEqual({
      valid: true,
      input: {
        timeRangeField: 'create_time',
        timeFrom: 1700000000,
        timeTo: 1700003600,
        pageSize: 20,
        cursor: null,
      },
    });
  });

  it('accepts update_time as time_range_field', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      timeRangeField: 'update_time',
    });
    expect(result.valid).toBe(true);
  });

  it('accepts an empty-string cursor, normalizing it to null (first page)', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      cursor: '',
    });
    expect(result).toEqual({
      valid: true,
      input: { ...VALID_INPUT, cursor: null },
    });
  });

  it('accepts a well-formed non-empty cursor, preserving it exactly', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      cursor: '20',
    });
    expect(result).toEqual({
      valid: true,
      input: { ...VALID_INPUT, cursor: '20' },
    });
  });

  it('accepts a time range of exactly 15 days', () => {
    const timeFrom = 1700000000;
    const timeTo = timeFrom + 15 * 24 * 60 * 60;
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      timeFrom,
      timeTo,
    });
    expect(result.valid).toBe(true);
  });

  it.each([1, 100])('accepts the boundary page_size %i', (pageSize) => {
    const result = validateShopeeOrderListInput({ ...VALID_INPUT, pageSize });
    expect(result.valid).toBe(true);
  });
});

describe('validateShopeeOrderListInput - time_range_field invalido', () => {
  it.each([
    'created_time',
    'CREATE_TIME',
    '',
    'update_time ',
    123,
    null,
    undefined,
  ])('rejects an invalid time_range_field: %p', (timeRangeField) => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      timeRangeField:
        timeRangeField as unknown as ShopeeOrderListInput['timeRangeField'],
    });
    expect(result).toEqual({
      valid: false,
      failureCode: 'INVALID_TIME_RANGE_FIELD',
    });
  });
});

describe('validateShopeeOrderListInput - time_from/time_to invalidos', () => {
  it('rejects time_from >= time_to (equal)', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      timeFrom: 1700000000,
      timeTo: 1700000000,
    });
    expect(result).toEqual({
      valid: false,
      failureCode: 'INVALID_TIME_RANGE_ORDER',
    });
  });

  it('rejects time_from > time_to', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      timeFrom: 1700003600,
      timeTo: 1700000000,
    });
    expect(result).toEqual({
      valid: false,
      failureCode: 'INVALID_TIME_RANGE_ORDER',
    });
  });

  it('rejects a span strictly above 15 days', () => {
    const timeFrom = 1700000000;
    const timeTo = timeFrom + 15 * 24 * 60 * 60 + 1;
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      timeFrom,
      timeTo,
    });
    expect(result).toEqual({
      valid: false,
      failureCode: 'INVALID_TIME_RANGE_SPAN',
    });
  });

  it.each([0, -1, -1700000000, 1.5, NaN, Infinity, -Infinity])(
    'rejects an invalid time_from: %p',
    (timeFrom) => {
      const result = validateShopeeOrderListInput({
        ...VALID_INPUT,
        timeFrom,
      });
      expect(result).toEqual({
        valid: false,
        failureCode: 'INVALID_TIME_FROM',
      });
    },
  );

  it('rejects a time_from above Number.MAX_SAFE_INTEGER', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      timeFrom: Number.MAX_SAFE_INTEGER + 2,
    });
    expect(result).toEqual({ valid: false, failureCode: 'INVALID_TIME_FROM' });
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    'rejects an invalid time_to: %p',
    (timeTo) => {
      const result = validateShopeeOrderListInput({
        ...VALID_INPUT,
        timeTo,
      });
      expect(result).toEqual({ valid: false, failureCode: 'INVALID_TIME_TO' });
    },
  );

  it.each(['1700000000', null, undefined, true])(
    'rejects a non-numeric time_from: %p',
    (timeFrom) => {
      const result = validateShopeeOrderListInput({
        ...VALID_INPUT,
        timeFrom: timeFrom as unknown as number,
      });
      expect(result).toEqual({
        valid: false,
        failureCode: 'INVALID_TIME_FROM',
      });
    },
  );
});

describe('validateShopeeOrderListInput - page_size invalido', () => {
  it.each([0, -1, 101, 1000, 1.5, NaN, Infinity])(
    'rejects an invalid page_size: %p',
    (pageSize) => {
      const result = validateShopeeOrderListInput({
        ...VALID_INPUT,
        pageSize,
      });
      expect(result).toEqual({
        valid: false,
        failureCode: 'INVALID_PAGE_SIZE',
      });
    },
  );

  it.each(['20', null, undefined])(
    'rejects a non-numeric page_size: %p',
    (pageSize) => {
      const result = validateShopeeOrderListInput({
        ...VALID_INPUT,
        pageSize: pageSize as unknown as number,
      });
      expect(result).toEqual({
        valid: false,
        failureCode: 'INVALID_PAGE_SIZE',
      });
    },
  );
});

describe('validateShopeeOrderListInput - cursor invalido', () => {
  const whitespaceOnlyCursors = [
    ' '.repeat(3),
    String.fromCharCode(9),
    String.fromCharCode(10),
  ];

  it.each(whitespaceOnlyCursors)(
    'rejects a whitespace-only cursor (char codes: %s)',
    (cursor) => {
      const result = validateShopeeOrderListInput({ ...VALID_INPUT, cursor });
      expect(result).toEqual({ valid: false, failureCode: 'INVALID_CURSOR' });
    },
  );

  const controlCharCursors = [
    `abc${String.fromCharCode(0)}def`,
    `abc${String.fromCharCode(1)}def`,
    `abc${String.fromCharCode(127)}def`,
  ];

  it.each(controlCharCursors)(
    'rejects a cursor containing an embedded control character',
    (cursor) => {
      const result = validateShopeeOrderListInput({ ...VALID_INPUT, cursor });
      expect(result).toEqual({ valid: false, failureCode: 'INVALID_CURSOR' });
    },
  );

  it('rejects a cursor above the local conservative length limit', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      cursor: 'a'.repeat(513),
    });
    expect(result).toEqual({ valid: false, failureCode: 'INVALID_CURSOR' });
  });

  it('accepts a cursor exactly at the local conservative length limit', () => {
    const result = validateShopeeOrderListInput({
      ...VALID_INPUT,
      cursor: 'a'.repeat(512),
    });
    expect(result.valid).toBe(true);
  });
});
