import {
  SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS,
  SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES,
  SHOPEE_VALIDATION_ACTUAL_TYPES,
  type ShopeeOrderDetailValidationIssue,
} from './shopee-order-detail-validation-issue';
import { validateShopeeOrderDetailResponseBody } from './shopee-order-detail-response';

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    item_id: 2600144043,
    item_name: 'backpack',
    item_sku: 'sku',
    model_id: 221404189791,
    model_name: '60g',
    model_sku: 'QAZ-SADOER-05',
    model_quantity_purchased: 1,
    model_original_price: 300000,
    model_discounted_price: 48000,
    ...overrides,
  };
}

function validOrder(overrides: Record<string, unknown> = {}) {
  return {
    order_sn: '2404098R48U37H',
    region: 'VN',
    currency: 'VND',
    order_status: 'COMPLETED',
    total_amount: 1004.0,
    create_time: 1712601591,
    update_time: 1713139948,
    fulfillment_flag: 'fulfilled_by_local_seller',
    item_list: [validItem()],
    ...overrides,
  };
}

function baseBody(
  overrides: {
    orders?: unknown[];
    error?: unknown;
    message?: unknown;
    request_id?: unknown;
  } = {},
) {
  return {
    error: overrides.error ?? '',
    message: overrides.message ?? '',
    request_id: overrides.request_id ?? 'req-abc123',
    response: {
      order_list: overrides.orders ?? [validOrder()],
    },
  };
}

const REQUESTED = ['2404098R48U37H'];

function invalidIssue(
  body: unknown,
  requested: string[] = REQUESTED,
): ShopeeOrderDetailValidationIssue {
  const result = validateShopeeOrderDetailResponseBody(body, requested);
  expect(result.valid).toBe(false);
  if (result.valid) throw new Error('esperava rejeicao');
  return result.issue;
}

describe('validateShopeeOrderDetailResponseBody - issue code do envelope', () => {
  it.each([
    [null, 'null'],
    [[], 'array'],
    ['corpo', 'string'],
    [42, 'number'],
  ])('ROOT_NOT_OBJECT para %p', (body, actualType) => {
    expect(invalidIssue(body)).toEqual({
      code: 'ROOT_NOT_OBJECT',
      fieldPath: '$',
      actualType,
    });
  });

  it('ERROR_NOT_STRING quando `error` ausente', () => {
    const body = baseBody() as Record<string, unknown>;
    delete body.error;
    expect(invalidIssue(body)).toEqual({
      code: 'ERROR_NOT_STRING',
      fieldPath: 'error',
      actualType: 'missing',
    });
  });

  it('MESSAGE_NOT_STRING quando `message` ausente', () => {
    const body = baseBody() as Record<string, unknown>;
    delete body.message;
    expect(invalidIssue(body)).toEqual({
      code: 'MESSAGE_NOT_STRING',
      fieldPath: 'message',
      actualType: 'missing',
    });
  });

  it('ERROR_NOT_EMPTY quando `error` traz codigo do provedor', () => {
    expect(invalidIssue(baseBody({ error: 'error_not_found' }))).toEqual({
      code: 'ERROR_NOT_EMPTY',
      fieldPath: 'error',
      actualType: 'string',
    });
  });

  it('REQUEST_ID_INVALID quando `request_id` vazio', () => {
    expect(invalidIssue(baseBody({ request_id: '' }))).toEqual({
      code: 'REQUEST_ID_INVALID',
      fieldPath: 'request_id',
      actualType: 'string',
    });
  });

  it('RESPONSE_NOT_OBJECT quando `response` ausente', () => {
    const body = baseBody() as Record<string, unknown>;
    delete body.response;
    expect(invalidIssue(body)).toEqual({
      code: 'RESPONSE_NOT_OBJECT',
      fieldPath: 'response',
      actualType: 'missing',
    });
  });

  it('ORDER_LIST_NOT_ARRAY quando `order_list` e objeto', () => {
    expect(
      invalidIssue({
        error: '',
        message: '',
        request_id: 'req-abc123',
        response: { order_list: {} },
      }),
    ).toEqual({
      code: 'ORDER_LIST_NOT_ARRAY',
      fieldPath: 'response.order_list',
      actualType: 'object',
    });
  });

  it('ORDER_LIST_LENGTH_MISMATCH quando o lote volta menor que o solicitado', () => {
    expect(
      invalidIssue(baseBody({ orders: [] }), [
        '2404098R48U37H',
        '201214JASXYXY6',
      ]),
    ).toEqual({
      code: 'ORDER_LIST_LENGTH_MISMATCH',
      fieldPath: 'response.order_list',
      actualType: 'array',
    });
  });
});

