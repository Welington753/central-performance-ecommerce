import {
  buildShopeeOrderSyncFailureLogPayload,
  sanitizeShopeeOrdersProviderErrorCode,
  sanitizeShopeeOrdersProviderRequestId,
  UNCLASSIFIED_PROVIDER_ERROR,
} from './shopee-order-sync-diagnostics';

describe('sanitizeShopeeOrdersProviderErrorCode', () => {
  it('propagates a valid short provider error code unchanged', () => {
    expect(
      sanitizeShopeeOrdersProviderErrorCode('order.order_list_invalid_time'),
    ).toBe('order.order_list_invalid_time');
  });

  it.each([
    ['contains a space', 'error server unavailable'],
    ['contains a newline', 'error\nserver'],
    ['contains an angle bracket (XSS attempt)', '<script>alert(1)</script>'],
    ['exceeds 64 characters', 'a'.repeat(65)],
    ['is empty', ''],
  ])(
    'falls back to UNCLASSIFIED_PROVIDER_ERROR when the code %s',
    (_label, raw) => {
      expect(sanitizeShopeeOrdersProviderErrorCode(raw)).toBe(
        UNCLASSIFIED_PROVIDER_ERROR,
      );
    },
  );
});

describe('sanitizeShopeeOrdersProviderRequestId', () => {
  it('propagates a valid request id unchanged', () => {
    expect(sanitizeShopeeOrdersProviderRequestId('abc123:def456-00')).toBe(
      'abc123:def456-00',
    );
  });

  it('returns undefined for a non-string value', () => {
    expect(sanitizeShopeeOrdersProviderRequestId(12345)).toBeUndefined();
    expect(sanitizeShopeeOrdersProviderRequestId(null)).toBeUndefined();
    expect(sanitizeShopeeOrdersProviderRequestId(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(sanitizeShopeeOrdersProviderRequestId('')).toBeUndefined();
  });

  it('returns undefined for a value exceeding 128 characters', () => {
    expect(
      sanitizeShopeeOrdersProviderRequestId('a'.repeat(129)),
    ).toBeUndefined();
  });

  it('returns undefined for a value with disallowed characters', () => {
    expect(
      sanitizeShopeeOrdersProviderRequestId('req id with space'),
    ).toBeUndefined();
  });
});

describe('buildShopeeOrderSyncFailureLogPayload', () => {
  it('omits every field left undefined by the diagnostics (never "field": undefined)', () => {
    const payload = buildShopeeOrderSyncFailureLogPayload({
      failureCode: 'DATA_UNAVAILABLE',
      marketplaceAccountId: 'acc-1',
      diagnostics: { stage: 'MAPPING', mappingReason: 'MISSING_TOTAL_AMOUNT' },
    });

    expect(payload).toEqual({
      failureCode: 'DATA_UNAVAILABLE',
      marketplaceAccountId: 'acc-1',
      stage: 'MAPPING',
      mappingReason: 'MISSING_TOTAL_AMOUNT',
    });
    expect(Object.prototype.hasOwnProperty.call(payload, 'syncRunId')).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(payload, 'outcomeKind')).toBe(
      false,
    );
  });

  it('includes every provided field, including syncRunId and numeric indexes', () => {
    const payload = buildShopeeOrderSyncFailureLogPayload({
      failureCode: 'DATA_UNAVAILABLE',
      marketplaceAccountId: 'acc-1',
      syncRunId: 'run-1',
      diagnostics: {
        stage: 'ORDER_LIST',
        outcomeKind: 'provider_rejected',
        providerErrorCode: 'error_shop',
        providerRequestId: 'req-abc123',
        httpStatus: 200,
        blockIndex: 2,
      },
    });

    expect(payload).toEqual({
      failureCode: 'DATA_UNAVAILABLE',
      marketplaceAccountId: 'acc-1',
      syncRunId: 'run-1',
      stage: 'ORDER_LIST',
      outcomeKind: 'provider_rejected',
      providerErrorCode: 'error_shop',
      providerRequestId: 'req-abc123',
      httpStatus: 200,
      blockIndex: 2,
    });
  });
});
