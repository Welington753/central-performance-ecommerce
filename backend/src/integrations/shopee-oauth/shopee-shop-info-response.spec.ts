import { validateShopeeShopInfoResponseBody } from './shopee-shop-info-response';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    error: '',
    message: '',
    request_id: 'req-abc123',
    shop_name: 'Loja Exemplo',
    region: 'BR',
    status: 'NORMAL',
    auth_time: 1700000000,
    expire_time: 1700014400,
    merchant_id: null,
    ...overrides,
  };
}

describe('validateShopeeShopInfoResponseBody', () => {
  it('accepts a well-formed response and maps snake_case to camelCase', () => {
    const result = validateShopeeShopInfoResponseBody(validBody());
    expect(result).toEqual({
      valid: true,
      shopInfo: {
        shopName: 'Loja Exemplo',
        region: 'BR',
        status: 'NORMAL',
        authTime: 1700000000,
        expireTime: 1700014400,
        merchantId: null,
        requestId: 'req-abc123',
      },
    });
  });

  it('accepts a valid positive safe-integer merchant_id', () => {
    const result = validateShopeeShopInfoResponseBody(
      validBody({ merchant_id: 123456 }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.shopInfo.merchantId).toBe(123456);
    }
  });

  it('ignores unknown optional fields for forward compatibility', () => {
    const result = validateShopeeShopInfoResponseBody(
      validBody({
        is_cb: true,
        is_sip: false,
        sip_affi_shops: [1, 2, 3],
        is_upgraded_cbsc: true,
        shop_fulfillment_flag: 'none',
        is_main_shop: false,
        is_direct_shop: true,
        linked_main_shop_id: 999,
        linked_direct_shop_list: [],
        is_one_awb: false,
        is_mart_shop: false,
        is_outlet_shop: false,
        mart_shop_id: null,
        outlet_shop_info_list: [],
        mart_outlet_structure_type: 1,
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(Object.keys(result.shopInfo)).toEqual([
        'shopName',
        'region',
        'status',
        'authTime',
        'expireTime',
        'merchantId',
        'requestId',
      ]);
    }
  });

  it('never propagates the raw "message" field into the preserved result', () => {
    const result = validateShopeeShopInfoResponseBody(
      validBody({ message: 'internal detail that must never leak' }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(JSON.stringify(result.shopInfo)).not.toContain('internal detail');
    }
  });

  it('never returns the raw object received (no reference identity, no passthrough of unknown keys)', () => {
    const body = validBody({ extra_unmapped_field: 'should never appear' });
    const result = validateShopeeShopInfoResponseBody(body);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.shopInfo).not.toBe(body);
      expect(JSON.stringify(result.shopInfo)).not.toContain(
        'should never appear',
      );
    }
  });

  it.each(['NORMAL', 'BANNED', 'FROZEN'] as const)(
    'accepts documented status %s',
    (status) => {
      const result = validateShopeeShopInfoResponseBody(validBody({ status }));
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.shopInfo.status).toBe(status);
      }
    },
  );

  it('rejects an unknown/undocumented status value instead of exposing it', () => {
    const result = validateShopeeShopInfoResponseBody(
      validBody({ status: 'SOME_FUTURE_STATUS' }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects a non-empty error field', () => {
    expect(
      validateShopeeShopInfoResponseBody(validBody({ error: 'error_auth' }))
        .valid,
    ).toBe(false);
  });

  it('rejects error_shop the same way as any other non-empty error', () => {
    expect(
      validateShopeeShopInfoResponseBody(validBody({ error: 'error_shop' }))
        .valid,
    ).toBe(false);
  });

  it.each([
    'error',
    'message',
    'shop_name',
    'region',
    'status',
    'auth_time',
    'expire_time',
    'request_id',
  ])('rejects a response missing required field %s', (field) => {
    const body = validBody();
    delete (body as Record<string, unknown>)[field];
    expect(validateShopeeShopInfoResponseBody(body).valid).toBe(false);
  });

  it('rejects an empty shop_name', () => {
    expect(
      validateShopeeShopInfoResponseBody(validBody({ shop_name: '' })).valid,
    ).toBe(false);
  });

  it('rejects a shop_name above the length ceiling', () => {
    expect(
      validateShopeeShopInfoResponseBody(
        validBody({ shop_name: 'x'.repeat(257) }),
      ).valid,
    ).toBe(false);
  });

  it('rejects an empty region', () => {
    expect(
      validateShopeeShopInfoResponseBody(validBody({ region: '' })).valid,
    ).toBe(false);
  });

  it('rejects a region above the length ceiling', () => {
    expect(
      validateShopeeShopInfoResponseBody(validBody({ region: 'x'.repeat(65) }))
        .valid,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1700000000'])(
    'rejects an invalid auth_time: %s',
    (invalidAuthTime) => {
      expect(
        validateShopeeShopInfoResponseBody(
          validBody({ auth_time: invalidAuthTime }),
        ).valid,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1700014400'])(
    'rejects an invalid expire_time: %s',
    (invalidExpireTime) => {
      expect(
        validateShopeeShopInfoResponseBody(
          validBody({ expire_time: invalidExpireTime }),
        ).valid,
      ).toBe(false);
    },
  );

  it('rejects an implausibly far-future auth_time/expire_time', () => {
    const farFuture = 4200000000000; // muito além do teto defensivo (ano ~2100)
    expect(
      validateShopeeShopInfoResponseBody(validBody({ auth_time: farFuture }))
        .valid,
    ).toBe(false);
    expect(
      validateShopeeShopInfoResponseBody(validBody({ expire_time: farFuture }))
        .valid,
    ).toBe(false);
  });

  it('rejects expire_time earlier than auth_time', () => {
    expect(
      validateShopeeShopInfoResponseBody(
        validBody({ auth_time: 1700010000, expire_time: 1700000000 }),
      ).valid,
    ).toBe(false);
  });

  it('accepts expire_time equal to auth_time (boundary, not "earlier than")', () => {
    const result = validateShopeeShopInfoResponseBody(
      validBody({ auth_time: 1700000000, expire_time: 1700000000 }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a merchant_id that already lost int64 precision (beyond Number.MAX_SAFE_INTEGER)', () => {
    // JSON.parse de um literal inteiro maior que 2^53-1 nunca "arredonda de
    // volta" para dentro da faixa segura — o double resultante permanece
    // acima de Number.MAX_SAFE_INTEGER, então Number.isSafeInteger sozinho já
    // detecta com segurança qualquer perda de precisão de int64 aqui.
    const parsed = JSON.parse(
      JSON.stringify(validBody()).replace(
        '"merchant_id":null',
        '"merchant_id":9007199254740993',
      ),
    ) as unknown;
    expect(validateShopeeShopInfoResponseBody(parsed).valid).toBe(false);
  });

  it.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '123'])(
    'rejects an invalid merchant_id: %s',
    (invalidMerchantId) => {
      expect(
        validateShopeeShopInfoResponseBody(
          validBody({ merchant_id: invalidMerchantId }),
        ).valid,
      ).toBe(false);
    },
  );

  it('rejects a response missing merchant_id entirely (documented as always-present, nullable)', () => {
    const body = validBody();
    delete (body as Record<string, unknown>).merchant_id;
    expect(validateShopeeShopInfoResponseBody(body).valid).toBe(false);
  });

  it('accepts a well-formed request_id (success requires it, Revisão CP2I-R1)', () => {
    const result = validateShopeeShopInfoResponseBody(
      validBody({ request_id: 'req-xyz789' }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.shopInfo.requestId).toBe('req-xyz789');
    }
  });

  it('rejects a response with no request_id — never invents one, never succeeds without it', () => {
    const body = validBody();
    delete (body as Record<string, unknown>).request_id;
    expect(validateShopeeShopInfoResponseBody(body).valid).toBe(false);
  });

  it('rejects an empty request_id', () => {
    expect(
      validateShopeeShopInfoResponseBody(validBody({ request_id: '' })).valid,
    ).toBe(false);
  });

  it('rejects a request_id above the length ceiling (128 chars)', () => {
    expect(
      validateShopeeShopInfoResponseBody(
        validBody({ request_id: 'a'.repeat(129) }),
      ).valid,
    ).toBe(false);
  });

  it('rejects an unexpected request_id format (spaces/slashes) instead of sanitizing it', () => {
    expect(
      validateShopeeShopInfoResponseBody(
        validBody({ request_id: 'has spaces/and/slashes' }),
      ).valid,
    ).toBe(false);
  });

  it.each([
    { shop_name: 123 },
    { region: 456 },
    { status: 1 },
    { auth_time: 'a lot' },
    { expire_time: true },
    { merchant_id: {} },
  ])('rejects incorrect field types: %j', (overrides) => {
    expect(validateShopeeShopInfoResponseBody(validBody(overrides)).valid).toBe(
      false,
    );
  });

  it('rejects a wrong-typed request_id (Revisão CP2I-R1: obrigatório, nunca mais sanitizado para null)', () => {
    expect(
      validateShopeeShopInfoResponseBody(validBody({ request_id: 42 })).valid,
    ).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateShopeeShopInfoResponseBody(null).valid).toBe(false);
    expect(validateShopeeShopInfoResponseBody(undefined).valid).toBe(false);
    expect(validateShopeeShopInfoResponseBody('string').valid).toBe(false);
    expect(validateShopeeShopInfoResponseBody(42).valid).toBe(false);
    expect(validateShopeeShopInfoResponseBody([]).valid).toBe(false);
  });
});