describe('validateShopeeOrderDetailResponseBody - issue code do pedido', () => {
  it('ORDER_NOT_OBJECT com orderIndex do lote', () => {
    expect(invalidIssue(baseBody({ orders: ['nao-e-objeto'] }))).toEqual({
      code: 'ORDER_NOT_OBJECT',
      fieldPath: 'response.order_list[]',
      actualType: 'string',
      orderIndex: 0,
    });
  });

  it('ORDER_SN_INVALID quando `order_sn` ausente', () => {
    const order = validOrder() as Record<string, unknown>;
    delete order.order_sn;
    expect(invalidIssue(baseBody({ orders: [order] }))).toEqual({
      code: 'ORDER_SN_INVALID',
      fieldPath: 'response.order_list[].order_sn',
      actualType: 'missing',
      orderIndex: 0,
    });
  });

  it('ORDER_SN_NOT_REQUESTED quando o pedido nao foi solicitado', () => {
    expect(
      invalidIssue(
        baseBody({ orders: [validOrder({ order_sn: 'NOT-REQUESTED-1' })] }),
      ),
    ).toEqual({
      code: 'ORDER_SN_NOT_REQUESTED',
      fieldPath: 'response.order_list[].order_sn',
      actualType: 'string',
      orderIndex: 0,
    });
  });

  it('ORDER_SN_DUPLICATED aponta o indice da repeticao', () => {
    expect(
      invalidIssue(
        baseBody({
          orders: [
            validOrder({ order_sn: '2404098R48U37H' }),
            validOrder({ order_sn: '2404098R48U37H' }),
          ],
        }),
        ['2404098R48U37H', '201214JASXYXY6'],
      ),
    ).toEqual({
      code: 'ORDER_SN_DUPLICATED',
      fieldPath: 'response.order_list[].order_sn',
      actualType: 'string',
      orderIndex: 1,
    });
  });

  it.each([
    ['region', 'REGION_INVALID', 'response.order_list[].region', 123, 'number'],
    [
      'currency',
      'CURRENCY_INVALID',
      'response.order_list[].currency',
      'VNDX',
      'string',
    ],
    [
      'order_status',
      'ORDER_STATUS_INVALID',
      'response.order_list[].order_status',
      'DELIVERED',
      'string',
    ],
    [
      'total_amount',
      'TOTAL_AMOUNT_INVALID',
      'response.order_list[].total_amount',
      null,
      'null',
    ],
    [
      'create_time',
      'CREATE_TIME_INVALID',
      'response.order_list[].create_time',
      0,
      'number',
    ],
    [
      'update_time',
      'UPDATE_TIME_INVALID',
      'response.order_list[].update_time',
      'not-a-number',
      'string',
    ],
    [
      'fulfillment_flag',
      'FULFILLMENT_FLAG_INVALID',
      'response.order_list[].fulfillment_flag',
      123,
      'number',
    ],
    [
      'item_list',
      'ITEM_LIST_NOT_ARRAY',
      'response.order_list[].item_list',
      {},
      'object',
    ],
  ])('%s invalido produz %s', (field, code, fieldPath, value, actualType) => {
    expect(
      invalidIssue(baseBody({ orders: [validOrder({ [field]: value })] })),
    ).toEqual({ code, fieldPath, actualType, orderIndex: 0 });
  });
});

