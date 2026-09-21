import {
  buildShopeeOrderSyncFailureLogPayload,
  sanitizeShopeeOrderDetailValidationIssue,
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

  it('inclui os campos sanitizados de diagnostico de validacao', () => {
    const payload = buildShopeeOrderSyncFailureLogPayload({
      failureCode: 'DATA_UNAVAILABLE',
      marketplaceAccountId: 'acc-1',
      syncRunId: 'run-1',
      diagnostics: {
        stage: 'ORDER_DETAIL',
        outcomeKind: 'invalid_response',
        httpStatus: 200,
        providerRequestId: 'req-abc123',
        batchIndex: 7,
        validationIssueCode: 'TOTAL_AMOUNT_INVALID',
        validationFieldPath: 'response.order_list[].total_amount',
        validationActualType: 'string',
        validationOrderIndex: 3,
      },
    });

    expect(payload).toEqual({
      failureCode: 'DATA_UNAVAILABLE',
      marketplaceAccountId: 'acc-1',
      syncRunId: 'run-1',
      stage: 'ORDER_DETAIL',
      outcomeKind: 'invalid_response',
      httpStatus: 200,
      providerRequestId: 'req-abc123',
      batchIndex: 7,
      validationIssueCode: 'TOTAL_AMOUNT_INVALID',
      validationFieldPath: 'response.order_list[].total_amount',
      validationActualType: 'string',
      validationOrderIndex: 3,
    });
  });

  it('omite os campos de validacao quando nao ha issue', () => {
    const payload = buildShopeeOrderSyncFailureLogPayload({
      failureCode: 'TEMPORARILY_UNAVAILABLE',
      marketplaceAccountId: 'acc-1',
      diagnostics: { stage: 'ORDER_DETAIL', outcomeKind: 'temporary_failure' },
    });

    for (const key of [
      'validationIssueCode',
      'validationFieldPath',
      'validationActualType',
      'validationOrderIndex',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(payload, key)).toBe(false);
    }
  });
});

describe('sanitizeShopeeOrderDetailValidationIssue', () => {
  it('propaga um issue integralmente valido', () => {
    expect(
      sanitizeShopeeOrderDetailValidationIssue({
        code: 'ORDER_STATUS_INVALID',
        fieldPath: 'response.order_list[].order_status',
        actualType: 'string',
        orderIndex: 4,
      }),
    ).toEqual({
      validationIssueCode: 'ORDER_STATUS_INVALID',
      validationFieldPath: 'response.order_list[].order_status',
      validationActualType: 'string',
      validationOrderIndex: 4,
    });
  });

  it('retorna vazio para issue ausente', () => {
    expect(sanitizeShopeeOrderDetailValidationIssue(undefined)).toEqual({});
  });

  it('rejeita fechado um code fora do enum', () => {
    expect(
      sanitizeShopeeOrderDetailValidationIssue({
        code: 'CODIGO_INVENTADO',
        fieldPath: 'response.order_list[].order_status',
        actualType: 'string',
      }),
    ).toEqual({});
  });

  it('rejeita fechado um fieldPath fora da allowlist', () => {
    expect(
      sanitizeShopeeOrderDetailValidationIssue({
        code: 'ORDER_STATUS_INVALID',
        fieldPath: 'response.order_list[].buyer_cpf_id',
        actualType: 'string',
      }),
    ).toEqual({});
  });

  it('rejeita fechado um actualType fora do enum', () => {
    expect(
      sanitizeShopeeOrderDetailValidationIssue({
        code: 'ORDER_STATUS_INVALID',
        fieldPath: 'response.order_list[].order_status',
        actualType: '2404098R48U37H',
      }),
    ).toEqual({});
  });

  it('descarta apenas o orderIndex quando ele nao e um indice valido', () => {
    expect(
      sanitizeShopeeOrderDetailValidationIssue({
        code: 'ORDER_STATUS_INVALID',
        fieldPath: 'response.order_list[].order_status',
        actualType: 'string',
        orderIndex: -1,
      }),
    ).toEqual({
      validationIssueCode: 'ORDER_STATUS_INVALID',
      validationFieldPath: 'response.order_list[].order_status',
      validationActualType: 'string',
    });
  });

  it('nunca propaga chave extra vinda de um issue adulterado', () => {
    const sanitized = sanitizeShopeeOrderDetailValidationIssue({
      code: 'ORDER_STATUS_INVALID',
      fieldPath: 'response.order_list[].order_status',
      actualType: 'string',
      rawValue: '2404098R48U37H',
      buyerUsername: 'maria.silva',
    });

    expect(Object.keys(sanitized).sort()).toEqual([
      'validationActualType',
      'validationFieldPath',
      'validationIssueCode',
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('2404098R48U37H');
    expect(JSON.stringify(sanitized)).not.toContain('maria.silva');
  });
});
