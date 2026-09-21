import {
  describeShopeeValidationActualType,
  sanitizeShopeeProviderOrderStatusCode,
  SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS,
  SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES,
  SHOPEE_VALIDATION_ACTUAL_TYPES,
  shopeeOrderDetailValidationIssue,
  SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_FIELD_PATHS,
  UNCLASSIFIED_ORDER_STATUS,
} from './shopee-order-detail-validation-issue';

describe('vocabulario fechado de diagnostico de validacao', () => {
  it('todo issue code tem exatamente um fieldPath da allowlist', () => {
    const allowedPaths = new Set<string>(
      SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS,
    );
    for (const code of SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES) {
      const fieldPath = SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_FIELD_PATHS[code];
      expect(typeof fieldPath).toBe('string');
      expect(allowedPaths.has(fieldPath)).toBe(true);
    }
  });

  it('nenhum fieldPath da allowlist nomeia campo pessoal ou monetario do comprador', () => {
    const forbidden = [
      'buyer',
      'recipient',
      'cpf',
      'phone',
      'address',
      'dropshipper',
      'prescription',
      'message_to_seller',
      'access_token',
      'sign',
    ];
    for (const fieldPath of SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS) {
      for (const token of forbidden) {
        expect(fieldPath).not.toContain(token);
      }
    }
  });

  it('actualType e um enum fechado de sete valores', () => {
    expect([...SHOPEE_VALIDATION_ACTUAL_TYPES].sort()).toEqual(
      [
        'array',
        'boolean',
        'missing',
        'null',
        'number',
        'object',
        'string',
      ].sort(),
    );
  });

  it.each([
    [undefined, 'missing'],
    [null, 'null'],
    ['2404098R48U37H', 'string'],
    [1004.5, 'number'],
    [true, 'boolean'],
    [{ order_sn: 'x' }, 'object'],
    [[1, 2, 3], 'array'],
  ])('descreve %p como %s', (value, expected) => {
    expect(describeShopeeValidationActualType(value)).toBe(expected);
  });

  it('o issue construido nunca carrega o valor inspecionado', () => {
    const issue = shopeeOrderDetailValidationIssue(
      'ORDER_SN_INVALID',
      '2404098R48U37H',
    );
    expect(issue).toEqual({
      code: 'ORDER_SN_INVALID',
      fieldPath: 'response.order_list[].order_sn',
      actualType: 'string',
    });
    expect(JSON.stringify(issue)).not.toContain('2404098R48U37H');
  });

  it('o issue construido so expoe code, fieldPath, actualType e orderIndex', () => {
    const issue = shopeeOrderDetailValidationIssue(
      'TOTAL_AMOUNT_INVALID',
      'R$ 1.004,00',
      7,
    );
    expect(Object.keys(issue).sort()).toEqual(
      ['actualType', 'code', 'fieldPath', 'orderIndex'].sort(),
    );
    expect(issue.orderIndex).toBe(7);
    expect(JSON.stringify(issue)).not.toContain('1.004');
  });
});

describe('sanitizeShopeeProviderOrderStatusCode', () => {
  it('propaga um codigo uppercase valido inalterado', () => {
    expect(sanitizeShopeeProviderOrderStatusCode('DELIVERED')).toBe(
      'DELIVERED',
    );
    expect(sanitizeShopeeProviderOrderStatusCode('TO_CONFIRM_RECEIVE')).toBe(
      'TO_CONFIRM_RECEIVE',
    );
  });

  it.each([
    ['minusculo', 'delivered'],
    ['comeca com digito', '1DELIVERED'],
    ['comeca com underscore', '_DELIVERED'],
    ['contem espaco', 'ORDER STATUS'],
    ['contem caractere fora do alfabeto', 'DELIVERED!'],
    ['excede 64 caracteres', 'A' + 'B'.repeat(64)],
    ['string vazia', ''],
  ])('cai no fallback quando o codigo %s', (_label, raw) => {
    expect(sanitizeShopeeProviderOrderStatusCode(raw)).toBe(
      UNCLASSIFIED_ORDER_STATUS,
    );
  });
});

describe('shopeeOrderDetailValidationIssue - providerOrderStatusCode', () => {
  it('inclui providerOrderStatusCode sanitizado somente para ORDER_STATUS_INVALID com valor string', () => {
    const issue = shopeeOrderDetailValidationIssue(
      'ORDER_STATUS_INVALID',
      'DELIVERED',
      0,
    );
    expect(issue).toEqual({
      code: 'ORDER_STATUS_INVALID',
      fieldPath: 'response.order_list[].order_status',
      actualType: 'string',
      orderIndex: 0,
      providerOrderStatusCode: 'DELIVERED',
    });
  });

  it('usa o fallback quando o valor string nao bate com o padrao', () => {
    const issue = shopeeOrderDetailValidationIssue(
      'ORDER_STATUS_INVALID',
      'delivered!!',
    );
    expect(issue.providerOrderStatusCode).toBe(UNCLASSIFIED_ORDER_STATUS);
  });

  it('nao inclui providerOrderStatusCode quando o valor nao e string', () => {
    const issue = shopeeOrderDetailValidationIssue(
      'ORDER_STATUS_INVALID',
      null,
    );
    expect(
      Object.prototype.hasOwnProperty.call(issue, 'providerOrderStatusCode'),
    ).toBe(false);
  });

  it('nao inclui providerOrderStatusCode para nenhum outro codigo de issue', () => {
    const issue = shopeeOrderDetailValidationIssue(
      'CURRENCY_INVALID',
      'DELIVERED',
    );
    expect(
      Object.prototype.hasOwnProperty.call(issue, 'providerOrderStatusCode'),
    ).toBe(false);
  });
});