describe('validateShopeeOrderDetailResponseBody - issue code do item', () => {
  it('ITEM_NOT_OBJECT com orderIndex do pedido dono do item', () => {
    expect(
      invalidIssue(baseBody({ orders: [validOrder({ item_list: [null] })] })),
    ).toEqual({
      code: 'ITEM_NOT_OBJECT',
      fieldPath: 'response.order_list[].item_list[]',
      actualType: 'null',
      orderIndex: 0,
    });
  });

  it.each([
    [
      'item_id',
      'ITEM_ID_INVALID',
      'response.order_list[].item_list[].item_id',
      0,
      'number',
    ],
    [
      'item_name',
      'ITEM_NAME_INVALID',
      'response.order_list[].item_list[].item_name',
      '',
      'string',
    ],
    [
      'item_sku',
      'ITEM_SKU_INVALID',
      'response.order_list[].item_list[].item_sku',
      123,
      'number',
    ],
    [
      'model_id',
      'MODEL_ID_INVALID',
      'response.order_list[].item_list[].model_id',
      -1,
      'number',
    ],
    [
      'model_name',
      'MODEL_NAME_INVALID',
      'response.order_list[].item_list[].model_name',
      null,
      'null',
    ],
    [
      'model_sku',
      'MODEL_SKU_INVALID',
      'response.order_list[].item_list[].model_sku',
      [],
      'array',
    ],
    [
      'model_quantity_purchased',
      'MODEL_QUANTITY_PURCHASED_INVALID',
      'response.order_list[].item_list[].model_quantity_purchased',
      0,
      'number',
    ],
    [
      'model_original_price',
      'MODEL_ORIGINAL_PRICE_INVALID',
      'response.order_list[].item_list[].model_original_price',
      '300000',
      'string',
    ],
    [
      'model_discounted_price',
      'MODEL_DISCOUNTED_PRICE_INVALID',
      'response.order_list[].item_list[].model_discounted_price',
      Number.NaN,
      'number',
    ],
  ])('%s invalido produz %s', (field, code, fieldPath, value, actualType) => {
    expect(
      invalidIssue(
        baseBody({
          orders: [validOrder({ item_list: [validItem({ [field]: value })] })],
        }),
      ),
    ).toEqual({ code, fieldPath, actualType, orderIndex: 0 });
  });

  it('ITEM_NAME_INVALID tambem cobre nome acima do teto, sem transportar o nome', () => {
    const longName = 'n'.repeat(513);
    const issue = invalidIssue(
      baseBody({
        orders: [
          validOrder({ item_list: [validItem({ item_name: longName })] }),
        ],
      }),
    );
    expect(issue.code).toBe('ITEM_NAME_INVALID');
    expect(JSON.stringify(issue)).not.toContain('nnn');
  });
});

describe('validateShopeeOrderDetailResponseBody - garantias de sanitizacao', () => {
  it('nunca transporta order_sn, valor monetario, dado pessoal ou corpo bruto', () => {
    const issue = invalidIssue(
      baseBody({
        orders: [
          validOrder({
            order_sn: '2404098R48U37H',
            total_amount: 'R$ 1.004,00',
            buyer_username: 'maria.silva',
            buyer_cpf_id: '12345678909',
            recipient_address: { full_address: 'Rua das Flores, 100' },
          }),
        ],
      }),
    );
    const serialized = JSON.stringify(issue);
    for (const secret of [
      '2404098R48U37H',
      '1.004',
      'maria.silva',
      '12345678909',
      'Rua das Flores',
      'backpack',
      'QAZ-SADOER-05',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('todo issue emitido usa apenas code, fieldPath, actualType e orderIndex do vocabulario fechado', () => {
    const codes = new Set<string>(SHOPEE_ORDER_DETAIL_VALIDATION_ISSUE_CODES);
    const paths = new Set<string>(SHOPEE_ORDER_DETAIL_VALIDATION_FIELD_PATHS);
    const types = new Set<string>(SHOPEE_VALIDATION_ACTUAL_TYPES);
    const bodies: unknown[] = [
      null,
      baseBody({ request_id: '' }),
      baseBody({ orders: ['x'] }),
      baseBody({ orders: [validOrder({ currency: 'VNDX' })] }),
      baseBody({
        orders: [validOrder({ item_list: [validItem({ item_id: 0 })] })],
      }),
    ];
    for (const body of bodies) {
      const issue = invalidIssue(body);
      expect(
        Object.keys(issue).every((key) =>
          ['code', 'fieldPath', 'actualType', 'orderIndex'].includes(key),
        ),
      ).toBe(true);
      expect(codes.has(issue.code)).toBe(true);
      expect(paths.has(issue.fieldPath)).toBe(true);
      expect(types.has(issue.actualType)).toBe(true);
    }
  });

  it('resposta valida continua aceita e sem diagnostico', () => {
    const result = validateShopeeOrderDetailResponseBody(baseBody(), REQUESTED);
    expect(result.valid).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'issue')).toBe(false);
  });
});
